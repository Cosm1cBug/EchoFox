/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .mute — chat-local mute list (admin-only, group-only).
 *
 * The bot ignores muted users' COMMANDS in this group until the mute
 * expires. Their other messages are not deleted or interfered with;
 * this is a soft mute targeted at bot misuse, not group moderation.
 *
 *   .mute @user [duration] [reason]
 *   .mute @user 30m                       — mute for 30 min
 *   .mute @user 2h spamming .ai           — mute for 2h with reason
 *   .mute @user 60                        — bare number = minutes (60m)
 *   .mute @user                           — defaults to 30 min
 *   .mute list                            — show all current mutes in this group
 *   .mute clear @user                     — manually unmute
 *
 * Duration grammar: <integer>[s|m|h|d]   (1m min, 7d max)
 *
 * State is in-memory only (cleared on bot restart) — same rationale as
 * AFK in v1.6.0: persistence would create stuck-mute states overnight.
 */

const muteSvc = require('../../services/muteService');

const VERBS_LIST = new Set(['list', 'ls', 'show', '-list', '--list']);
const VERBS_CLEAR = new Set(['clear', 'unmute', 'rm', 'remove']);

const DEFAULT_DURATION_MS = 30 * 60 * 1000;

function pickFirstMention(ctx) {
  const m = ctx.mentions || [];
  return m.length ? m[0] : null;
}

function asShort(jid) {
  return (jid || '').split('@')[0];
}

module.exports = {
  name: 'mute',
  alias: ['silence', 'quiet'],
  desc: "Soft-mute a group member's bot commands for a duration.",
  category: 'group',
  type: 'group',
  group: true,
  needsMetadata: true,
  usage: '@user [duration=30m] [reason] | list | clear @user',
  cooldown: 2,

  async start(sock, m, { ctx, metadata, text }) {
    // Caller must be group admin
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);
    if (!caller?.admin) {
      return ctx.reply('🔒 Only group admins can mute users.');
    }

    const raw = String(text || '').trim();
    const tokens = raw.split(/\s+/).filter(Boolean);
    const verb = tokens[0]?.toLowerCase() || '';

    // ─── .mute list ───────────────────────────────────────────────────
    if (VERBS_LIST.has(verb)) {
      const items = muteSvc.list(ctx.chat);
      if (!items.length) {
        return ctx.reply('📭 No users muted in this group.');
      }
      items.sort((a, b) => a.until - b.until);
      const lines = items.map((it) => {
        const left = muteSvc.fmtDuration(it.until - Date.now());
        const reason = it.reason ? ` — _${it.reason}_` : '';
        return `• @${asShort(it.user)} (${left} left)${reason}`;
      });
      return ctx.reply([`🔇 *Muted users* (${items.length})`, '', ...lines].join('\n'), {
        mentions: items.map((it) => it.user),
      });
    }

    // ─── .mute clear @user ────────────────────────────────────────────
    if (VERBS_CLEAR.has(verb)) {
      const target = pickFirstMention(ctx);
      if (!target) return ctx.reply('Usage: `.mute clear @user`');
      const was = muteSvc.unmute(ctx.chat, target);
      await ctx.react(was ? '🔊' : 'ℹ️');
      return ctx.reply(
        was ? `🔊 Unmuted @${asShort(target)}.` : `ℹ️ @${asShort(target)} wasn't muted.`,
        { mentions: [target] },
      );
    }

    // ─── default: .mute @user [duration] [reason] ─────────────────────
    const target = pickFirstMention(ctx);
    if (!target) {
      return ctx.reply(
        '🔇 *Mute*\n\n' +
          'Usage:\n' +
          '• `.mute @user` — mute for 30 min\n' +
          '• `.mute @user 2h spamming` — mute with reason\n' +
          '• `.mute @user 60` — bare number = minutes\n' +
          '• `.mute list` — show all muted users\n' +
          '• `.mute clear @user` — unmute',
      );
    }

    // Refuse self-mute (silly) and admin-mute (someone else's admin)
    if (target === ctx.sender) {
      return ctx.reply("🤔 You can't mute yourself.");
    }
    const targetParticipant = metadata?.participants?.find((p) => p.id === target);
    if (targetParticipant?.admin) {
      return ctx.reply('🚫 Refusing to mute another admin.');
    }

    // Extract duration + reason from the remaining tokens (skip the @-mention)
    const rest = tokens.filter((t) => !t.startsWith('@')).slice(0); // strip leading verb? no — already a mention-form
    // The first non-@ token may be a duration. Everything after = reason.
    let durationMs = DEFAULT_DURATION_MS;
    let reason = '';
    if (rest.length) {
      const parsed = muteSvc.parseDuration(rest[0]);
      if (parsed !== null) {
        durationMs = parsed;
        reason = rest.slice(1).join(' ').trim();
      } else {
        reason = rest.join(' ').trim();
      }
    }

    const until = muteSvc.mute(ctx.chat, target, durationMs, {
      by: ctx.sender,
      reason,
    });
    const left = muteSvc.fmtDuration(until - Date.now());
    await ctx.react('🔇');
    return ctx.reply(
      `🔇 *Muted @${asShort(target)}* for ${left}` +
        (reason ? `\n*Reason:* ${reason}` : '') +
        '\n\n_Their bot commands will be ignored in this group until the mute expires._',
      { mentions: [target] },
    );
  },
};
