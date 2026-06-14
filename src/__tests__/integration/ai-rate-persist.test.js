/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Persistent AI rate-limit counters (v1.3.0).
 *
 * Strategy:
 *   - Spin up a real sqlite store with migration 005 + 006 applied
 *     (sqliteStore.js does this inline on init)
 *   - Bump counters via the store -> assert they survive a simulated
 *     "process restart" (re-open the same sqlite file)
 *   - Bump via router.shouldRespond() + router.noteSent() -> assert
 *     the values match what the store reports
 *   - Test that pruneAiRate() respects expires_at
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pino = require('pino');
const { LRUCache } = require('lru-cache');

function freshStore(dbPath) {
  const tmp =
    dbPath ||
    path.join(
      os.tmpdir(),
      `echofox_rate_persist_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
    );
  if (!dbPath) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch (_) {}
  }
  const { makeSQLiteStore } = require('../../store/sqliteStore');
  const store = makeSQLiteStore({
    dbPath: tmp,
    logger: pino({ level: 'silent' }),
    groupCache: new LRUCache({ max: 100 }),
  });
  store.__path = tmp;
  return store;
}

function installStore(store) {
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
}

function applyAiConfig(patch = {}) {
  process.env.NODE_ENV = 'test';
  const { __testOverride } = require('../../lib/configLoader');
  __testOverride({
    ai: {
      enabled: true,
      defaultProvider: 'openai',
      model: 'gpt-4o-mini',
      maxTokens: 800,
      costCapPerDayUsd: 0, // disable cap for these tests
      persona: 'general',
      customPersona: '',
      memoryTurns: 20,
      optInDefault: 'on',
      botNameRegex: 'echofox',
      typingWhileGenerating: false,
      enableToolCalling: false,
      toolWhitelist: [],
      rateLimitPerUserPerHour: 3,
      rateLimitPerChatPerDay: 5,
      providers: {
        openai: { apiKey: '', baseUrl: '' },
        gemini: { apiKey: '', baseUrl: '' },
        anthropic: { apiKey: '', baseUrl: '' },
        local: { baseUrl: 'http://x', model: 'llama3.2' },
      },
      ...patch,
    },
  });
}

function freshRouter() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}services${path.sep}ai${path.sep}`)) {
      delete require.cache[k];
    }
  }
  return require('../../services/ai/router');
}

test('store: counter survives a process-restart (re-open same sqlite file)', async () => {
  const s1 = freshStore();
  await s1.incrAiRateUser('u@x', 999_000);
  await s1.incrAiRateUser('u@x', 999_000);
  const before = await s1.getAiRateUser('u@x', 999_000);
  assert.equal(before, 2);

  // Simulate restart: open another store handle on the SAME file
  const s2 = freshStore(s1.__path);
  const after = await s2.getAiRateUser('u@x', 999_000);
  assert.equal(after, 2, 'counter should persist across re-open');
});

test('router: routes through store-backed counters when store has methods', async () => {
  const s = freshStore();
  installStore(s);
  applyAiConfig();
  const router = freshRouter();

  const chat = 'c@x';
  const user = 'u@x';
  for (let i = 0; i < 3; i += 1) {
    const d = await router.shouldRespond({ chatJid: chat, userJid: user, text: 'echofox hi' });
    assert.equal(d.respond, true);
    await router.noteSent({ chatJid: chat, userJid: user });
  }
  // 4th call hits perUser=3 limit
  const d4 = await router.shouldRespond({ chatJid: chat, userJid: user, text: 'echofox hi' });
  assert.equal(d4.respond, false);
  assert.equal(d4.reason, 'rate_limit_user');

  // Verify store agrees
  const hour = Math.floor(Date.now() / (60 * 60 * 1000));
  assert.equal(await s.getAiRateUser(user, hour), 3);
});

test('router: falls back to in-memory when store lacks methods', async () => {
  // Replace getStore() to return a stub WITHOUT the new methods
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore({
    /* no incrAiRateUser / getAiRateUser */
    getAiChatOptIn: async () => null,
  });
  applyAiConfig({ rateLimitPerUserPerHour: 2 });
  const router = freshRouter();
  const chat = 'fc@x';
  const user = 'fu@x';
  for (let i = 0; i < 2; i += 1) {
    const d = await router.shouldRespond({ chatJid: chat, userJid: user, text: 'echofox hi' });
    assert.equal(d.respond, true);
    await router.noteSent({ chatJid: chat, userJid: user });
  }
  const d3 = await router.shouldRespond({ chatJid: chat, userJid: user, text: 'echofox hi' });
  assert.equal(d3.respond, false);
  assert.equal(d3.reason, 'rate_limit_user');
});

test('pruneAiRate: deletes only expired rows', async () => {
  const s = freshStore();
  // Two rows: one with expires_at in the past, one in the future
  const now = Date.now();
  await s.incrAiRateUser('past@x', 100); // expires_at = 102 * 3600 * 1000 (~year 1970)
  await s.incrAiRateUser('future@x', Math.floor(now / 3_600_000));

  const pruned = await s.pruneAiRate(now);
  assert.equal(pruned.users, 1, `expected 1 pruned, got ${pruned.users}`);
  assert.equal(await s.getAiRateUser('past@x', 100), 0);
  assert.equal(await s.getAiRateUser('future@x', Math.floor(now / 3_600_000)), 1);
});
