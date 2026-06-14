/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .rss — generic RSS/Atom feed subscription
 *
 *   .rss add <url> [topic1 topic2 ...]   subscribe to a feed (optional topic filter)
 *   .rss remove <url>                    unsubscribe from one feed
 *   .rss list                            show your subscribed feeds
 *   .rss -status                         alias for list
 *   .rss help                            show usage
 *
 *   Per-subscriber meta shape:
 *     { feeds: [{ url, topics?: string[] }, ...] }
 */

const { getStore } = require('../../store/instance');
const { config } = require('../../lib/configLoader');
const logger = require('../../core/logger').child({ mod: 'rss-cmd' });

const SERVICE = 'rss';
const MAX_FEEDS = config.apis?.rss?.maxFeedsPerSubscriber || 20;
const URL_RE = /^https?:\/\/\S+$/i;

const VERBS_STATUS = new Set(['status', '-status', '--status', 'list']);
const VERBS_HELP = new Set(['help', '-help', '--help', '?', '']);

function parseTopics(rest) {
  const seen = new Set();
  for (const word of rest.split(/\s+/)) {
    const t = word.trim().toLowerCase();
    if (t) seen.add(t);
  }
  return Array.from(seen).slice(0, 10);
}

function helpPanel() {
  return [
    '📰 *RSS / Atom Subscription*',
    '',
    'Receive any RSS or Atom feed straight to your DM. Polls every',
    `${config.apis?.rss?.checkIntervalMin || 30} minutes; up to ${config.apis?.rss?.maxArticlesPerFeed || 5} new articles per feed per cycle.`,
    '',
    '*Commands*',
    '• `.rss add <url>`                       — subscribe (no topic filter)',
    '• `.rss add <url> malware ransomware`    — subscribe with topic filter',
    '• `.rss remove <url>`                    — unsubscribe from one feed',
    '• `.rss list`                            — show your subscriptions',
    '• `.rss -status`                         — alias for list',
    '• `.rss help`                            — show this message',
    '',
    `_Limit: ${MAX_FEEDS} feeds per subscriber._`,
  ].join('\n');
}

module.exports = {
  name: 'rss',
  alias: ['feed', 'feeds'],
  usage: `<add/remove/list/-status>`,
  type: 'general',
  info: 'Subscribe to any RSS/Atom feed.',
  start: async (sock, m, { text }) => {
    if (!m.isPrivate) {
      return await sock.sendMessage(
        m.chat,
        { text: '❌ Can only be used in Private Chats.' },
        { quoted: m },
      );
    }

    const jid = String(m.sender || m.from);
    const store = getStore();
    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const verb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const rest = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    // ─── add <url> [topics...] ────────────────────────────────────────
    if (verb === 'add') {
      const tokens = rest.split(/\s+/);
      const url = tokens.shift();
      if (!url || !URL_RE.test(url)) {
        return await sock.sendMessage(
          m.chat,
          { text: 'Usage: `.rss add <http(s)://feed-url> [topic1 topic2 ...]`' },
          { quoted: m },
        );
      }
      const topics = parseTopics(tokens.join(' '));

      const existingMeta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const feeds = Array.isArray(existingMeta.feeds) ? [...existingMeta.feeds] : [];

      const dupIdx = feeds.findIndex((f) => f.url === url);
      if (dupIdx >= 0) {
        feeds[dupIdx] = { url, topics: topics.length ? topics : undefined };
      } else {
        if (feeds.length >= MAX_FEEDS) {
          return await sock.sendMessage(
            m.chat,
            {
              text: `❌ You're at the ${MAX_FEEDS}-feed limit. Remove one first with \`.rss remove <url>\`.`,
            },
            { quoted: m },
          );
        }
        feeds.push({ url, topics: topics.length ? topics : undefined });
      }

      const meta = { ...existingMeta, feeds };
      const isSub = await store.isSubscriber(SERVICE, jid);
      if (isSub) await store.updateSubscriberMeta(SERVICE, jid, meta);
      else await store.addSubscriber(SERVICE, jid, meta);

      logger.info(
        { jid, action: dupIdx >= 0 ? 'update-feed' : 'add-feed', url, topics },
        'rss subscription changed',
      );
      return await sock.sendMessage(
        m.chat,
        {
          text: topics.length
            ? `✅ Subscribed to \`${url}\` (topics: *${topics.join(', ')}*).`
            : `✅ Subscribed to \`${url}\` (all articles).`,
        },
        { quoted: m },
      );
    }

    // ─── remove <url> ─────────────────────────────────────────────────
    if (verb === 'remove' || verb === 'rm') {
      const url = rest.split(/\s+/)[0];
      if (!url) {
        return await sock.sendMessage(
          m.chat,
          { text: 'Usage: `.rss remove <url>`' },
          { quoted: m },
        );
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const feeds = Array.isArray(meta.feeds) ? meta.feeds.filter((f) => f.url !== url) : [];
      if (!feeds.length) {
        await store.removeSubscriber(SERVICE, jid);
        logger.info({ jid, action: 'remove-last-feed', url }, 'rss subscription removed');
        return await sock.sendMessage(
          m.chat,
          { text: `❌ Removed last feed; you are no longer subscribed to .rss.` },
          { quoted: m },
        );
      }
      await store.updateSubscriberMeta(SERVICE, jid, { ...meta, feeds });
      logger.info({ jid, action: 'remove-feed', url }, 'rss feed removed');
      return await sock.sendMessage(
        m.chat,
        { text: `❌ Removed \`${url}\`. (${feeds.length} remaining.)` },
        { quoted: m },
      );
    }

    // ─── list / -status ───────────────────────────────────────────────
    if (VERBS_STATUS.has(verb)) {
      const isSub = await store.isSubscriber(SERVICE, jid);
      if (!isSub) {
        return await sock.sendMessage(
          m.chat,
          {
            text: '📭 *RSS subscription*\n\nYou have no feeds. Use `.rss add <url>` to subscribe.',
          },
          { quoted: m },
        );
      }
      const meta = (await store.getSubscriberMeta(SERVICE, jid)) || {};
      const feeds = Array.isArray(meta.feeds) ? meta.feeds : [];
      if (!feeds.length) {
        return await sock.sendMessage(
          m.chat,
          {
            text: '📭 *RSS subscription*\n\nYou have no feeds (subscription exists with empty list).',
          },
          { quoted: m },
        );
      }
      const lines = feeds.map((f, i) => {
        const topics = f.topics && f.topics.length ? ` _(topics: ${f.topics.join(', ')})_` : '';
        return `${i + 1}. \`${f.url}\`${topics}`;
      });
      return await sock.sendMessage(
        m.chat,
        {
          text: [`📬 *RSS subscriptions* (${feeds.length}/${MAX_FEEDS})`, '', ...lines].join('\n'),
        },
        { quoted: m },
      );
    }

    // ─── help / unknown ───────────────────────────────────────────────
    if (VERBS_HELP.has(verb)) {
      return await sock.sendMessage(m.chat, { text: helpPanel() }, { quoted: m });
    }

    return await sock.sendMessage(
      m.chat,
      { text: `Unknown verb *${verb}*. Use \`.rss help\` to see options.` },
      { quoted: m },
    );
  },
};
