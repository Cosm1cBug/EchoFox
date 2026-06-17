/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .afk — mark yourself as away. The bot will auto-reply once (per 30 s
 *        per chat) when someone mentions or replies to you.
 *
 *   .afk                          → status (am I AFK?)
 *   .afk lunch break              → mark AFK with reason
 *   .afk off                      → clear AFK manually
 *
 * The AFK flag is also cleared automatically the next time the user sends
 * a message (handled in events/messages.upsert.js — see the AFK-check
 * block near the top of handleMessage).
 *
 * State lives in src/services/afkState.js (in-memory, bounded LRU).
 */

const afkState = require('../../services/afkState');

const OFF_VERBS = new Set(['off', 'back', 'clear', 'cancel', 'stop']);

module.exports = {
  name: 'afk',
  alias: ['away'],
  desc: 'Mark yourself as away with an optional reason.',
  category: 'user',
  type: 'user',
  usage: '[reason | off]',
  cooldown: 2,

  async start(sock, m, { ctx, text, pushName }) {
    const arg = String(text || '').trim();
    const verb = arg.toLowerCase();

    // ─── .afk off ──────────────────────────────────────────────────────
    if (OFF_VERBS.has(verb)) {
      const wasAfk = afkState.clear(ctx.sender);
      await ctx.react(wasAfk ? '✅' : 'ℹ️');
      return ctx.reply(wasAfk ? '✅ Welcome back! AFK cleared.' : "ℹ️ You weren't AFK.");
    }

    // ─── .afk (no args) → status ──────────────────────────────────────
    if (!arg) {
      const cur = afkState.get(ctx.sender);
      if (!cur) {
        return ctx.reply(
          '💤 *AFK*\n\n' +
            "You're currently *active*.\n\n" +
            'Usage:\n' +
            '• `.afk <reason>` — mark yourself away\n' +
            '• `.afk off` — clear AFK',
        );
      }
      const dur = afkState.formatDuration(Date.now() - cur.since);
      return ctx.reply(
        `💤 *AFK status*\n\n` +
          `*Reason:* ${cur.reason}\n` +
          `*Since:* ${dur} ago\n\n` +
          'Send any message (or `.afk off`) to clear.',
      );
    }

    // ─── .afk <reason> ────────────────────────────────────────────────
    afkState.mark(ctx.sender, arg);
    await ctx.react('💤');
    return ctx.reply(
      `💤 *${pushName || 'You'} is now AFK*\n\n` +
        `*Reason:* ${arg}\n\n` +
        "I'll let people know if they mention you. Send any message to clear.",
    );
  },
};
