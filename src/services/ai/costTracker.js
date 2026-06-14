/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * AI cost tracker (v1.2.0).
 *
 * Pricing table is USD per 1 000 000 tokens [prompt, completion].
 * Rates updated 2026-06; check provider docs for changes.
 *
 *   record(provider, model, promptTokens, completionTokens)   -> { costUsd }
 *   todayTotalUsd()                                          -> Promise<number>
 *   isOverCap()                                              -> Promise<boolean>
 *   summary({ days })                                        -> Promise<array>
 *
 * Local (Ollama) models are hard-coded to $0.
 */
const logger = require('../../core/logger').child({ mod: 'ai/cost' });
const { config } = require('../../lib/configLoader');
const { getStore } = require('../../store/instance');

const PRICING = Object.freeze({
  // OpenAI
  'gpt-4o-mini': [0.15, 0.6],
  'gpt-4o': [2.5, 10.0],
  'gpt-4o-2024-08-06': [2.5, 10.0],
  'gpt-4-turbo': [10.0, 30.0],
  'o1-mini': [3.0, 12.0],
  'o3-mini': [1.1, 4.4],

  // Gemini
  'gemini-2.0-flash': [0.1, 0.4],
  'gemini-2.0-flash-001': [0.1, 0.4],
  'gemini-2.0-flash-exp': [0.1, 0.4],
  'gemini-1.5-flash': [0.075, 0.3],
  'gemini-1.5-pro': [1.25, 5.0],

  // Anthropic
  'claude-3-5-haiku-latest': [0.8, 4.0],
  'claude-3-5-haiku-20241022': [0.8, 4.0],
  'claude-3-5-sonnet-latest': [3.0, 15.0],
  'claude-3-5-sonnet-20241022': [3.0, 15.0],
  'claude-3-opus-latest': [15.0, 75.0],

  // Fallback
  __default: [0.15, 0.6],
});

function priceFor(provider, model) {
  if (provider === 'local') return [0, 0];
  return PRICING[model] || PRICING.__default;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Compute USD cost from token counts and write a row to ai_usage_daily.
 * @returns {{ costUsd: number }}
 */
async function record(provider, model, promptTokens = 0, completionTokens = 0) {
  const [pIn, pOut] = priceFor(provider, model);
  const costUsd =
    ((Number(promptTokens) || 0) * pIn) / 1_000_000 +
    ((Number(completionTokens) || 0) * pOut) / 1_000_000;

  try {
    const store = getStore();
    if (store && typeof store.recordAiUsage === 'function') {
      await store.recordAiUsage({
        day: todayUtc(),
        provider,
        model,
        promptTokens,
        completionTokens,
        costUsd,
      });
    }
  } catch (e) {
    logger.warn({ err: e, provider, model }, 'recordAiUsage write failed (continuing)');
  }
  return { costUsd };
}

async function todayTotalUsd() {
  try {
    const store = getStore();
    if (!store || typeof store.getAiUsageDayTotal !== 'function') return 0;
    return await store.getAiUsageDayTotal(todayUtc());
  } catch (e) {
    logger.warn({ err: e }, 'todayTotalUsd failed');
    return 0;
  }
}

async function isOverCap() {
  const cap = Number(config.ai?.costCapPerDayUsd) || 0;
  if (!cap) return false;
  const used = await todayTotalUsd();
  return used >= cap;
}

async function summary({ days = 7 } = {}) {
  try {
    const store = getStore();
    if (!store || typeof store.getAiUsageByDay !== 'function') return [];
    return await store.getAiUsageByDay(days);
  } catch (e) {
    logger.warn({ err: e }, 'summary failed');
    return [];
  }
}

module.exports = {
  PRICING,
  priceFor,
  record,
  todayTotalUsd,
  isOverCap,
  summary,
};
