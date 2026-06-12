/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ai — per-chat AI control surface (v1.2.0).
 *
 *   .ai                                 → show current status
 *   .ai status                          → same
 *   .ai on                              → opt this chat in
 *   .ai off                             → opt this chat out
 *   .ai clear                           → forget conversation memory for this chat
 *   .ai persona <threat-intel|general|custom>
 *   .ai provider <openai|gemini|anthropic|local>
 *   .ai model <name>
 *
 * Per-chat overrides are stored in ai_chat_opt_in via
 * store.setAiChatOptIn(). Provider/model overrides are honoured by
 * ai.chat() when computing the request payload.
 *
 * The command itself does NOT generate a reply via the LLM — to chat
 * with the bot, just send any non-command text in an opted-in chat.
 */
const { getStore } = require('../../store/instance');
const ai = require('../../services/ai');

const HELP = [
  '🤖 *EchoFox AI*',
  '',
  '`.ai`               – show status',
  '`.ai on`            – enable AI replies in this chat',
  '`.ai off`           – disable AI replies in this chat',
  '`.ai clear`         – forget conversation memory',
  '`.ai persona <p>`   – threat-intel | general | custom',
  '`.ai provider <p>`  – openai | gemini | anthropic | local',
  '`.ai model <name>`  – override the default model',
].join('\n');

async function _statusReply(ctx, chatJid, config) {
  const store = getStore();
  let opt = null;
  try { opt = await store?.getAiChatOptIn?.(chatJid); } catch (_) { /* ignore */ }

  const eff = {
    enabled:   opt?.enabled ?? (config.ai?.optInDefault === 'on'),
    persona:   opt?.persona  || config.ai?.persona  || 'threat-intel',
    provider:  opt?.provider || config.ai?.defaultProvider || 'openai',
    model:     opt?.model    || config.ai?.model    || 'gpt-4o-mini',
  };

  const globalEnabled = !!config.ai?.enabled;
  const lines = [
    '🤖 *EchoFox AI*',
    `*Global enabled:*   ${globalEnabled ? '✅' : '❌ (admin must enable in config)'}`,
    `*This chat:*        ${eff.enabled ? '✅ on' : '❌ off'}`,
    `*Persona:*          ${eff.persona}`,
    `*Provider / model:* ${eff.provider} / ${eff.model}`,
    `*Memory turns:*     ${config.ai?.memoryTurns ?? 20}`,
    `*Tool calling:*     ${config.ai?.enableToolCalling ? '✅' : '❌'}`,
  ];
  if (typeof config.ai?.costCapPerDayUsd === 'number') {
    try {
      const used = await ai.cost.todayTotalUsd();
      lines.push(`*Cost today:*       $${used.toFixed(6)} / $${Number(config.ai.costCapPerDayUsd).toFixed(2)}`);
    } catch (_) { /* ignore */ }
  }
  return ctx.reply(lines.join('\n'));
}

module.exports = {
  name: 'ai',
  alias: ['llm', 'gpt'],
  desc: 'Per-chat AI control: status / on / off / clear / persona / provider / model',
  category: 'general',
  cooldown: 2,

  async start(sock, m, { ctx, args, text, config }) {
    const chatJid = ctx.chat;
    const sub = (args[0] || '').toLowerCase();
    const arg1 = args.slice(1).join(' ').trim();

    const store = getStore();
    if (!store?.getAiChatOptIn || !store?.setAiChatOptIn) {
      return ctx.reply('🚧 AI features require a store that supports AI methods (sqlite v1.2.0+).');
    }

    if (!sub || sub === 'status' || sub === 'help') {
      if (sub === 'help') return ctx.reply(HELP);
      return _statusReply(ctx, chatJid, config);
    }

    if (sub === 'on' || sub === 'off') {
      const prev = await store.getAiChatOptIn(chatJid) || {};
      await store.setAiChatOptIn(chatJid, {
        enabled: sub === 'on',
        persona:  prev.persona  || null,
        provider: prev.provider || null,
        model:    prev.model    || null,
      });
      return ctx.reply(sub === 'on'
        ? '✅ AI replies *enabled* in this chat. Just send messages — no prefix needed.'
        : '🛑 AI replies *disabled* in this chat. Use `.ai on` to re-enable.');
    }

    if (sub === 'clear') {
      const ok = await ai.clearMemory(chatJid);
      return ctx.reply(ok ? '🧹 Conversation memory cleared for this chat.' : '⚠️ Failed to clear memory.');
    }

    if (sub === 'persona') {
      if (!arg1) return ctx.reply('Usage: `.ai persona <threat-intel|general|custom>`');
      if (!['threat-intel', 'general', 'custom'].includes(arg1)) {
        return ctx.reply('❌ Unknown persona. Pick: `threat-intel`, `general`, `custom`.');
      }
      const prev = await store.getAiChatOptIn(chatJid) || {};
      await store.setAiChatOptIn(chatJid, { ...prev, persona: arg1 });
      return ctx.reply(`✅ Persona set to *${arg1}* for this chat.`);
    }

    if (sub === 'provider') {
      if (!arg1) return ctx.reply('Usage: `.ai provider <openai|gemini|anthropic|local>`');
      if (!['openai', 'gemini', 'anthropic', 'local'].includes(arg1)) {
        return ctx.reply('❌ Unknown provider. Pick: `openai`, `gemini`, `anthropic`, `local`.');
      }
      const prev = await store.getAiChatOptIn(chatJid) || {};
      await store.setAiChatOptIn(chatJid, { ...prev, provider: arg1 });
      return ctx.reply(`✅ Provider set to *${arg1}* for this chat.`);
    }

    if (sub === 'model') {
      if (!arg1) return ctx.reply('Usage: `.ai model <model-name>`');
      const prev = await store.getAiChatOptIn(chatJid) || {};
      await store.setAiChatOptIn(chatJid, { ...prev, model: arg1 });
      return ctx.reply(`✅ Model set to *${arg1}* for this chat.`);
    }

    return ctx.reply(HELP);
  },
};
