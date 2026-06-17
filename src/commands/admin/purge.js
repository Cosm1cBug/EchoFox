/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .purge — admin-only. Revoke the bot's recently-sent messages in this chat.
 *
 *   .purge                 → revoke the bot's last 10 messages here
 *   .purge 25              → revoke the bot's last 25 messages (cap: 100)
 *   .purge 5m              → revoke all messages sent in last 5 minutes
 *   .purge 1h              → all in last hour (capped at MAX_PER_CHAT entries)
 *
 * Only revokes messages the bot itself sent, and only within its current
 * process lifetime (tracker is in-memory by design). To revoke older
 * messages or another user's messages, group-admin tooling outside the
 * scope of this command would be needed.
 *
 * Uses Baileys' `sock.sendMessage(jid, { delete: key })` revoke API.
 */

const tracker = require('../../services/sentMessageTracker');

const DEFAULT_N = 10;
const MAX_N = 100;
const DUR_RE = /^(\d+)\s*([smhd])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

module.exports = {
  name: 'purge',
  alias: ['clear', 'cleanup'],
  desc: "Revoke the bot's recently-sent messages in this chat.",
  category: 'admin',
  type: 'admin',
  admin: true,
  usage: '[N | <duration>]',
  cooldown: 5,
  timeout: 30,

  async start(sock, m, { ctx, text }) {
    const arg = String(text || '')
      .trim()
      .toLowerCase();

    let entries;
    let descriptor;
    const dur = arg.match(DUR_RE);
    if (dur) {
      const ms = parseInt(dur[1], 10) * UNIT_MS[dur[2].toLowerCase()];
      entries = tracker.recentSince(ctx.chat, ms);
      descriptor = `last ${dur[0]}`;
    } else {
      const n = arg ? Math.max(1, Math.min(MAX_N, parseInt(arg, 10) || DEFAULT_N)) : DEFAULT_N;
      entries = tracker.recent(ctx.chat, n);
      descriptor = `last ${entries.length} message${entries.length === 1 ? '' : 's'}`;
    }

    if (!entries.length) {
      return ctx.reply(
        '📭 Nothing to purge — no tracked outbound messages in this chat. ' +
          '(Tracker only sees messages from the current process lifetime.)',
      );
    }

    await ctx.react('🧹');

    let ok = 0;
    let fail = 0;
    // Reverse order: newest first feels right and avoids "revoke X then X+1" oddities.
    for (const entry of [...entries].reverse()) {
      try {
        await sock.sendMessage(ctx.chat, { delete: entry.key });
        tracker.forget(entry.key);
        ok += 1;
      } catch (_err) {
        fail += 1;
      }
    }

    return ctx.reply(
      `🧹 *Purge complete*\n\n` +
        `*Scope:* ${descriptor}\n` +
        `*Revoked:* ${ok}` +
        (fail ? `\n*Failed:* ${fail}` : ''),
    );
  },
};
