/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .explain — explain the replied-to message or arbitrary text.
 *
 *   .explain                              (reply to a message)
 *   .explain eli5                         (reply, explain like I'm 5)
 *   .explain code                         (reply, treat as code)
 *   .explain <some text inline>           (no reply needed)
 *
 * Modes (auto-detected when not specified):
 *   • `eli5`  — simple-words explanation
 *   • `code`  — line-by-line code explanation
 *   • `auto`  — generic explanation
 *
 * Same cost-cap + provider-resolution rules as `.ask` / `.summarize`.
 */

const ai = require('../../services/ai');
const { config } = require('../../lib/configLoader');

const MAX_INPUT_LEN = 4000;
const VERBS = new Set(['eli5', 'code', 'tech', 'auto']);

function looksLikeCode(s) {
  const codeishLines = (
    s.match(/^[ \t]*(const|let|var|function|class|def|import|#include|public|private)\b/gm) || []
  ).length;
  const braces = (s.match(/[{}();]/g) || []).length;
  const lines = Math.max(1, s.split('\n').length);
  return codeishLines >= 2 || braces / lines > 1.5;
}

function systemPrompt(mode) {
  if (mode === 'eli5') {
    return (
      'Explain the following content like the reader is 10 years old. Use ' +
      'simple words, short sentences, and a friendly analogy. No jargon. 4–8 sentences total.'
    );
  }
  if (mode === 'code') {
    return (
      'Explain the following code. Cover (1) what it does at a high level, ' +
      '(2) the main steps line-by-line or block-by-block, (3) any non-obvious ' +
      'gotchas or edge cases. Plain text, no markdown headings, no code re-paste.'
    );
  }
  // default — generic
  return (
    'Explain the following content clearly and concisely. ' +
    '3–6 short paragraphs. Plain text, no markdown headings. Skip preamble.'
  );
}

module.exports = {
  name: 'explain',
  alias: ['eli5', 'wat'],
  desc: 'AI explanation of a replied message or arbitrary text.',
  category: 'general',
  type: 'general',
  usage: '[eli5|code|auto] [text] | (reply to message)',
  cooldown: 10,
  timeout: 60,

  async start(sock, m, { ctx, text }) {
    if (!config.ai?.enabled) {
      return ctx.reply('🤖 AI is disabled. Ask an admin to enable it in config.');
    }

    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const maybeVerb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const hasVerb = VERBS.has(maybeVerb);
    const mode = hasVerb ? maybeVerb : null;
    const inline = hasVerb ? raw.slice(firstSpace + 1).trim() : raw;

    const quoted = ctx.quoted?.text || '';
    const payload = inline || quoted;
    if (!payload) {
      return ctx.reply(
        '🤖 *Explain*\n\n' +
          'Usage:\n' +
          '• reply to a message + `.explain`         (auto)\n' +
          '• reply to a message + `.explain eli5`   (simple words)\n' +
          '• reply to code     + `.explain code`   (line-by-line)\n' +
          '• `.explain <text>`                       (no reply needed)',
      );
    }
    if (payload.length > MAX_INPUT_LEN) {
      return ctx.reply(`❌ Input too long (max ${MAX_INPUT_LEN} chars).`);
    }

    const resolvedMode =
      mode === 'auto' || !mode ? (looksLikeCode(payload) ? 'code' : 'auto') : mode;

    const cost = ai.cost;
    if (await cost.isOverCap()) {
      return ctx.reply('💸 Daily AI cost cap reached. Try again tomorrow.');
    }

    const aiCfg = config.ai || {};
    const providerName = aiCfg.defaultProvider || 'openai';
    const model = aiCfg.model || 'gpt-4o-mini';
    const provider = ai.providers[providerName];
    if (!provider) {
      return ctx.reply(`❌ Unknown AI provider: ${providerName}`);
    }

    const reservationId = cost.reserve(cost.estimateMaxCostUsd(providerName, model));
    await ctx.react('🧠');

    try {
      const resp = await provider.chat({
        system: systemPrompt(resolvedMode),
        history: [{ role: 'user', content: payload }],
        tools: [],
        model,
        maxTokens: Math.min(aiCfg.maxTokens || 1024, 1024),
        temperature: 0.35,
      });

      await cost.record(
        providerName,
        resp.model || model,
        resp.usage?.promptTokens || 0,
        resp.usage?.completionTokens || 0,
      );

      const out = (resp.content || '').trim() || '_(empty response)_';
      const label =
        resolvedMode === 'code'
          ? '💻 Code explained'
          : resolvedMode === 'eli5'
            ? '🧒 Explained (ELI5)'
            : '🧠 Explained';
      return ctx.reply(`${label}\n\n${out}`);
    } finally {
      cost.release(reservationId);
    }
  },
};
