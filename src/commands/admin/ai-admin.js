/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * $ai — admin AI control surface.
 *
 *   $ai stats [days]                → token + cost summary (default 7 days)
 *   $ai chats                       → list opted-in chats
 *   $ai limit set <usd>             → live override of cost cap (until restart)
 *   $ai limit get                   → show current cap + today's spend
 *   $ai enable                      → flip config.ai.enabled = true (process-local)
 *   $ai disable                     → flip config.ai.enabled = false (process-local)
 *
 * For persistent changes the admin must edit config.js — these commands
 * only mutate the live in-memory config (via configLoader.__testOverride).
 */
const { getStore } = require('../../store/instance');
const ai = require('../../services/ai');
const { config, __testOverride } = require('../../lib/configLoader');

function _fmtUsd(n) {
  if (typeof n !== 'number' || isNaN(n)) return '$0.000000';
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

module.exports = {
  name: 'ai-admin',
  alias: ['aiadmin'],
  desc: '(admin) AI ops: stats / chats / limit / enable / disable',
  category: 'admin',
  admin: true,
  cooldown: 2,

  async start(sock, m, { ctx, args }) {
    const sub = (args[0] || 'stats').toLowerCase();
    const store = getStore();

    if (sub === 'stats') {
      const days = Math.max(1, Math.min(90, Number(args[1]) || 7));
      const rows = await ai.cost.summary({ days });
      if (!rows.length) return ctx.reply('📊 No AI usage recorded yet.');
      const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
      const totalPrompt = rows.reduce((s, r) => s + Number(r.prompt_tokens || 0), 0);
      const totalComp = rows.reduce((s, r) => s + Number(r.completion_tokens || 0), 0);
      const totalCalls = rows.reduce((s, r) => s + Number(r.calls || 0), 0);
      const lines = [
        `📊 *AI usage* — last ${days} day(s)`,
        `*Total spend:* ${_fmtUsd(totalCost)}`,
        `*Total tokens:* ${totalPrompt + totalComp}  (${totalPrompt} in / ${totalComp} out)`,
        `*Calls:* ${totalCalls}`,
        '',
        '*Daily breakdown:*',
      ];
      for (const r of rows.slice(0, 14)) {
        lines.push(`  ${r.day}  ${_fmtUsd(Number(r.cost_usd))}  · ${r.calls || 0} calls`);
      }
      return ctx.reply(lines.join('\n'));
    }

    if (sub === 'chats') {
      const rows = (store?.listAiOptedInChats ? await store.listAiOptedInChats(50) : []) || [];
      if (!rows.length) return ctx.reply('👥 No chats have AI opt-in records yet.');
      const lines = [`👥 *AI opt-in chats* (${rows.length}):`];
      for (const r of rows) {
        const state = r.enabled ? '✅' : '⛔';
        const tag = [r.persona, r.provider, r.model].filter(Boolean).join('/');
        lines.push(`${state} ${r.chatJid}${tag ? `  _(${tag})_` : ''}`);
      }
      return ctx.reply(lines.join('\n'));
    }

    if (sub === 'limit') {
      const action = (args[1] || 'get').toLowerCase();
      if (action === 'get') {
        const used = await ai.cost.todayTotalUsd();
        return ctx.reply(
          [
            `💰 *AI daily cost cap*`,
            `*Cap:*  ${_fmtUsd(Number(config.ai?.costCapPerDayUsd) || 0)}`,
            `*Used today:* ${_fmtUsd(used)}`,
          ].join('\n'),
        );
      }
      if (action === 'set') {
        const v = Number(args[2]);
        if (!isFinite(v) || v < 0)
          return ctx.reply('Usage: `$ai limit set <usd>` (e.g. `$ai limit set 10`)');
        __testOverride({ ai: { ...(config.ai || {}), costCapPerDayUsd: v } });
        return ctx.reply(
          `✅ Cost cap set to ${_fmtUsd(v)} (in-memory; edit config.js for persistence).`,
        );
      }
      return ctx.reply('Usage: `$ai limit get` or `$ai limit set <usd>`');
    }

    if (sub === 'enable' || sub === 'disable') {
      __testOverride({ ai: { ...(config.ai || {}), enabled: sub === 'enable' } });
      return ctx.reply(`✅ AI globally ${sub === 'enable' ? 'enabled' : 'disabled'} (in-memory).`);
    }

    return ctx.reply(
      [
        '🤖 *AI admin*',
        '`$ai stats [days]`',
        '`$ai chats`',
        '`$ai limit get`',
        '`$ai limit set <usd>`',
        '`$ai enable` / `$ai disable`',
      ].join('\n'),
    );
  },
};
