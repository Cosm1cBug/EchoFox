/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Typed metrics service.
 *
 *   Wraps the freeform `store.recordStat()` / `store.setGauge()` /
 *   `store.getStats()` APIs with type-safe helpers that:
 *     • prevent typos in metric names,
 *     • route to the correct table (counter vs gauge),
 *     • give callers obvious, documented function names,
 *     • compute derived gauges (uptime, unique users, group count) on read.
 *
 *   The store backend is injected via init() at boot, so this module is
 *   safe to require() from anywhere — calls before init() are no-ops
 *   (we drop on the floor with a warning) so test/dev code can't crash.
 */

const { COUNTERS, GAUGES, commandKey } = require('../store/schema/stats');
const logger = require('../core/logger').child({ mod: 'metrics' });

let store = null;
let startedAt = 0;

function init(injectedStore) {
  store = injectedStore;
  startedAt = Math.floor(Date.now() / 1000);
  setGauge('bot_started_at', startedAt);
  logger.info({ startedAt }, 'metrics initialised');
}

function _ensureStore(fnName) {
  if (!store) {
    logger.debug({ fn: fnName }, 'metrics call before init() — dropped');
    return false;
  }
  return true;
}

// ─── Counters ────────────────────────────────────────────────────────────
function inc(key, n = 1) {
  if (!_ensureStore('inc')) return;
  if (!COUNTERS.includes(key) && !key.startsWith('commands_per_name__')) {
    logger.warn({ key }, 'inc() called with unknown counter key — recording anyway');
  }
  try { store.recordStat?.(key, n); }
  catch (e) { logger.warn({ err: e, key }, 'inc failed'); }
}

// ─── Gauges ──────────────────────────────────────────────────────────────
function setGauge(key, value) {
  if (!_ensureStore('setGauge')) return;
  if (!GAUGES.includes(key)) {
    logger.warn({ key }, 'setGauge() called with unknown gauge key');
  }
  try { store.setGauge?.(key, value); }
  catch (e) { logger.warn({ err: e, key }, 'setGauge failed'); }
}

// ─── Convenience: messages ──────────────────────────────────────────────
function incReceived(n = 1) { inc('messages_received_total', n); }
function incSent(n = 1)     { inc('messages_sent_total', n); }

// ─── Convenience: commands ──────────────────────────────────────────────
/**
 * incCommand(name, outcome)
 *   outcome ∈ 'success' | 'failure' | 'timeout' | undefined
 *
 * Always increments `commands_total` AND the per-command counter.
 * If outcome is provided, also increments the matching outcome counter.
 */
function incCommand(name, outcome) {
  inc('commands_total');
  inc(commandKey(name));
  if (outcome === 'success') inc('commands_success_total');
  if (outcome === 'failure') inc('commands_failed_total');
  if (outcome === 'timeout') inc('commands_timeout_total');
}

// ─── Convenience: media ─────────────────────────────────────────────────
function incMediaDown(n = 1) { inc('media_downloaded_total', n); }
function incMediaUp(n = 1)   { inc('media_uploaded_total', n); }

// ─── Convenience: throttle hits ─────────────────────────────────────────
function incRateLimit(n = 1) { inc('rate_limit_hits_total', n); }
function incCooldown(n = 1)  { inc('cooldown_hits_total', n); }

// ─── v1.4.0: AI metrics ─────────────────────────────────────────────────
function incAiRequest(outcome) {
  inc('ai_chat_requests_total');
  if (outcome === 'failure') inc('ai_chat_requests_failed_total');
}
function incAiTokens(promptN = 0, completionN = 0) {
  if (promptN)     inc('ai_tokens_prompt_total',     Number(promptN) || 0);
  if (completionN) inc('ai_tokens_completion_total', Number(completionN) || 0);
}
function incAiTool(outcome) {
  inc('ai_tool_invocations_total');
  if (outcome === 'failure') inc('ai_tool_invocations_failed_total');
}
function incAiRateLimit()  { inc('ai_rate_limit_hits_total'); }
function incAiCostCapHit() { inc('ai_cost_cap_hits_total'); }
function setAiCostUsdToday(n) { setGauge('ai_cost_usd_today', Number(n) || 0); }
function setAiOptInChats(n)   { setGauge('ai_active_opt_in_chats', Number(n) || 0); }

// ─── v1.4.2: Signal protocol health ─────────────────────────────────────
function incDecryptionFailure()  { inc('signal_decryption_failures_total'); }
function incDecryptionRecovery() { inc('signal_session_recoveries_total'); }

// ─── v1.4.0: Telegram metrics ───────────────────────────────────────────
function incTelegramForward(outcome) {
  inc('telegram_forwards_total');
  if (outcome === 'dropped')  inc('telegram_forwards_dropped_total');
  if (outcome === 'failure')  inc('telegram_send_failures_total');
  if (outcome === 'retried')  inc('telegram_send_retries_total');
}
function setTelegramRoutedChannels(n) { setGauge('telegram_routed_channels', Number(n) || 0); }

// ─── Derived gauges (call periodically from worker / dashboard) ─────────
function refreshDerivedGauges({ groupsCount, uniqueUsersSeen } = {}) {
  if (!_ensureStore('refreshDerivedGauges')) return;
  setGauge('bot_uptime_seconds', Math.floor(Date.now() / 1000) - startedAt);
  if (typeof groupsCount === 'number')     setGauge('groups_count', groupsCount);
  if (typeof uniqueUsersSeen === 'number') setGauge('unique_users_seen', uniqueUsersSeen);
}

// ─── Snapshot read for dashboard / Prometheus ───────────────────────────
async function snapshot() {
  if (!_ensureStore('snapshot')) return { counters: {}, gauges: {} };
  const counters = (await store.getStats?.()) || {};
  const gauges = {
    ...((await store.getGauges?.()) || {}),
    bot_uptime_seconds: Math.floor(Date.now() / 1000) - startedAt,
  };
  return { counters, gauges, startedAt };
}

module.exports = {
  init,
  inc,
  setGauge,
  incReceived,
  incSent,
  incCommand,
  incMediaDown,
  incMediaUp,
  incRateLimit,
  incCooldown,
  refreshDerivedGauges,
  snapshot,
  // v1.4.0
  incAiRequest,
  incAiTokens,
  incAiTool,
  incAiRateLimit,
  incAiCostCapHit,
  setAiCostUsdToday,
  setAiOptInChats,
  incTelegramForward,
  setTelegramRoutedChannels,
  // v1.4.2
  incDecryptionFailure,
  incDecryptionRecovery,
};
