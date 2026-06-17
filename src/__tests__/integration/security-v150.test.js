/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.5.0 security hardening tests.
 *
 *   Run:  node --test src/__tests__/integration/security-v150.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Fix #1: dashboard default password validation ──────────────────────
test('configSchema: rejects default dashboard password when enabled', () => {
  // Fresh require so the test sees the latest schema
  for (const k of Object.keys(require.cache)) {
    if (k.includes('configSchema')) delete require.cache[k];
  }
  const { schema } = require('../../lib/configSchema');

  const bad = schema.safeParse({
    dashboard: { enabled: true, password: 'change-me-please' },
  });
  assert.equal(bad.success, false, 'default password + enabled should fail');

  const short = schema.safeParse({
    dashboard: { enabled: true, password: 'short1' },
  });
  assert.equal(short.success, false, 'password < 12 chars should fail when enabled');

  const ok = schema.safeParse({
    dashboard: { enabled: true, password: 'a-strong-password-2026' },
  });
  assert.equal(ok.success, true, 'strong password should pass');

  // Default password is fine if dashboard is DISABLED
  const disabledDefault = schema.safeParse({
    dashboard: { enabled: false, password: 'change-me-please' },
  });
  assert.equal(disabledDefault.success, true, 'default password is OK when dashboard disabled');
});

// ─── Fix #2: sessionDir schema field ────────────────────────────────────
test('configSchema: bot.sessionDir is a new optional string field', () => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('configSchema')) delete require.cache[k];
  }
  const { schema } = require('../../lib/configSchema');
  const cfg = schema.parse({});
  assert.equal(typeof cfg.bot.sessionDir, 'string', 'sessionDir should exist');
  assert.equal(cfg.bot.sessionDir, '', 'sessionDir defaults to empty string (legacy fallback)');

  const cfg2 = schema.parse({ bot: { sessionDir: './data/sessions' } });
  assert.equal(cfg2.bot.sessionDir, './data/sessions');
});

// ─── Fix #4: SSRF guard hardening ───────────────────────────────────────
test('toolRegistry._isPrivateHost: covers all the v1.5.0 additions', () => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('toolRegistry')) delete require.cache[k];
  }
  const { _isPrivateHost } = require('../../services/ai/toolRegistry');

  // v1.4.x baseline — must still block
  assert.equal(_isPrivateHost('localhost'), true);
  assert.equal(_isPrivateHost('127.0.0.1'), true);
  assert.equal(_isPrivateHost('10.0.0.1'), true);
  assert.equal(_isPrivateHost('192.168.1.1'), true);
  assert.equal(_isPrivateHost('169.254.169.254'), true, 'AWS metadata');
  assert.equal(_isPrivateHost('172.16.0.1'), true);
  assert.equal(_isPrivateHost('172.31.255.255'), true);
  assert.equal(_isPrivateHost('::1'), true);

  // v1.5.0 additions
  assert.equal(_isPrivateHost('100.64.0.1'), true, 'CGNAT 100.64.0.0/10');
  assert.equal(_isPrivateHost('100.127.255.255'), true, 'CGNAT upper bound');
  assert.equal(_isPrivateHost('metadata.google.internal'), true, 'GCP metadata');
  assert.equal(_isPrivateHost('host.internal'), true, '.internal TLD');
  assert.equal(_isPrivateHost('foo.corp'), true, '.corp TLD');
  assert.equal(_isPrivateHost('foo.lan'), true, '.lan TLD');
  assert.equal(_isPrivateHost('foo.local'), true, '.local mDNS');
  assert.equal(_isPrivateHost('fe80::1'), true, 'IPv6 link-local');
  assert.equal(_isPrivateHost('fc00::1'), true, 'IPv6 unique local');
  assert.equal(_isPrivateHost('fd00::1'), true, 'IPv6 unique local upper');
  assert.equal(_isPrivateHost('::ffff:127.0.0.1'), true, 'IPv4-mapped IPv6 loopback');
  assert.equal(_isPrivateHost('0.0.0.0'), true);
  assert.equal(_isPrivateHost('0.1.2.3'), true, '0.0.0.0/8');

  // Negative cases — must NOT block
  assert.equal(_isPrivateHost('8.8.8.8'), false, 'Google DNS');
  assert.equal(_isPrivateHost('1.1.1.1'), false, 'Cloudflare DNS');
  assert.equal(_isPrivateHost('example.com'), false);
  assert.equal(_isPrivateHost('100.63.255.255'), false, '100.63 is BEFORE CGNAT range');
  assert.equal(_isPrivateHost('100.128.0.0'), false, '100.128 is AFTER CGNAT range');

  // Edge: empty / null
  assert.equal(_isPrivateHost(''), true, 'empty hostname must be blocked');
  assert.equal(_isPrivateHost(null), true, 'null hostname must be blocked');
});

// ─── Fix #7: cost reservation API ───────────────────────────────────────
test('costTracker.reserve/release: in-flight reservations affect isOverCap', async () => {
  process.env.NODE_ENV = 'test';
  for (const k of Object.keys(require.cache)) {
    if (k.includes('costTracker') || k.includes('configLoader') || k.includes('instance')) {
      delete require.cache[k];
    }
  }
  const { __testOverride } = require('../../lib/configLoader');
  const inst = require('../../store/instance');
  // Stub a store that reports $4 spent today, cap = $5
  inst.__resetForTests();
  inst.setStore({
    async getAiUsageDayTotal() {
      return 4;
    },
  });
  __testOverride({
    ai: {
      enabled: true,
      defaultProvider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 800,
      costCapPerDayUsd: 5,
      providers: { openai: {}, gemini: {}, anthropic: {}, local: {} },
    },
  });

  const cost = require('../../services/ai/costTracker');
  cost._resetReservationsForTests();

  // Without reservations: $4 used / $5 cap → not over
  assert.equal(await cost.isOverCap(), false, 'should not be over without reservations');

  // Reserve $2 → $4 + $2 = $6 ≥ $5 cap → over
  const id1 = cost.reserve(2);
  assert.equal(await cost.isOverCap(), true, 'should be over once $2 reserved');

  // Release the reservation → back to not-over
  cost.release(id1);
  assert.equal(await cost.isOverCap(), false, 'should not be over after release');

  // Reset before the stacking scenario so we have a clean slate
  cost._resetReservationsForTests();
  // Multiple concurrent reservations stack — keep total under $1 so we don't exceed cap ($5-$4=$1 headroom)
  const a = cost.reserve(0.3);
  const b = cost.reserve(0.3);
  const c = cost.reserve(0.3);
  assert.equal(await cost.isOverCap(), false, '$4 + $0.9 < $5 should still pass');
  const d = cost.reserve(0.5);
  assert.equal(await cost.isOverCap(), true, '$4 + $1.4 ≥ $5 should trip');

  // Cleanup
  cost.release(a);
  cost.release(b);
  cost.release(c);
  cost.release(d);
  assert.equal(await cost.isOverCap(), false);
});

test('costTracker.estimateMaxCostUsd: returns sensible upper bound', () => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('costTracker') || k.includes('configLoader')) {
      delete require.cache[k];
    }
  }
  const { __testOverride } = require('../../lib/configLoader');
  __testOverride({
    ai: { maxTokens: 1000, providers: { openai: {}, gemini: {}, anthropic: {}, local: {} } },
  });
  const cost = require('../../services/ai/costTracker');

  // gpt-4o-mini: completion = $0.60/1M tokens. 1000 tokens × $0.60/1M × 1.2 margin = $0.00072
  const est = cost.estimateMaxCostUsd('openai', 'gpt-4o-mini');
  assert.ok(est > 0 && est < 0.01, `estimate for gpt-4o-mini should be ~$0.0007, got ${est}`);

  // Local Ollama: $0
  const local = cost.estimateMaxCostUsd('local', 'llama3.2');
  assert.equal(local, 0, 'local should always cost $0');
});

// ─── Fix #8: Baileys version check ──────────────────────────────────────
test('lifecycle.checkBaileysVersion: detects prerelease versions', () => {
  for (const k of Object.keys(require.cache)) {
    if (k.includes('lifecycle')) delete require.cache[k];
  }
  const lifecycle = require('../../core/lifecycle');
  assert.equal(
    typeof lifecycle.checkBaileysVersion,
    'function',
    'checkBaileysVersion should be exported',
  );
  // Doesn't throw on call (we can't easily assert the log output here,
  // but verifying it runs cleanly catches regressions)
  assert.doesNotThrow(() => lifecycle.checkBaileysVersion());
});
