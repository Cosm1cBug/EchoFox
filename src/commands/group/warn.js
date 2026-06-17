/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .warn — group-admin warn system with auto-kick at threshold.
 *
 *   .warn @user [reason]                      → add a warning
 *   .warn list [@user]                        → list warnings (one user or all)
 *   .warn remove @user <id-or-index>          → remove one specific warning
 *   .warn clear @user                         → clear all warnings for a user
 *   .warn config                              → show config (current threshold)
 *   .warn config threshold <N>                → set auto-kick threshold (1..20)
 *
 * Aliases:
 *   `.warnings` and `.warns` behave like `.warn list` when used bare.
 *
 * Behaviour:
 *   • Caller must be a group admin.
 *   • When the count of warnings ≥ threshold, the bot tries to kick the
 *     user (sock.groupParticipantsUpdate(..., 'remove')) AND clears the
 *     warn list for that user. Kick requires bot is also a group admin.
 *
 * Storage: src/services/warnService.js (rides existing subscriber_meta).
 */

const warnSvc = require('../../services/warnService');

const VERB_LIST = new Set(['list', 'ls', '-list', '--list', 'show', 'status']);
const VERB_REMOVE = new Set(['remove', 'rm', 'del', 'delete']);
const VERB_CLEAR = new Set(['clear', 'pardon', 'reset']);
const VERB_CONFIG = new Set(['config', 'cfg', 'set']);

function pickFirstMention(ctx) {
  const m = ctx.mentions || [];
  return m.length ? m[0] : null;
}

function asShort(jid) {
  return (jid || '').split('@')[0];
}

function fmtAge(tsSec) {
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

function helpPanel() {
  return [
    '🚨 *Warn system*',
    '',
    '• `.warn @user [reason]`        — add a warning',
    '• `.warn list`                  — show all warned users',
    '• `.warn list @user`            — show one user’s warnings',
    '• `.warn remove @user <id>`     — remove one warning',
    '• `.warn clear @user`           — clear all warnings',
    '• `.warn config`                — show threshold',
    '• `.warn config threshold <N>`  — set auto-kick threshold (1–20)',
    '',
    `_Default threshold:_ ${warnSvc.DEFAULT_THRESHOLD}  ·  _max per user:_ ${warnSvc.MAX_WARNS_PER_USER}`,
  ].join('\n');
}

module.exports = {
  name: 'warn',
  alias: ['warning', 'warnings', 'warns'],
  desc: 'Group-admin warn system with auto-kick at threshold.',
  category: 'group',
  type: 'group',
  group: true,
  needsMetadata: true,
  usage: '@user [reason] | list [@user] | remove @user <id> | clear @user | config [threshold N]',
  cooldown: 2,

  async start(sock, m, { ctx, metadata, text, command }) {
    // ─── permission gate ─────────────────────────────────────────────
    const caller = metadata?.participants?.find((p) => p.id === ctx.sender);
    if (!caller?.admin) {
      return ctx.reply('🔒 Only group admins can use the warn system.');
    }

    const raw = String(text || '').trim();
    const tokens = raw.split(/\s+/).filter(Boolean);
    const verb = tokens[0]?.toLowerCase() || '';
    const calledAsList = command === 'warnings' || command === 'warns';

    // ─── .warnings / .warns (bare) → list mode ───────────────────────
    if (calledAsList && !verb) {
      return await listAll(ctx, metadata);
    }
    if (calledAsList && tokens.length) {
      // .warnings @user → list one user
      const target = pickFirstMention(ctx);
      if (target) return await listOne(ctx, metadata, target);
    }

    // ─── help / status with no args ──────────────────────────────────
    if (!raw) return ctx.reply(helpPanel());

    // ─── .warn list ──────────────────────────────────────────────────
    if (VERB_LIST.has(verb)) {
      const target = pickFirstMention(ctx);
      if (target) return await listOne(ctx, metadata, target);
      return await listAll(ctx, metadata);
    }

    // ─── .warn config [...] ──────────────────────────────────────────
    if (VERB_CONFIG.has(verb)) {
      return await handleConfig(ctx, tokens.slice(1));
    }

    // ─── .warn clear @user ───────────────────────────────────────────
    if (VERB_CLEAR.has(verb)) {
      const target = pickFirstMention(ctx);
      if (!target) return ctx.reply('Usage: `.warn clear @user`');
      const n = await warnSvc.clearWarns(ctx.chat, target);
      await ctx.react('🧹');
      return ctx.reply(
        `🧹 Cleared *${n}* warning${n === 1 ? '' : 's'} for @${asShort(target)}.`,
        // mentions kept in reply
      );
    }

    // ─── .warn remove @user <id> ─────────────────────────────────────
    if (VERB_REMOVE.has(verb)) {
      const target = pickFirstMention(ctx);
      const idTok = tokens.find(
        (t, i) => i > 0 && !t.startsWith('@') && !VERB_REMOVE.has(t.toLowerCase()),
      );
      if (!target || !idTok) {
        return ctx.reply('Usage: `.warn remove @user <id-or-index>`');
      }
      const removed = await warnSvc.removeWarn(ctx.chat, target, idTok);
      if (!removed) {
        return ctx.reply(`❓ No warning matching \`${idTok}\` for @${asShort(target)}.`);
      }
      await ctx.react('🗑️');
      return ctx.reply(`🗑️ Removed warning \`${removed.id}\` for @${asShort(target)}.`);
    }

    // ─── default: .warn @user [reason] ───────────────────────────────
    const target = pickFirstMention(ctx);
    if (!target) {
      return ctx.reply('Usage: `.warn @user [reason]`');
    }
    // strip the leading @<jid> from reason text
    const reason = tokens
      .filter((t) => !t.startsWith('@'))
      .join(' ')
      .trim();

    const { count, threshold, item } = await warnSvc.addWarn(ctx.chat, target, {
      reason,
      byJid: ctx.sender,
    });
    await ctx.react('⚠️');

    // ─── auto-kick if at threshold ───────────────────────────────────
    if (count >= threshold) {
      // Make sure bot is admin in the group
      const botJid = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
      const me = metadata?.participants?.find((p) => p.id === botJid);
      if (!me?.admin) {
        return ctx.reply(
          `⚠️ @${asShort(target)} is now at *${count}/${threshold}* warnings — but I'm not a group admin, so I can't auto-kick.`,
          { mentions: [target] },
        );
      }
      try {
        await sock.groupParticipantsUpdate(ctx.chat, [target], 'remove');
        await warnSvc.clearWarns(ctx.chat, target);
        return ctx.reply(
          `🚫 *Auto-kicked* @${asShort(target)} (reached ${count}/${threshold} warnings).\n` +
            `*Latest reason:* ${item.reason}`,
          { mentions: [target] },
        );
      } catch (err) {
        return ctx.reply(
          `⚠️ Tried to kick @${asShort(target)} (at ${count}/${threshold}) but failed: ${err.message}`,
          { mentions: [target] },
        );
      }
    }

    return ctx.reply(
      `⚠️ Warned @${asShort(target)} (${count}/${threshold})\n` +
        `*Reason:* ${item.reason}\n` +
        `*ID:* \`${item.id}\``,
      { mentions: [target] },
    );
  },
};

/* ─── list helpers ────────────────────────────────────────────────── */

async function listOne(ctx, metadata, userJid) {
  const { threshold, warns } = await warnSvc.listWarns(ctx.chat, userJid);
  if (!warns.length) {
    return ctx.reply(`📭 @${asShort(userJid)} has *no* warnings.  _(threshold ${threshold})_`, {
      mentions: [userJid],
    });
  }
  const lines = warns.map((w, i) => `${i + 1}. \`${w.id}\`  ${fmtAge(w.ts)}  — ${w.reason}`);
  return ctx.reply(
    [`⚠️ *Warnings for @${asShort(userJid)}* (${warns.length}/${threshold})`, '', ...lines].join(
      '\n',
    ),
    { mentions: [userJid] },
  );
}

async function listAll(ctx, _metadata) {
  const { threshold, users } = await warnSvc.listAllWarns(ctx.chat);
  const entries = Object.entries(users).filter(([, list]) => list && list.length);
  if (!entries.length) {
    return ctx.reply(`📭 No warned users in this group.  _(threshold ${threshold})_`);
  }
  entries.sort((a, b) => b[1].length - a[1].length);
  const mentions = [];
  const lines = entries.map(([jid, list]) => {
    mentions.push(jid);
    return `• @${asShort(jid)} — *${list.length}/${threshold}*`;
  });
  return ctx.reply([`⚠️ *Warned users* (threshold ${threshold})`, '', ...lines].join('\n'), {
    mentions,
  });
}

/* ─── config helpers ──────────────────────────────────────────────── */

async function handleConfig(ctx, args) {
  const sub = args[0]?.toLowerCase();
  if (!sub) {
    const { threshold } = await warnSvc.getMeta(ctx.chat);
    return ctx.reply(
      `⚙️ *Warn config*\n\n*Threshold:* ${threshold}\n\n` +
        '`.warn config threshold <N>` to change (1–20)',
    );
  }
  if (sub === 'threshold') {
    const n = parseInt(args[1], 10);
    if (!Number.isInteger(n)) {
      return ctx.reply('Usage: `.warn config threshold <N>`  (1–20)');
    }
    try {
      const newT = await warnSvc.setThreshold(ctx.chat, n);
      return ctx.reply(`✅ Threshold set to *${newT}*.`);
    } catch (err) {
      return ctx.reply(`❌ ${err.message}`);
    }
  }
  return ctx.reply(`Unknown config sub-verb *${sub}*. Try \`.warn config\` for help.`);
}
