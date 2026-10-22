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
 *   recordRaw(provider, model, costUsd)                       -> { costUsd }
 *   admit(estimatedUsd)                                      -> reservation id
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

  'gpt-4o-mini-2024-07-18': [0.15, 0.6],
});

function priceFor(provider, model) {
  if (provider === 'local') return [0, 0];
  const price = config.ai?.pricing?.[`${provider}:${model}`] || PRICING[model];
  if (!price)
    throw Object.assign(new Error('Unknown AI model price; configure ai.pricing before use'), {
      code: 'EUNKNOWN_PRICE',
    });
  return price;
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

  return recordRaw(provider, model, costUsd, promptTokens, completionTokens);
}

let ledgerFault = false;
function accountingError() {
  return Object.assign(new Error('AI accounting unavailable; paid requests denied'), {
    code: 'EACCOUNTING',
  });
}

async function recordRaw(provider, model, costUsd, promptTokens = 0, completionTokens = 0) {
  if (![costUsd, promptTokens, completionTokens].every((v) => Number.isFinite(v) && v >= 0))
    throw accountingError();
  try {
    const store = getStore();
    if (!store || typeof store.recordAiUsage !== 'function') throw accountingError();
    const written = await store.recordAiUsage({
      day: todayUtc(),
      provider,
      model,
      promptTokens,
      completionTokens,
      costUsd,
    });
    if (written !== true) throw accountingError();
  } catch {
    // Do not allow a missing ledger write to turn spent money back into free
    // capacity. Repair/reconcile the ledger before restarting this process.
    ledgerFault = true;
    logger.error({ provider, model }, 'AI ledger write failed; blocking further paid requests');
    throw accountingError();
  }
  return { costUsd };
}

/** Missing/zero metering on a non-local call is not evidence the call was free.
 * Keep a clearly labelled estimate in the ledger for later reconciliation.
 */
async function recordResponse(provider, model, usage, estimate) {
  try {
    priceFor(provider, model);
  } catch (error) {
    ledgerFault = true;
    throw error;
  }
  const prompt = usage?.promptTokens;
  const completion = usage?.completionTokens;
  if (
    provider !== 'local' &&
    (!Number.isFinite(prompt) || !Number.isFinite(completion) || prompt + completion <= 0)
  ) {
    return recordRaw(provider, `${model}:unmetered-estimate`, estimate);
  }
  return record(provider, model, prompt || 0, completion || 0);
}

async function todayTotalUsd() {
  try {
    const store = getStore();
    if (!store || typeof store.getAiUsageDayTotal !== 'function') throw accountingError();
    const total = await store.getAiUsageDayTotal(todayUtc());
    if (!Number.isFinite(total) || total < 0) throw accountingError();
    return total;
  } catch {
    throw accountingError();
  }
}

// ─── v1.5.0: in-flight cost reservations ────────────────────────────────
// Closes the race window where two concurrent requests both pass the cap
// check before either records its cost. We track pending reservations in
// a process-local Map; isOverCap() includes them in its total. The
// reservation is finalised (or released) when the LLM call returns.
//
// Each reservation uses an upper-bound estimate from the configured
// max_tokens × the most expensive model's completion price. Conservative
// by design — false positives (refusing a request that would have been
// fine) are better than letting the cap leak.

const _reservations = new Map(); // id -> { usd, ts }
let _resCounter = 0;

function _activeReservationsUsd() {
  let total = 0;
  for (const r of _reservations.values()) total += r.usd;
  return total;
}

/** Reserve `estimatedUsd` of the daily cap. Returns an opaque id used to
 *  release/finalise the reservation. Always call release() in a finally. */
function reserve(estimatedUsd) {
  const id = String(++_resCounter);
  _reservations.set(id, { usd: Math.max(0, Number(estimatedUsd) || 0), ts: Date.now() });
  return id;
}

/** Release a reservation made by reserve(). Idempotent. */
function release(id) {
  if (id != null) _reservations.delete(String(id));
}

/** Estimate the upper-bound USD cost of a single chat call given the
 *  configured max_tokens and the most expensive whitelisted model. */
function estimateMaxCostUsd(
  provider,
  model,
  {
    inputBytes = config.ai?.maxInputBytes || 65536,
    maxTokens = config.ai?.maxTokens || 800,
    rounds = 1,
  } = {},
) {
  const [pIn, pOut] = priceFor(provider, model);
  // UTF-8 bytes conservatively bound ordinary input token counts; allow extra
  // provider framing and all tool rounds. These remain configured price
  // estimates, NOT a guarantee about a provider's invoice/pricing changes.
  return (
    (((Number(inputBytes) + 2048) * pIn + Number(maxTokens) * pOut) * Number(rounds) * 1.2) /
    1_000_000
  );
}

let admission = Promise.resolve();
/** Serialize balance + in-flight + new-reservation admission in this process.
 * Multi-replica deployments need a shared transactional reservation ledger.
 */
function admit(estimatedUsd) {
  const result = admission.then(async () => {
    if (ledgerFault || !Number.isFinite(estimatedUsd) || estimatedUsd < 0) throw accountingError();
    const used = await todayTotalUsd();
    const cap = Number(config.ai?.costCapPerDayUsd) || 0;
    if (cap > 0 && used + _activeReservationsUsd() + estimatedUsd > cap) {
      throw Object.assign(new Error('Daily AI budget has insufficient capacity'), {
        code: 'ECOSTCAP',
      });
    }
    return reserve(estimatedUsd);
  });
  admission = result.catch(() => {});
  return result;
}

async function isOverCap() {
  if (ledgerFault) throw accountingError();
  const cap = Number(config.ai?.costCapPerDayUsd) || 0;
  if (!cap) return false;
  const used = await todayTotalUsd();
  const reserved = _activeReservationsUsd();
  return used + reserved >= cap;
}

// Test-only: clear all reservations (used by ai-rate-persist.test.js etc.)
function _resetReservationsForTests() {
  _reservations.clear();
  _resCounter = 0;
  ledgerFault = false;
  admission = Promise.resolve();
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
  recordRaw,
  recordResponse,
  admit,
  todayTotalUsd,
  isOverCap,
  summary,
  // v1.5.0 — reservation API
  reserve,
  release,
  estimateMaxCostUsd,
  _resetReservationsForTests,
  _reservedUsdForTests: _activeReservationsUsd,
};
