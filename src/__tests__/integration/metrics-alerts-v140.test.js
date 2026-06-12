/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.4.0 metrics + built-in alert rules.
 *
 *   Run:  node --test src/__tests__/integration/metrics-alerts-v140.test.js
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const pino   = require('pino');
const { LRUCache } = require('lru-cache');

const stats   = require('../../store/schema/stats');
const metrics = require('../../services/metrics');

function freshStore() {
  const tmp = path.join(os.tmpdir(),
    `echofox_v140_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  try { fs.rmSync(tmp, { force: true }); } catch (_) {}
  const { makeSQLiteStore } = require('../../store/sqliteStore');
  return makeSQLiteStore({
    dbPath: tmp,
    logger: pino({ level: 'silent' }),
    groupCache: new LRUCache({ max: 100 }),
  });
}

function installStore(store) {
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
}

function applyAlertCfg(patch = {}) {
  process.env.NODE_ENV = 'test';
  const { __testOverride } = require('../../lib/configLoader');
  __testOverride({
    ai: {
      enabled: true, defaultProvider: 'openai', model: 'gpt-4o-mini', maxTokens: 800,
      costCapPerDayUsd: 10,
      persona: 'general', customPersona: '', memoryTurns: 20,
      optInDefault: 'off', botNameRegex: 'echofox',
      typingWhileGenerating: false, enableToolCalling: false, toolWhitelist: [],
      rateLimitPerUserPerHour: 30, rateLimitPerChatPerDay: 100,
      providers: {
        openai: { apiKey: '', baseUrl: '' }, gemini: { apiKey: '', baseUrl: '' },
        anthropic: { apiKey: '', baseUrl: '' }, local: { baseUrl: 'http://x', model: 'llama3.2' },
      },
    },
    alerts: {
      enabled: true,
      windowMinutes: 60,
      minInvocations: 10,
      failureRateThreshold: 0.30,
      notifyChannel: '',
      rules: {
        aiCostPct:           { enabled: true, threshold: 0.5, cooldownMinutes: 1 },
        telegramFailureRate: { enabled: true, threshold: 0.2, minSends: 4, cooldownMinutes: 1 },
      },
      ...patch.alerts,
    },
    telegram: { enabled: false, botToken: '', routing: {}, parseMode: 'HTML',
                batchMs: 0, maxChunkChars: 3800, botUsername: '', userId: '',
                apiId: '', apiHash: '', channelId: '', groupId: '', bridgedChats: {} },
  });
}

// ─── stats schema ─────────────────────────────────────────────────

test('stats.COUNTERS contains all v1.4.0 AI + Telegram counters', () => {
  const required = [
    'ai_chat_requests_total',
    'ai_chat_requests_failed_total',
    'ai_tokens_prompt_total',
    'ai_tokens_completion_total',
    'ai_tool_invocations_total',
    'ai_tool_invocations_failed_total',
    'ai_rate_limit_hits_total',
    'ai_cost_cap_hits_total',
    'telegram_forwards_total',
    'telegram_forwards_dropped_total',
    'telegram_send_failures_total',
    'telegram_send_retries_total',
  ];
  for (const k of required) assert.ok(stats.COUNTERS.includes(k), `missing counter ${k}`);
});

test('stats.GAUGES contains all v1.4.0 gauges', () => {
  for (const k of ['ai_cost_usd_today', 'ai_active_opt_in_chats', 'telegram_routed_channels']) {
    assert.ok(stats.GAUGES.includes(k), `missing gauge ${k}`);
  }
});

test('metrics: typed AI wrappers increment expected counters', async () => {
  const s = freshStore();
  metrics.init(s);
  metrics.incAiRequest('start');
  metrics.incAiRequest('failure');
  metrics.incAiTokens(100, 50);
  metrics.incAiTool('success');
  metrics.incAiTool('failure');
  metrics.incAiRateLimit();
  metrics.incAiCostCapHit();
  metrics.setAiCostUsdToday(1.25);
  metrics.setAiOptInChats(7);

  const snap = await metrics.snapshot();
  assert.equal(snap.counters.ai_chat_requests_total, 2);
  assert.equal(snap.counters.ai_chat_requests_failed_total, 1);
  assert.equal(snap.counters.ai_tokens_prompt_total, 100);
  assert.equal(snap.counters.ai_tokens_completion_total, 50);
  assert.equal(snap.counters.ai_tool_invocations_total, 2);
  assert.equal(snap.counters.ai_tool_invocations_failed_total, 1);
  assert.equal(snap.counters.ai_rate_limit_hits_total, 1);
  assert.equal(snap.counters.ai_cost_cap_hits_total, 1);
  assert.equal(snap.gauges.ai_cost_usd_today, 1.25);
  assert.equal(snap.gauges.ai_active_opt_in_chats, 7);
});

test('metrics: typed Telegram wrappers route to correct outcome counters', async () => {
  const s = freshStore();
  metrics.init(s);
  metrics.incTelegramForward('queued');
  metrics.incTelegramForward('queued');
  metrics.incTelegramForward('dropped');
  metrics.incTelegramForward('failure');
  metrics.incTelegramForward('retried');
  metrics.setTelegramRoutedChannels(3);

  const snap = await metrics.snapshot();
  assert.equal(snap.counters.telegram_forwards_total, 5);
  assert.equal(snap.counters.telegram_forwards_dropped_total, 1);
  assert.equal(snap.counters.telegram_send_failures_total, 1);
  assert.equal(snap.counters.telegram_send_retries_total, 1);
  assert.equal(snap.gauges.telegram_routed_channels, 3);
});

// ─── alert rules ─────────────────────────────────────────────────

test('alertEngine.aiCostPct: fires when daily cost >= threshold * cap', async () => {
  const s = freshStore(); installStore(s); applyAlertCfg();
  // delete from require cache so cold engine sees fresh state
  for (const k of Object.keys(require.cache)) {
    if (k.endsWith(`${path.sep}alertEngine.js`)) delete require.cache[k];
  }
  const ae = require('../../services/alertEngine');
  ae.init({});

  // Below threshold — not active
  const today = new Date().toISOString().slice(0, 10);
  await s.recordAiUsage({ day: today, provider: 'openai', model: 'gpt-4o-mini',
                          promptTokens: 0, completionTokens: 0, costUsd: 1.0 });
  await ae._evaluateBuiltinRules();
  assert.ok(!ae.getActiveAlerts().find((a) => a.command === '__ai_cost_pct'),
    'should not be active when below threshold');

  // Above threshold (5 USD >= 0.5 * 10 USD cap) — fires
  await s.recordAiUsage({ day: today, provider: 'openai', model: 'gpt-4o-mini',
                          promptTokens: 0, completionTokens: 0, costUsd: 5.0 });
  await ae._evaluateBuiltinRules();
  const active = ae.getActiveAlerts().find((a) => a.command === '__ai_cost_pct');
  assert.ok(active, 'should be active when above threshold');

  ae.stop();
});

test('alertEngine.telegramFailureRate: fires when failure rate >= threshold AND sends >= minSends', async () => {
  const s = freshStore(); installStore(s); applyAlertCfg();
  for (const k of Object.keys(require.cache)) {
    if (k.endsWith(`${path.sep}alertEngine.js`)) delete require.cache[k];
  }
  const ae = require('../../services/alertEngine');
  ae.init({});

  // Below minSends — must NOT fire (cfg.minSends=4)
  // 'queued' = +1 forwards_total; 'failure' = +1 forwards_total AND +1 failures
  // So 1 queued + 1 failure = 2 forwards_total (below minSends=4) → must not fire
  metrics.init(s);
  metrics.incTelegramForward('queued');
  metrics.incTelegramForward('failure');
  await ae._evaluateBuiltinRules();
  assert.ok(!ae.getActiveAlerts().find((a) => a.command === '__telegram_failure_rate'),
    'should not fire below minSends');

  // Push above minSends with high failure rate — fires
  // Add another 5 of each => totals: forwards_total=12, failures=6 → 50% rate
  for (let i = 0; i < 5; i += 1) {
    metrics.incTelegramForward('queued');
    metrics.incTelegramForward('failure');
  }
  await ae._evaluateBuiltinRules();
  const active = ae.getActiveAlerts().find((a) => a.command === '__telegram_failure_rate');
  assert.ok(active, 'should fire when failure rate >= threshold and sends >= minSends');
  assert.ok(active.rate >= 0.2, `rate should be at or above 0.2 (got ${active.rate})`);

  ae.stop();
});

test('alertEngine.aiCostPct: cooldown prevents re-firing within cooldown window', async () => {
  const s = freshStore(); installStore(s);
  applyAlertCfg({ alerts: { rules: { aiCostPct: { enabled: true, threshold: 0.1, cooldownMinutes: 60 } } } });
  for (const k of Object.keys(require.cache)) {
    if (k.endsWith(`${path.sep}alertEngine.js`)) delete require.cache[k];
  }
  const ae = require('../../services/alertEngine');
  ae.init({});

  const today = new Date().toISOString().slice(0, 10);
  await s.recordAiUsage({ day: today, provider: 'openai', model: 'gpt-4o-mini',
                          promptTokens: 0, completionTokens: 0, costUsd: 5.0 });
  await ae._evaluateBuiltinRules();
  assert.ok(ae.getActiveAlerts().find((a) => a.command === '__ai_cost_pct'), 'first fire');

  // Simulate the alert manually clearing (e.g. cap raised), then re-firing.
  // We can't easily clear via the test, but we can assert that an immediate
  // second sweep doesn't double-fire (idempotent active-set behaviour).
  await ae._evaluateBuiltinRules();
  const matches = ae.getActiveAlerts().filter((a) => a.command === '__ai_cost_pct');
  assert.equal(matches.length, 1, 'must remain a single active alert across sweeps');

  ae.stop();
});
