/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { version } = require('../../../package.json');
const metrics = require('../../services/metrics');
const { getMediaUploadTimeoutMs } = require('../../lib/network');
const { MENU_STYLES, MENU_CATEGORIES, makeMenuSelection } = require('../../lib/menuNavigation');

// Shared image for the carousel and thumbnail previews. Resolve from this file, not cwd.
const THUMBNAIL_PATH = path.join(__dirname, '..', '..', 'Utils', 'assets', 'buggy.jpg');
const COMMANDS_PER_PAGE = 8;
const STYLE_NAMES = {
  carousel: 'Single-card carousel',
  thumbnail: 'Thumbnail menu',
  list: 'Category list',
};
const CATEGORY_INFO = {
  ai: { title: '🤖 AI & writing', desc: 'Ask, explain, summarize and create' },
  media: { title: '🎨 Media', desc: 'Stickers, conversions and downloads' },
  tools: { title: '🧰 Useful tools', desc: 'Utilities, weather, reminders and more' },
  feeds: { title: '📰 Feeds & security', desc: 'News, GitHub and threat intelligence' },
  group: { title: '👥 Group management', desc: 'Welcome messages and moderation' },
  user: { title: '👤 Your profile', desc: 'Profile, AFK and notifications' },
  admin: { title: '🔒 Bot administration', desc: 'Operator-only commands' },
  other: { title: '✨ More commands', desc: 'Other available features' },
};
const AI_COMMANDS = new Set(['ai', 'ask', 'explain', 'summarize', 'imagine']);
const FEED_COMMANDS = new Set([
  'alienvault',
  'github',
  'hn',
  'reddit',
  'rss',
  'thehackersnews',
  'virustotal',
  'vtwatch',
]);
let thumbnailPromise;

function oneLine(value, max = 120) {
  const text = String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function adminOnly(cmd) {
  return cmd.admin === true || cmd.category === 'admin' || cmd.type === 'admin';
}

function categoryFor(cmd) {
  if (adminOnly(cmd)) return 'admin';
  if (AI_COMMANDS.has(cmd.name)) return 'ai';
  if (FEED_COMMANDS.has(cmd.name)) return 'feeds';
  const category = cmd.category || cmd.type;
  if (cmd.group || category === 'group') return 'group';
  if (category === 'convert' || category === 'download') return 'media';
  if (category === 'user') return 'user';
  if (['tools', 'general', 'misc', 'entertainment'].includes(category)) return 'tools';
  return 'other';
}

function visibleCommands(registry, cfg, ctx, isAdmin) {
  const commands = typeof registry?.all === 'function' ? registry.all() : [];
  return commands
    .filter((cmd) => {
      if (cmd.name === 'menu' || cmd.hidden || cmd.type === 'hide' || cmd.disabled) return false;
      if (adminOnly(cmd) && !isAdmin) return false;
      if ((cmd.group || categoryFor(cmd) === 'group') && !ctx.isGroup) return false;
      // Keep .ai status discoverable even when AI generation is globally off.
      if (AI_COMMANDS.has(cmd.name) && cmd.name !== 'ai' && !cfg.ai?.enabled) return false;
      if (cmd.name === 'ytdl' && !cfg.features?.ytdl) return false;
      return (cmd.requires || []).every((key) => {
        const value = key.split('.').reduce((obj, part) => obj?.[part], cfg);
        return (
          value != null &&
          value !== '' &&
          value !== false &&
          !(Array.isArray(value) && !value.length)
        );
      });
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadThumbnail(logger) {
  // No file I/O during command discovery. Cache the small local file on first use.
  if (!thumbnailPromise) {
    thumbnailPromise = fs.readFile(THUMBNAIL_PATH).catch((err) => {
      logger?.warn({ err }, 'Menu image unavailable; using a text-only header');
      return null;
    });
  }
  return thumbnailPromise;
}

function chooser(prefix) {
  return [
    '🦊 *Choose your EchoFox menu*',
    '',
    `${prefix}menu carousel — One image card with a category picker`,
    `${prefix}menu thumbnail — Image + caption, no interactive controls`,
    `${prefix}menu list — Native category selector, no image upload`,
    '',
    `Browse directly: ${prefix}menu tools`,
    `All commands: ${prefix}menu all`,
    `Next page: ${prefix}menu all 2`,
    '',
    'Try each style in a DM or group. Interactive rendering varies by WhatsApp client.',
  ].join('\n');
}

function homeText({ name, prefix, style, commands, categories }) {
  return [
    `🦊 *${name}*`,
    `_${STYLE_NAMES[style]} preview_`,
    '',
    'Your WhatsApp toolbox. Choose a category to get started.',
    `${commands.length} commands · ${categories.length} categories`,
    '',
    ...categories.map((key) => `${CATEGORY_INFO[key].title}\n${prefix}menu ${style} ${key}`),
    '',
    `📚 All commands: ${prefix}menu ${style} all`,
    `Try another style: ${prefix}menu`,
  ].join('\n');
}

function categoryText({ target, page, commands, prefix, adminPrefix, style }) {
  const selected =
    target === 'all' ? commands : commands.filter((cmd) => categoryFor(cmd) === target);
  if (!selected.length) {
    return `No commands in this category are available here.\n\n${prefix}menu ${style} — Back to categories`;
  }
  const pages = Math.ceil(selected.length / COMMANDS_PER_PAGE);
  if (page > pages) {
    return `That page does not exist. Choose a page from 1 to ${pages}.\n\n${prefix}menu ${style} ${target} 1`;
  }
  const title = target === 'all' ? '📚 All available commands' : CATEGORY_INFO[target].title;
  const lines = [`*${title}*`, `Page ${page}/${pages} · ${selected.length} commands`, ''];
  if (target === 'ai') {
    lines.push(
      'AI requests also check this chat’s consent, provider configuration and budget.',
      '',
    );
  }
  for (const cmd of selected.slice((page - 1) * COMMANDS_PER_PAGE, page * COMMANDS_PER_PAGE)) {
    const cmdPrefix = adminOnly(cmd) ? adminPrefix : prefix;
    lines.push(`${cmdPrefix}${cmd.name}${cmd.usage ? ' ' + oneLine(cmd.usage, 100) : ''}`);
    if (cmd.desc) lines.push(`  ${oneLine(cmd.desc)}`);
    lines.push('');
  }
  if (page > 1) lines.push(`Previous: ${prefix}menu ${style} ${target} ${page - 1}`);
  if (page < pages) lines.push(`Next: ${prefix}menu ${style} ${target} ${page + 1}`);
  lines.push(`Categories: ${prefix}menu ${style}`);
  return lines.join('\n');
}

function categoryButton(prefix, style, categories, commands) {
  // Eight curated categories + All = at most nine rows. Params must be JSON strings.
  const rows = categories.map((key) => ({
    title: CATEGORY_INFO[key].title,
    description: `${commands.filter((cmd) => categoryFor(cmd) === key).length} commands · ${CATEGORY_INFO[key].desc}`,
    id: makeMenuSelection(prefix, style, key),
  }));
  rows.push({
    title: '📚 All commands',
    description: 'Browse every visible command, eight per page',
    id: makeMenuSelection(prefix, style, 'all'),
  });
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: '📂 Browse commands',
      sections: [{ title: 'Choose a category', rows }],
    }),
  };
}

async function sendInteractive(sock, m, ctx, state, logger) {
  const {
    proto,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
  } = require('@whiskeysockets/baileys');
  const footer = `${state.name} · v${version}`;
  const nativeFlowMessage = {
    buttons: [categoryButton(state.prefix, state.style, state.categories, state.commands)],
    messageVersion: 1,
  };
  let interactive;
  if (state.style === 'carousel') {
    const image = await loadThumbnail(logger);
    const media = image
      ? await prepareWAMessageMedia(
          { image },
          { upload: sock.waUploadToServer, mediaUploadTimeoutMs: state.mediaUploadTimeoutMs },
        )
      : {};
    interactive = {
      body: {
        text: `🦊 Single-card carousel preview — open the card’s category picker.\nIf the card is hidden: ${state.prefix}menu thumbnail`,
      },
      footer: { text: footer },
      carouselMessage: {
        // Intentionally ONE card so the operator can test this exact variant.
        messageVersion: 1,
        cards: [
          {
            header: { title: state.name, hasMediaAttachment: !!media.imageMessage, ...media },
            body: { text: state.text },
            footer: { text: `Typed navigation: ${state.prefix}menu all` },
            nativeFlowMessage,
          },
        ],
      },
    };
  } else {
    interactive = {
      header: { title: state.name, hasMediaAttachment: false },
      body: { text: state.text },
      footer: { text: footer },
      nativeFlowMessage,
    };
  }
  const message = generateWAMessageFromContent(
    ctx.chat,
    {
      viewOnceMessage: {
        message: {
          messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
          interactiveMessage: proto.Message.InteractiveMessage.create(interactive),
        },
      },
    },
    { userJid: sock.user?.id, quoted: m },
  );
  await sock.relayMessage(ctx.chat, message.message, { messageId: message.key.id });
  metrics.incSent();
  return message;
}

module.exports = {
  name: 'menu',
  alias: ['listmenu', 'commands'],
  desc: 'Try carousel, thumbnail or list menus, then browse commands by category.',
  category: 'main',
  hidden: true,
  type: 'hide',
  usage: '[carousel|thumbnail|list] [category|all] [page]',
  noLimit: true,

  async start(
    sock,
    m,
    {
      ctx,
      commands,
      args = [],
      prefix: matchedPrefix,
      isAdmin = false,
      config: cfg = require('../../lib/configLoader').config,
      logger = sock.logger,
    },
  ) {
    // Use ctx throughout: raw Baileys messages do not have m.chat/m.isPrivate.
    const prefix = typeof cfg.bot?.prefix === 'string' ? cfg.bot.prefix : matchedPrefix || '.';
    const adminPrefix = typeof cfg.bot?.adminPrefix === 'string' ? cfg.bot.adminPrefix : prefix;
    const tokens = args.map((arg) => String(arg).toLowerCase());
    if (!tokens.length || tokens[0] === 'help') return ctx.reply(chooser(prefix));

    const style = MENU_STYLES.includes(tokens[0]) ? tokens.shift() : 'thumbnail';
    const target = tokens.shift() || 'home';
    const pageText = tokens.shift() || '1';
    if (
      tokens.length ||
      !['home', 'all', ...MENU_CATEGORIES].includes(target) ||
      !/^[1-9]\d{0,3}$/.test(pageText) ||
      (target === 'home' && pageText !== '1')
    ) {
      return ctx.reply(`Unknown menu category or page.\n\n${chooser(prefix)}`);
    }

    const available = visibleCommands(commands, cfg, ctx, isAdmin);
    if (target !== 'home') {
      return ctx.reply(
        categoryText({
          target,
          page: Number(pageText),
          commands: available,
          prefix,
          adminPrefix,
          style,
        }),
      );
    }
    const categories = MENU_CATEGORIES.filter((key) =>
      available.some((cmd) => categoryFor(cmd) === key),
    );
    const name = oneLine(cfg.bot?.name, 32) || 'EchoFox';
    const state = {
      name,
      prefix,
      style,
      commands: available,
      categories,
      mediaUploadTimeoutMs: getMediaUploadTimeoutMs(cfg),
    };
    state.text = homeText(state);

    try {
      if (style === 'thumbnail') {
        const image = await loadThumbnail(logger);
        if (!image)
          return ctx.reply(`${state.text}\n\n_Menu image unavailable; showing text instead._`);
        const result = await sock.sendMessage(
          ctx.chat,
          { image, caption: `${state.text}\n\n${name} · v${version}` },
          { quoted: m, mediaUploadTimeoutMs: state.mediaUploadTimeoutMs },
        );
        metrics.incSent();
        return result;
      }
      return await sendInteractive(sock, m, ctx, state, logger);
    } catch (err) {
      logger?.warn({ err, style }, 'Menu send failed; falling back to text');
      return ctx.reply(
        `${state.text}\n\n_The ${STYLE_NAMES[style].toLowerCase()} could not be sent. Showing text instead._`,
      );
    }
  },
};
