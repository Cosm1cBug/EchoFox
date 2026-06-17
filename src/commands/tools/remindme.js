/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .remindme — schedule a one-shot reminder to be delivered to this chat.
 *
 *   .remindme 5m grab the laundry
 *   .remindme 2h30m standup with team
 *   .remindme 1d call mom
 *   .remindme list                       → show your pending reminders
 *   .remindme cancel <id>                → cancel one (id = first 8 chars)
 *   .remindme clear                      → cancel all your reminders
 *
 * Duration grammar (case-insensitive, units combinable):
 *   <integer>      → seconds (POSIX `sleep` style)
 *   Ns / Nm / Nh / Nd / Nw
 *   Combos: 1h30m, 2d12h, 1w2d
 *
 * Backed by src/services/reminderService.js — survives restarts (stored
 * in subscriber_meta) and fires every minute via the worker-level cron.
 */

const reminder = require('../../services/reminderService');

const VERBS_LIST = new Set(['list', 'ls', '-list', '--list', 'status']);
const VERBS_CLEAR = new Set(['clear', 'clearall', 'reset']);
const VERBS_CANCEL = new Set(['cancel', 'rm', 'remove', 'del', 'delete']);
const VERBS_HELP = new Set(['help', '-help', '--help', '?']);

function helpPanel() {
  return [
    '⏰ *Reminders*',
    '',
    'Schedule a one-shot reminder delivered to this chat.',
    '',
    '*Set:* `.remindme <duration> <message>`',
    '• `.remindme 10m take laundry out`',
    '• `.remindme 2h30m standup`',
    '• `.remindme 1d call mom`',
    '',
    '*Manage:*',
    '• `.remindme list` — show pending',
    '• `.remindme cancel <id>` — cancel one (id = first 8 chars from list)',
    '• `.remindme clear` — cancel all',
    '',
    `_Up to ${reminder.MAX_PER_USER} pending reminders; max ${reminder.MAX_HORIZON_MS / (86_400_000 * 365)}y horizon._`,
  ].join('\n');
}

module.exports = {
  name: 'remindme',
  alias: ['remind', 'reminder'],
  desc: 'Schedule a reminder ("⏰ in 10 minutes …").',
  category: 'tools',
  type: 'tools',
  usage: '<duration> <message> | list | cancel <id> | clear',
  cooldown: 2,

  async start(sock, m, { ctx, text }) {
    const raw = String(text || '').trim();
    if (!raw || VERBS_HELP.has(raw.toLowerCase())) {
      return ctx.reply(helpPanel());
    }

    const firstSpace = raw.indexOf(' ');
    const verb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const rest = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();

    // ─── list ─────────────────────────────────────────────────────────
    if (VERBS_LIST.has(verb)) {
      const items = await reminder.listFor(ctx.sender);
      if (!items.length) {
        return ctx.reply('📭 You have no pending reminders.');
      }
      items.sort((a, b) => a.dueAt - b.dueAt);
      const now = Date.now();
      const lines = items.map((it, i) => {
        const id8 = it.id.slice(0, 8);
        const inMs = it.dueAt - now;
        const when = inMs > 0 ? `in ${reminder.formatRelative(inMs)}` : 'overdue';
        return `${i + 1}. \`${id8}\` (${when}) — ${it.text.slice(0, 80)}`;
      });
      return ctx.reply(
        [`⏰ *Pending reminders* (${items.length}/${reminder.MAX_PER_USER})`, '', ...lines].join(
          '\n',
        ),
      );
    }

    // ─── clear ────────────────────────────────────────────────────────
    if (VERBS_CLEAR.has(verb)) {
      const n = await reminder.clearAll(ctx.sender);
      await ctx.react('🧹');
      return ctx.reply(`🧹 Cleared *${n}* reminder${n === 1 ? '' : 's'}.`);
    }

    // ─── cancel <id> ──────────────────────────────────────────────────
    if (VERBS_CANCEL.has(verb)) {
      const id = rest.split(/\s+/)[0];
      if (!id) return ctx.reply('Usage: `.remindme cancel <id>`  (id from `.remindme list`)');
      const removed = await reminder.remove(ctx.sender, id);
      if (!removed) {
        return ctx.reply(`❓ No reminder matching \`${id}\`. Try \`.remindme list\`.`);
      }
      await ctx.react('🗑️');
      return ctx.reply(`🗑️ Cancelled: _${removed.text.slice(0, 80)}_`);
    }

    // ─── set: <duration> <message> ───────────────────────────────────
    const durationMs = reminder.parseDuration(verb);
    if (durationMs === null) {
      return ctx.reply(
        `❌ Couldn't parse *${verb}* as a duration.\n` +
          'Examples: `10s`, `5m`, `2h30m`, `1d`, `1w`.\n\n' +
          'Type `.remindme help` for full usage.',
      );
    }
    if (!rest) {
      return ctx.reply('❌ Missing reminder text. Example: `.remindme 5m grab laundry`');
    }

    let item;
    try {
      item = await reminder.add({
        userJid: ctx.sender,
        chat: ctx.chat,
        text: rest,
        durationMs,
      });
    } catch (err) {
      return ctx.reply(`❌ ${err.message}`);
    }

    await ctx.react('⏰');
    return ctx.reply(
      `⏰ *Reminder set*\n\n` +
        `*When:* in ${reminder.formatRelative(durationMs)}\n` +
        `*What:* ${rest.slice(0, 200)}\n` +
        `*ID:* \`${item.id.slice(0, 8)}\``,
    );
  },
};
