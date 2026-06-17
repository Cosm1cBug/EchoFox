/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .summarize — AI-powered one-shot summary.
 *
 *   .summarize                  → summarise the last 50 messages in this chat
 *   .summarize 100              → summarise the last 100 messages (cap: 200)
 *   .summarize  (reply-to)      → summarise the quoted message instead
 *
 * Differences from `.ai`:
 *   • Bypasses the per-chat opt-in (no need for `.ai on`).
 *   • Does NOT pollute conversation memory (calls the provider directly,
 *     never goes through ai.chat()).
 *   • Respects the global daily cost cap (cost.isOverCap()) and reserves
 *     a maximum-cost estimate up-front like ai.chat() does (v1.5.0).
 *   • Group-aware: in a group, anyone can summarise; in DM, the sender's
 *     own recent messages are pulled.
 *
 * Source data: We pull from the store's message history table (rich
 * message ledger captured by Group C events). Requires the bot has been
 * running with message-capping events enabled long enough to have data.
 *
 * Limits:
 *   • Reject `> 200` messages requested (token-budget safety).
 *   • Truncate each message to 500 chars (long-paste safety).
 *   • Reject if the resulting prompt exceeds 32 KB before sending.
 */

const ai = require('../../services/ai');
const { config } = require('../../lib/configLoader');
const { getStore } = require('../../store/instance');

const DEFAULT_N = 50;
const MAX_N = 200;
const MAX_MSG_CHARS = 500;
const MAX_PROMPT_BYTES = 32 * 1024;

function pickText(msg) {
  // Best-effort plain-text extraction from a stored message row.
  // Shape varies by store backend; common fields tried below.
  if (!msg) return '';
  return (
    msg.body ||
    msg.text ||
    msg.content ||
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  );
}

function pickSender(msg) {
  return msg.sender || msg.from || msg.participant || msg.author || 'unknown';
}

module.exports = {
  name: 'summarize',
  alias: ['sum', 'tldr', 'recap'],
  desc: 'AI summary of recent messages (or replied message).',
  category: 'general',
  type: 'general',
  usage: '[N | (reply to message)]',
  cooldown: 30,
  timeout: 90,

  async start(sock, m, { ctx, text }) {
    if (!config.ai?.enabled) {
      return ctx.reply('🤖 AI is disabled. Ask an admin to enable it in config.');
    }

    // ─── Path 1: reply-to mode — summarise the quoted message text ───
    if (ctx.quoted?.text && ctx.quoted.text.length > 200) {
      return await summariseText(ctx, ctx.quoted.text, {
        kind: 'message',
        source: `quoted message (${ctx.quoted.text.length} chars)`,
      });
    }

    // ─── Path 2: chat-history mode ───────────────────────────────────
    const requestedN = Math.max(1, Math.min(MAX_N, parseInt(text, 10) || DEFAULT_N));

    const store = getStore();
    let rows;
    try {
      // The store API surface for "recent messages in a chat" varies a bit
      // by backend. Try the canonical method first; fall back gracefully.
      if (typeof store.getRecentMessages === 'function') {
        rows = await store.getRecentMessages(ctx.chat, requestedN);
      } else if (typeof store.getMessages === 'function') {
        rows = await store.getMessages(ctx.chat, { limit: requestedN });
      } else {
        return ctx.reply(
          '❌ This store backend does not expose recent-message history. ' +
            'Reply to a specific message with `.summarize` instead.',
        );
      }
    } catch (err) {
      return ctx.reply(`❌ Could not load chat history: ${err.message}`);
    }

    if (!rows || !rows.length) {
      return ctx.reply(
        '📭 No recent messages available to summarise. ' +
          'Either the chat is empty, or message persistence is disabled.',
      );
    }

    const lines = rows
      .map((r) => {
        const who = pickSender(r).split('@')[0];
        const body = pickText(r).slice(0, MAX_MSG_CHARS).replace(/\s+/g, ' ').trim();
        return body ? `${who}: ${body}` : '';
      })
      .filter(Boolean);

    if (!lines.length) {
      return ctx.reply('📭 No textual content in the recent message window.');
    }

    const transcript = lines.join('\n');
    return await summariseText(ctx, transcript, {
      kind: 'transcript',
      source: `last ${lines.length} messages`,
    });
  },
};

/**
 * Common-path summariser. Calls the configured provider directly so
 * conversation memory is NOT mutated. Honours the v1.5.0 cost-cap +
 * reservation pattern.
 */
async function summariseText(ctx, payload, { kind, source }) {
  if (Buffer.byteLength(payload, 'utf8') > MAX_PROMPT_BYTES) {
    return ctx.reply(`❌ Prompt too large (max ${MAX_PROMPT_BYTES / 1024} KB). Try a smaller N.`);
  }

  const cost = ai.cost;
  if (await cost.isOverCap()) {
    return ctx.reply('💸 Daily AI cost cap reached. Try again tomorrow.');
  }

  const aiCfg = require('../../lib/configLoader').config.ai || {};
  const providerName = aiCfg.defaultProvider || 'openai';
  const model = aiCfg.model || 'gpt-4o-mini';
  const provider = ai.providers[providerName];
  if (!provider) {
    return ctx.reply(`❌ Unknown AI provider: ${providerName}`);
  }

  const reservationId = cost.reserve(cost.estimateMaxCostUsd(providerName, model));

  await ctx.react('🧠');

  const systemPrompt =
    kind === 'transcript'
      ? 'You summarise WhatsApp group/chat transcripts. Output 3–7 concise bullet ' +
        'points capturing the key topics, decisions, action items, and any open ' +
        'questions. Mention specific participants by their short id when relevant. ' +
        'Be neutral, factual, and skip greetings/small-talk. Plain text — no markdown headings.'
      : 'You summarise a single message in 3–5 short bullet points. Capture the main ' +
        'claim, any supporting facts, and any explicit asks. Plain text — no markdown headings.';

  const userTurn =
    kind === 'transcript'
      ? `Summarise the following chat transcript:\n\n${payload}`
      : `Summarise the following message:\n\n${payload}`;

  try {
    const resp = await provider.chat({
      system: systemPrompt,
      history: [{ role: 'user', content: userTurn }],
      tools: [],
      model,
      maxTokens: Math.min(aiCfg.maxTokens || 1024, 1024),
      temperature: 0.3,
    });

    await cost.record(
      providerName,
      resp.model || model,
      resp.usage?.promptTokens || 0,
      resp.usage?.completionTokens || 0,
    );

    const summary = (resp.content || '').trim() || '_(empty response)_';
    return ctx.reply(`🧠 *Summary — ${source}*\n\n${summary}`);
  } finally {
    cost.release(reservationId);
  }
}
