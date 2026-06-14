/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
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

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeMockStore, makeMockSock } = require('../helpers/mockSock');

test('config loader returns frozen schema-validated object', () => {
  const { config } = require('../../lib/configLoader');
  assert.ok(config);
  assert.ok(config.bot);
  assert.ok(config.runtime);
  assert.equal(typeof config.runtime.maxHeapPercent, 'number');
  assert.ok(Array.isArray(config.admins));
  assert.equal(Object.isFrozen(config.bot), true, 'config.bot should be frozen');
  assert.equal(Object.isFrozen(config.features), true, 'config.features should be frozen');
  assert.throws(() => {
    'use strict';
    config.foo = 'bar';
  }, /read only|trap returned falsish/i);
});

test('metrics service init() then snapshot()', async () => {
  const metrics = require('../../services/metrics');
  const store = makeMockStore();
  metrics.init(store);
  metrics.incReceived(3);
  metrics.incCommand('ping', 'success');
  metrics.setGauge('groups_count', 42); // known gauge, no warning
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
  assert.ok(
    active.some((a) => a.command === 'flaky'),
    'flaky should be in active alerts',
  );
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
  const commands = {
    commands: new Map([['ping', { name: 'ping', start: () => {} }]]),
    aliases: new Map(),
    categories: new Map(),
  };
  const auth = { state: { creds: { registered: true } }, saveCreds: () => {} };
  const caches = require('../../core/caches');
  bindRuntimeContext({ sock, store, commands, auth, caches });
  const report = await runDiagnostics({ sock, store, commands, auth, caches });
  assert.equal(report.checks.baileys.ok, true);
  assert.equal(report.checks.store.ok, true);
  assert.equal(report.checks.commands.ok, true);
  assert.equal(report.checks.auth.ok, true);
});

test('errors module: classification helpers', () => {
  const {
    UserError,
    UpstreamError,
    isUserFacingError,
    shouldCountAsFailure,
  } = require('../../lib/errors');
  assert.equal(isUserFacingError(new UserError('x')), true);
  assert.equal(isUserFacingError(new UpstreamError('x')), false);
  assert.equal(shouldCountAsFailure(new Error('x')), true);
  assert.equal(shouldCountAsFailure(new UserError('x')), false);
  assert.equal(shouldCountAsFailure(new UpstreamError('x')), false);
});

test('__testOverride: merges patch onto config and is visible via proxy', () => {
  process.env.NODE_ENV = 'test';
  const loader = require('../../lib/configLoader');
  const originalPrefix = loader.config.bot.prefix;

  loader.__testOverride({ bot: { prefix: '!!' } });

  assert.equal(loader.config.bot.prefix, '!!');
  assert.equal(
    loader.config.bot.adminPrefix,
    originalPrefix === '!!' ? '$' : loader.config.bot.adminPrefix,
  );

  loader.__resetForTests();
  assert.equal(loader.config.bot.prefix, originalPrefix);
});

test('__testOverride: re-validates via Zod schema (rejects bad values)', () => {
  process.env.NODE_ENV = 'test';
  const loader = require('../../lib/configLoader');
  assert.throws(
    () => loader.__testOverride({ runtime: { maxHeapPercent: 'not-a-number' } }),
    /maxHeapPercent|Expected number/i,
  );

  assert.equal(typeof loader.config.runtime.maxHeapPercent, 'number');
});

test('__testOverride: warns when NODE_ENV !== "test"', () => {
  const loader = require('../../lib/configLoader');
  const origEnv = process.env.NODE_ENV;
  const origWarn = console.warn;
  let captured = '';
  try {
    process.env.NODE_ENV = 'production';
    console.warn = (msg) => {
      captured += String(msg) + '\n';
    };
    loader.__testOverride({ bot: { prefix: '.' } });
  } finally {
    console.warn = origWarn;
    process.env.NODE_ENV = origEnv;
    loader.__resetForTests();
  }
  assert.match(captured, /__testOverride.*tests only.*production/i);
});

test('matchesTopics: empty topics → matches every article (incl. untagged)', () => {
  const { matchesTopics } = require('../../services/thehackersnewsService');
  assert.equal(matchesTopics({ categories: ['malware'] }, null), true);
  assert.equal(matchesTopics({ categories: ['malware'] }, {}), true);
  assert.equal(matchesTopics({ categories: ['malware'] }, { topics: [] }), true);
  assert.equal(
    matchesTopics({ categories: [] }, null),
    true,
    'untagged article + no filter = match',
  );
});

test('matchesTopics: OR-match on any tag overlap (case-insensitive)', () => {
  const { matchesTopics } = require('../../services/thehackersnewsService');
  const meta = { topics: ['Malware', 'Ransomware'] };
  assert.equal(matchesTopics({ categories: ['malware', 'apt'] }, meta), true);
  assert.equal(matchesTopics({ categories: ['Ransomware'] }, meta), true);
  assert.equal(matchesTopics({ categories: ['cloud-security'] }, meta), false);
  assert.equal(
    matchesTopics({ categories: [] }, meta),
    false,
    'untagged article + filter → no match',
  );
});

test('event router: every worker emit has a registered handler', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'worker.js'), 'utf8');
  const routerSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'events', 'router.js'),
    'utf8',
  );

  const emits = new Set();
  for (const m of workerSrc.matchAll(/eventRouter\.emit\('([a-z.-]+)'/g)) emits.add(m[1]);
  const handlers = new Set();
  for (const m of routerSrc.matchAll(/bus\.on\('([a-z.-]+)'/g)) handlers.add(m[1]);

  for (const e of emits) {
    assert.ok(handlers.has(e), `worker emits '${e}' but router.js has no bus.on() for it`);
  }
});

test('event router: every router handler has a worker emit (no dead handlers)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const workerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'core', 'worker.js'), 'utf8');
  const routerSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'events', 'router.js'),
    'utf8',
  );

  const emits = new Set();
  for (const m of workerSrc.matchAll(/eventRouter\.emit\('([a-z.-]+)'/g)) emits.add(m[1]);
  const handlers = new Set();
  for (const m of routerSrc.matchAll(/bus\.on\('([a-z.-]+)'/g)) handlers.add(m[1]);

  for (const h of handlers) {
    assert.ok(emits.has(h), `router.js has bus.on('${h}') but no worker.js emit — dead handler`);
  }
});

test('event router: loads cleanly (no MODULE_NOT_FOUND from a missing handler file)', () => {
  const router = require('../../events/router');
  assert.equal(typeof router.handleMessage, 'function');
  assert.equal(typeof router.emit, 'function');
});

test('event router: every required file exists on disk', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const eventsDir = path.join(__dirname, '..', '..', 'events');
  const routerSrc = fs.readFileSync(path.join(eventsDir, 'router.js'), 'utf8');
  const requires = [];
  for (const m of routerSrc.matchAll(/require\('\.\/([a-zA-Z0-9._-]+)'\)/g)) {
    requires.push(m[1]);
  }
  for (const r of requires) {
    const candidates = [path.join(eventsDir, r), path.join(eventsDir, r + '.js')];
    const exists = candidates.some((c) => fs.existsSync(c));
    assert.ok(exists, `router.js requires './${r}' but no matching file in src/events/`);
  }
});

test('event router: handles unknown events without crashing', () => {
  const router = require('../../events/router');
  assert.doesNotThrow(() => router.emit('some.totally.unknown.event', { foo: 'bar' }));
});

test('rss service: matchesTopics OR-matches case-insensitively', () => {
  const { matchesTopics } = require('../../services/genericRssService');
  assert.equal(matchesTopics({ categories: ['Malware', 'apt'] }, ['malware']), true);
  assert.equal(matchesTopics({ categories: ['cloud-security'] }, ['malware']), false);
  assert.equal(matchesTopics({ categories: [] }, ['malware']), false);
  assert.equal(matchesTopics({ categories: [] }, []), true, 'empty filter matches all');
  assert.equal(matchesTopics({ categories: [] }, null), true, 'null filter matches all');
  assert.equal(
    matchesTopics({ categories: ['x'] }, undefined),
    true,
    'undefined filter matches all',
  );
});

test('github service: formatRelease + formatAdvisory produce non-empty WhatsApp text', () => {
  const { formatRelease, formatAdvisory } = require('../../services/githubService');
  const rel = formatRelease('nodejs', 'node', {
    tag: 'v22.0.0',
    name: 'v22.0.0',
    body: 'See changelog.',
    url: 'https://x',
    prerelease: false,
  });
  assert.match(rel, /Release/);
  assert.match(rel, /v22\.0\.0/);
  assert.match(rel, /https:\/\/x/);

  const adv = formatAdvisory('nodejs', 'node', {
    ghsa_id: 'GHSA-aaaa',
    cve_id: 'CVE-2026-0001',
    summary: 'Boom.',
    severity: 'critical',
    url: 'https://y',
    published_at: '2026-01-01T00:00:00Z',
  });
  assert.match(adv, /Critical|CRITICAL/);
  assert.match(adv, /GHSA-aaaa/);
  assert.match(adv, /CVE-2026-0001/);
});

test('vtwatch service: formatAlert highlights direction', () => {
  const { formatAlert } = require('../../services/vtWatchService');
  const up = formatAlert(
    'hash',
    'abc',
    { malicious: 0 },
    { malicious: 3, suspicious: 0, harmless: 70, undetected: 7 },
  );
  const down = formatAlert(
    'hash',
    'abc',
    { malicious: 5 },
    { malicious: 1, suspicious: 0, harmless: 70, undetected: 7 },
  );
  assert.match(up, /increased/i);
  assert.match(down, /decreased/i);
});
