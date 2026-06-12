/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Integration tests for the v1.3.0 Telegram log bridge.
 *
 *   Run:  node --test src/__tests__/integration/telegram.test.js
 *
 * No real HTTP — transport.__testOverride captures payloads.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

function applyTelegramCfg(patch = {}) {
  process.env.NODE_ENV = 'test';
  const { __testOverride } = require('../../lib/configLoader');
  __testOverride({
    telegram: {
      enabled: true,
      botToken: 'test-token',
      routing: {
        syslogs:      '@echofox_sys',
        botLogs:      '-100100',
        userLogs:     '',
        groupUpdates: '',
        callLogs:     '',
        errLogs:      '@echofox_err',
        movGroup:     '',
      },
      parseMode: 'HTML',
      batchMs:   50,
      maxChunkChars: 3800,
      botUsername: '',
      userId: '',
      apiId: '',
      apiHash: '',
      channelId: '',
      groupId: '',
      bridgedChats: {},
      ...patch,
    },
  });
}

function freshTelegram() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}services${path.sep}telegram${path.sep}`)) {
      delete require.cache[k];
    }
  }
  return require('../../services/telegram');
}

test('routing.resolve: returns chatId only when telegram.enabled', () => {
  applyTelegramCfg({ enabled: false });
  const tg = freshTelegram();
  assert.equal(tg.routing.resolve('syslogs'), null);

  applyTelegramCfg({ enabled: true });
  const tg2 = freshTelegram();
  assert.equal(tg2.routing.resolve('syslogs'), '@echofox_sys');
  assert.equal(tg2.routing.resolve('userLogs'), null);  // empty -> null
});

test('routing.listRoutes: enumerates only routed keys', () => {
  applyTelegramCfg();
  const tg = freshTelegram();
  const routes = tg.routing.listRoutes().map((r) => r.key).sort();
  assert.deepEqual(routes, ['botLogs', 'errLogs', 'syslogs']);
});

test('transport.chunkText splits at 3800 char boundary, prefers newlines', () => {
  const tg = freshTelegram();
  const body = ('lorem ipsum dolor sit amet\n'.repeat(200));
  const chunks = tg.transport.chunkText(body, 1000);
  assert.ok(chunks.length >= 2, `expected chunking, got ${chunks.length}`);
  for (const c of chunks) assert.ok(c.length <= 1000, 'chunk too big');
  // Round-trip invariant: every non-empty line in the input appears
  // in the chunks in order. (The chunker collapses run-of-\n between
  // chunks; we don't care about that here.)
  const inputLines  = body.split('\n').filter(Boolean);
  const outputLines = chunks.join('\n').split('\n').filter(Boolean);
  assert.deepEqual(outputLines, inputLines);
});

test('transport.escapeHtml escapes &, <, >', () => {
  const tg = freshTelegram();
  assert.equal(tg.transport.escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('forward(): drops silently when telegram disabled', async () => {
  applyTelegramCfg({ enabled: false });
  const tg = freshTelegram();
  let calls = 0;
  tg.transport.__testOverride(() => { calls += 1; return { ok: true }; });
  const r = tg.forward('syslogs', { text: 'hello', level: 'info' });
  assert.equal(r, false);
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(calls, 0);
});

test('forward(): drops silently when channel not routed', async () => {
  applyTelegramCfg();
  const tg = freshTelegram();
  let calls = 0;
  tg.transport.__testOverride(() => { calls += 1; return { ok: true }; });
  const r = tg.forward('userLogs', { text: 'x', level: 'info' });   // empty in routing
  assert.equal(r, false);
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(calls, 0);
});

test('forward(): batches info-level messages within batchMs', async () => {
  applyTelegramCfg({ batchMs: 100 });
  const tg = freshTelegram();
  const sent = [];
  tg.transport.__testOverride((p) => { sent.push(p); return { ok: true, status: 200, messageId: 1 }; });

  tg.forward('syslogs', { text: 'line one', level: 'info', source: 'a' });
  tg.forward('syslogs', { text: 'line two', level: 'info', source: 'b' });
  tg.forward('syslogs', { text: 'line three', level: 'info', source: 'c' });

  assert.equal(sent.length, 0);  // nothing sent yet
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(sent.length, 1, 'should batch into 1 send');
  assert.equal(sent[0].chatId, '@echofox_sys');
  assert.equal(sent[0].parseMode, 'HTML');
  assert.ok(sent[0].text.includes('line one'));
  assert.ok(sent[0].text.includes('line two'));
  assert.ok(sent[0].text.includes('line three'));
  // HTML rendered for each entry
  assert.ok(sent[0].text.includes('<b>INFO</b>'));
  tg._resetForTests();
});

test('forward(): error level flushes immediately, bypassing batch', async () => {
  applyTelegramCfg({ batchMs: 5000 });   // long batch — should NOT wait
  const tg = freshTelegram();
  const sent = [];
  tg.transport.__testOverride((p) => { sent.push(p); return { ok: true }; });

  tg.forward('errLogs', { text: 'boom!', level: 'error', source: 'core' });
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '@echofox_err');
  assert.ok(sent[0].text.includes('boom!'));
  assert.ok(sent[0].text.includes('<b>ERROR</b>'));
  tg._resetForTests();
});

test('forward(): chunks bodies above maxChunkChars', async () => {
  applyTelegramCfg({ batchMs: 50, maxChunkChars: 500 });
  const tg = freshTelegram();
  const sent = [];
  tg.transport.__testOverride((p) => { sent.push(p); return { ok: true }; });

  const big = ('log line ' + 'x'.repeat(80) + '\n').repeat(20);
  tg.forward('botLogs', { text: big, level: 'info', source: 'evt' });
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(sent.length >= 2, `expected >= 2 chunks, got ${sent.length}`);
  for (const s of sent) {
    assert.equal(s.chatId, '-100100');
    assert.ok(s.text.length <= 500, `chunk too large: ${s.text.length}`);
  }
  tg._resetForTests();
});

test('forward(): retries once on retryAfter, then gives up quietly', async () => {
  applyTelegramCfg({ batchMs: 50 });
  const tg = freshTelegram();
  let n = 0;
  tg.transport.__testOverride(() => {
    n += 1;
    if (n === 1) return { ok: false, status: 429, error: 'Too Many Requests', retryAfter: 1 };
    return { ok: true };
  });
  tg.forward('syslogs', { text: 'retry me', level: 'info' });
  await new Promise((res) => setTimeout(res, 1300));
  assert.equal(n, 2, `expected 1 retry, total calls: ${n}`);
  tg._resetForTests();
});

test('_renderEntry: HTML format produces expected layout', () => {
  applyTelegramCfg();
  const tg = freshTelegram();
  const out = tg._renderEntry(
    { text: 'a <b>bug</b>', level: 'warn', source: 'svc', ts: 1700000000000 },
    'HTML',
  );
  assert.ok(out.includes('<b>WARN</b>'));
  assert.ok(out.includes('a &lt;b&gt;bug&lt;/b&gt;'));
  assert.ok(out.includes('[svc]'));
});

test('flushAll(): drains every pending channel', async () => {
  applyTelegramCfg({ batchMs: 60_000 });   // would never auto-flush
  const tg = freshTelegram();
  const sent = [];
  tg.transport.__testOverride((p) => { sent.push(p); return { ok: true }; });

  tg.forward('syslogs', { text: 's1', level: 'info' });
  tg.forward('botLogs', { text: 'b1', level: 'info' });
  await tg.flushAll();
  assert.equal(sent.length, 2);
  const chatIds = sent.map((s) => s.chatId).sort();
  assert.deepEqual(chatIds, ['-100100', '@echofox_sys']);
  tg._resetForTests();
});
