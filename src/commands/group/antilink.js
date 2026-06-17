/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .antilink — per-group antilink config.
 *
 *   .antilink                                → show status
 *   .antilink on | off                       → toggle
 *   .antilink action <warn|delete|delete+warn>
 *   .antilink whitelist add <host>           → allow links from this host
 *   .antilink whitelist remove <host>
 *   .antilink whitelist list
 *
 * The actual link detection + auto-delete is performed in
 * src/events/messages.upsert.js (antilink hook block).
 * Group-admin-only.
 */

const antilink = require('../../services/antilinkService');

const VERB_TOGGLE = new Set(['on', 'off']);
const VERB_ACTION = new Set(['action', 'mode']);
const VERB_WL = new Set(['whitelist', 'wl', 'allow']);

function help() {
  return [
    '🔗 *Antilink*',
    '',
    'Block links from non-admins in this group.',
    '',
    '*Commands:*',
    '• `.antilink on` / `.antilink off`',
    '• `.antilink action <warn|delete|delete+warn>`',
    '• `.antilink whitelist add <host>`     (e.g. github.com)',
    '• `.antilink whitelist remove <host>`',
    '• `.antilink whitelist list`',
    '',
    '_Group admins are exempt. WhatsApp invite links are blocked unless whitelisted._',
  ].join('\n');
}

module.exports = {
  name: 'antilink',
  alias: ['nolink', 'linkblock'],
  desc: 'Configure antilink protection for this group.',
  category: 'group',
  type: 'group',
  group: true,
  needsMetadata: true,
  usage: '[on|off|action <a>|whitelist add|remove|list <host>]',
  cooldown: 2,

  async start(sock, m, { ctx, metadata, text }) {
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);
    if (!caller?.admin) {
      return ctx.reply('🔒 Only group admins can configure antilink.');
    }

    const cfg = await antilink.getConfig(ctx.chat);
    const tokens = String(text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const verb = tokens[0]?.toLowerCase() || '';

    if (!verb) {
      return ctx.reply(
        '🔗 *Antilink config*\n\n' +
          `*Enabled:* ${cfg.enabled ? '✅ on' : '❌ off'}\n` +
          `*Action:*  ${cfg.action}\n` +
          `*Whitelist:* ${cfg.whitelist.length ? cfg.whitelist.join(', ') : '_(empty)_'}\n\n` +
          help(),
      );
    }

    if (VERB_TOGGLE.has(verb)) {
      const flag = verb === 'on';
      await antilink.setConfig(ctx.chat, { enabled: flag });
      await ctx.react(flag ? '✅' : '🚫');
      return ctx.reply(`${flag ? '✅' : '🚫'} Antilink is now *${verb}*.`);
    }

    if (VERB_ACTION.has(verb)) {
      const a = tokens[1]?.toLowerCase();
      if (!antilink.VALID_ACTIONS.has(a)) {
        return ctx.reply(
          `Usage: \`.antilink action <warn|delete|delete+warn>\`  (current: ${cfg.action})`,
        );
      }
      await antilink.setConfig(ctx.chat, { action: a });
      await ctx.react('✏️');
      return ctx.reply(`✏️ Action set to *${a}*.`);
    }

    if (VERB_WL.has(verb)) {
      const sub = tokens[1]?.toLowerCase();
      const host = tokens[2]?.toLowerCase();
      if (sub === 'list' || !sub) {
        return ctx.reply(
          cfg.whitelist.length
            ? `📜 *Whitelist* (${cfg.whitelist.length}/${antilink.MAX_WHITELIST}):\n` +
                cfg.whitelist.map((h) => `• ${h}`).join('\n')
            : '📭 Whitelist is empty.',
        );
      }
      if (sub === 'add') {
        if (!host) return ctx.reply('Usage: `.antilink whitelist add <host>`');
        try {
          const next = await antilink.addToWhitelist(ctx.chat, host);
          await ctx.react('✅');
          return ctx.reply(
            `✅ Added *${host}* to whitelist (${next.length}/${antilink.MAX_WHITELIST}).`,
          );
        } catch (err) {
          return ctx.reply(`❌ ${err.message}`);
        }
      }
      if (sub === 'remove' || sub === 'rm') {
        if (!host) return ctx.reply('Usage: `.antilink whitelist remove <host>`');
        const next = await antilink.removeFromWhitelist(ctx.chat, host);
        await ctx.react('🗑️');
        return ctx.reply(`🗑️ Removed *${host}* from whitelist (${next.length} remaining).`);
      }
      return ctx.reply('Usage: `.antilink whitelist <add|remove|list> [host]`');
    }

    return ctx.reply(`Unknown verb *${verb}*. Send \`.antilink\` for help.`);
  },
};
