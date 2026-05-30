/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Integration test: lifecycle.js phases can be invoked without throwing.
 *
 * We don't actually open a Baileys socket here — that requires real auth.
 * We validate each phase individually:
 *   • config loads + validates
 *   • metrics initialise against a mock store
 *   • diagnostics produces a report
 *   • alert engine init + record + getActiveAlerts
 *
 *   Run:  node --test src/__tests__/integration/boot.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const { makeMockStore, makeMockSock } = require('../helpers/mockSock');

test('config loader returns frozen schema-validated object', () => {
  const { config } = require('../../lib/configLoader');
  assert.ok(config);
  assert.ok(config.bot);
  assert.ok(config.runtime);
  assert.equal(typeof config.runtime.maxHeapPercent, 'number');
  assert.ok(Array.isArray(config.admins));
  assert.equal(Object.isFrozen(config), true);
});

test('metrics service init() then snapshot()', async () => {
  const metrics = require('../../services/metrics');
  const store = makeMockStore();
  metrics.init(store);
  metrics.incReceived(3);
  metrics.incCommand('ping', 'success');
  metrics.setGauge('groups_count', 42);   // known gauge, no warning
  const snap = await metrics.snapshot();
  assert.ok(snap.counters);
  assert.ok(snap.gauges);
  assert.ok(snap.counters.messages_received_total >= 3);
  assert.equal(snap.gauges.groups_count, 42);
});

test('alertEngine: init → record many failures → triggers', () => {
  const engine = require('../../services/alertEngine');
  engine.init({ minInvocations: 5, failureRateThreshold: 0.5, sweepIntervalMs: 60_000 });
  // 5 invocations, 3 fail → 60% > 50% → trigger
  engine.record('flaky', 'failure');
  engine.record('flaky', 'failure');
  engine.record('flaky', 'success');
  engine.record('flaky', 'failure');
  engine.record('flaky', 'success');
  const rate = engine.getRate('flaky');
  assert.equal(rate.invocations, 5);
  assert.equal(rate.failures, 3);
  const active = engine.getActiveAlerts();
  assert.ok(active.some((a) => a.command === 'flaky'), 'flaky should be in active alerts');
  engine.stop();
});

test('diagnostics: runs without throwing even with empty context', async () => {
  const { runDiagnostics } = require('../../lib/diagnostics');
  // With empty context (no sock/store/auth/commands), most checks should fail
  // gracefully — overall ok=false but no throw.
  const report = await runDiagnostics({});
  assert.equal(typeof report.ok, 'boolean');
  assert.ok(typeof report.checks === 'object');
  assert.ok(report.checks.host, 'host check should always run');
  assert.equal(report.checks.host.ok, true);
});

test('diagnostics: with mock runtime context all checks ok or expected-degraded', async () => {
  const { runDiagnostics, bindRuntimeContext } = require('../../lib/diagnostics');
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = { commands: new Map([['ping', { name: 'ping', start: () => {} }]]), aliases: new Map(), categories: new Map() };
  const auth = { state: { creds: { registered: true } }, saveCreds: () => {} };
  const caches = require('../../core/caches');
  bindRuntimeContext({ sock, store, commands, auth, caches });
  const report = await runDiagnostics({ sock, store, commands, auth, caches });
  assert.equal(report.checks.baileys.ok, true);
  assert.equal(report.checks.store.ok,   true);
  assert.equal(report.checks.commands.ok, true);
  assert.equal(report.checks.auth.ok,    true);
});

test('errors module: classification helpers', () => {
  const { UserError, UpstreamError, isUserFacingError, shouldCountAsFailure } = require('../../lib/errors');
  assert.equal(isUserFacingError(new UserError('x')), true);
  assert.equal(isUserFacingError(new UpstreamError('x')), false);
  assert.equal(shouldCountAsFailure(new Error('x')), true);
  assert.equal(shouldCountAsFailure(new UserError('x')), false);
  assert.equal(shouldCountAsFailure(new UpstreamError('x')), false);
});
