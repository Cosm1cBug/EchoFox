/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ask <question> — one-shot AI query.
 *
 *   .ask what's the capital of France?
 *   .ask  (replying to a message)  → answers about / using that message
 *
 * Differences from `.ai` (control surface) and `ai.chat()` (full mode):
 *   • Works without ambient opt-in, but honors explicit `.ai off`.
 *   • Does NOT touch conversation memory (calls provider directly).
 *   • Honours the v1.5.0 cost-cap + reservation pattern.
 *
 * Same provider-resolution rules as `.summarize` (v1.7.0) — uses the
 * configured default provider/model.
 */

const ai = require('../../services/ai');
const { config } = require('../../lib/configLoader');

const MAX_QUESTION_LEN = 2000;

module.exports = {
  name: 'ask',
  alias: ['askme', 'aiq'],
  desc: 'One-shot AI query (no memory, honors explicit opt-out).',
  category: 'general',
  type: 'general',
  usage: '<question | (reply to message + extra prompt)>',
  cooldown: 10,
  timeout: 60,

  async start(sock, m, { ctx, text }) {
    if (!config.ai?.enabled) {
      return ctx.reply('🤖 AI is disabled. Ask an admin to enable it in config.');
    }

    const userText = String(text || '').trim();
    const quoted = ctx.quoted?.text || '';

    // Combine inputs: explicit text + quoted context if both given,
    // either alone if only one given, friendly error if neither.
    let prompt;
    if (userText && quoted) {
      prompt =
        `User's question:\n${userText}\n\n` +
        `Context (quoted message):\n"""\n${quoted.slice(0, 4000)}\n"""`;
    } else if (userText) {
      prompt = userText;
    } else if (quoted) {
      prompt = `Please respond to this message:\n"""\n${quoted.slice(0, 4000)}\n"""`;
    } else {
      return ctx.reply(
        '🤖 *Ask AI*\n\n' +
          'Usage:\n' +
          '• `.ask <question>` — ask anything\n' +
          '• reply-to-message + `.ask <follow-up>` — ask about that message',
      );
    }

    if (prompt.length > MAX_QUESTION_LEN) {
      return ctx.reply(`❌ Question too long (max ${MAX_QUESTION_LEN} chars).`);
    }

    const resp = await ai.oneShot({
      sock,
      ctx,
      system:
        'You are a helpful assistant inside a WhatsApp bot. Be concise (2–6 short paragraphs max). Use plain text. If unsure, say so.',
      prompt,
      maxTokens: 1024,
      temperature: 0.4,
    });
    const answer = (resp.content || '').trim() || '_(empty response)_';
    return ctx.reply(`🧠 ${answer}`);
  },
};
