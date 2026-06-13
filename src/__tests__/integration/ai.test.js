/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Integration tests for the v1.2.0 AI service.
 *
 *   Run:  node --test src/__tests__/integration/ai.test.js
 *
 * Strategy:
 *   • Use a fresh in-memory SQLite store as the singleton
 *   • Mock each provider via __testOverride
 *   • Exercise: router decisions, tool-call loop, memory persistence,
 *               cost tracking, admin/user commands
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const os     = require('node:os');
const pino   = require('pino');
const { LRUCache } = require('lru-cache');

// ─── helpers ──────────────────────────────────────────────────────
function freshStore() {
  const tmp = path.join(os.tmpdir(), `echofox_ai_test_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  try { fs.rmSync(tmp, { force: true }); } catch (_) {}
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
      costCapPerDayUsd: 5,
      persona: 'general',
      customPersona: '',
      memoryTurns: 20,
      optInDefault: 'off',
      botNameRegex: 'echofox|bot|@assistant',
      typingWhileGenerating: false,
      enableToolCalling: true,
      toolWhitelist: ['get_blocklist', 'latest_hackernews'],
      rateLimitPerUserPerHour: 30,
      rateLimitPerChatPerDay: 100,
      providers: {
        openai:    { apiKey: 'test', baseUrl: '' },
        gemini:    { apiKey: '',     baseUrl: '' },
        anthropic: { apiKey: '',     baseUrl: '' },
        local:     { baseUrl: 'http://localhost:11434', model: 'llama3.2' },
      },
      ...patch,
    },
  });
}

function freshAi() {
  // Clear module cache for ai/* so router rate-limit maps reset cleanly
  // between independent test scenarios.
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${path.sep}services${path.sep}ai${path.sep}`)) {
      delete require.cache[k];
    }
  }
  return require('../../services/ai');
}

// ─── tests ────────────────────────────────────────────────────────

test('router: respects ai.enabled=false', async () => {
  const s = freshStore(); installStore(s); applyAiConfig({ enabled: false });
  const ai = freshAi();
  const d = await ai.router.shouldRespond({ chatJid: 'c@s.whatsapp.net', userJid: 'u@s.whatsapp.net', text: 'hi bot' });
  assert.equal(d.respond, false);
  assert.equal(d.reason, 'disabled');
});

test('router: rejects commands (text starts with prefix)', async () => {
  const s = freshStore(); installStore(s); applyAiConfig();
  const ai = freshAi();
  const d = await ai.router.shouldRespond({ chatJid: 'c@s.whatsapp.net', userJid: 'u@s.whatsapp.net', text: '.help' });
  assert.equal(d.respond, false);
  assert.equal(d.reason, 'is_command');
});

test('router: bot-name mention triggers opt-in', async () => {
  const s = freshStore(); installStore(s); applyAiConfig({ optInDefault: 'off' });
  const ai = freshAi();
  const d = await ai.router.shouldRespond({ chatJid: 'c1@s.whatsapp.net', userJid: 'u@s.whatsapp.net', text: 'hey echofox, what time is it' });
  assert.equal(d.respond, true);
});

test('router: per-chat opt-in row overrides default', async () => {
  const s = freshStore(); installStore(s); applyAiConfig({ optInDefault: 'off' });
  await s.setAiChatOptIn('c@s.whatsapp.net', { enabled: true });
  const ai = freshAi();
  const d = await ai.router.shouldRespond({ chatJid: 'c@s.whatsapp.net', userJid: 'u@s.whatsapp.net', text: 'random message' });
  assert.equal(d.respond, true);
});

test('ai.chat: tool-call loop persists memory + aggregates cost', async () => {
  const s = freshStore(); installStore(s); applyAiConfig({ optInDefault: 'on' });
  const ai = freshAi();
  const oai = require('../../services/ai/providers/openai');

  let call = 0;
  oai.__testOverride({
    chat: { completions: { create: async (_req) => {
      call += 1;
      if (call === 1) {
        return {
          choices: [{ message: { content: '', tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'get_blocklist', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
          model: 'gpt-4o-mini',
        };
      }
      return {
        choices: [{ message: { content: 'You have 0 blocked contacts.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 150, completion_tokens: 20 },
        model: 'gpt-4o-mini',
      };
    } } },
  });

  const chatJid = 'g1@s.whatsapp.net';
  const result = await ai.chat({ chatJid, userJid: 'u@s.whatsapp.net', text: 'who is blocked' });

  assert.equal(result.reply, 'You have 0 blocked contacts.');
  assert.equal(result.rounds, 2);
  assert.equal(result.usage.promptTokens, 250);
  assert.equal(result.usage.completionTokens, 30);
  // gpt-4o-mini: 250*0.15/1M + 30*0.60/1M = 0.0000375 + 0.000018 = 0.0000555
  assert.ok(Math.abs(result.usage.costUsd - 0.0000555) < 1e-9, `cost was ${result.usage.costUsd}`);

  const turns = await s.getRecentAiTurns(chatJid, 20);
  assert.equal(turns.length, 4);
  assert.deepEqual(turns.map((t) => t.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(turns[2].toolName, 'get_blocklist');

  const today = new Date().toISOString().slice(0, 10);
  const total = await s.getAiUsageDayTotal(today);
  assert.ok(total > 0);
});

test('ai.chat: respects rate-limit gate before calling provider', async () => {
  const s = freshStore(); installStore(s); applyAiConfig({ optInDefault: 'on', rateLimitPerUserPerHour: 2 });
  const ai = freshAi();
  const oai = require('../../services/ai/providers/openai');
  let calls = 0;
  oai.__testOverride({
    chat: { completions: { create: async () => {
      calls += 1;
      return { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 }, model: 'gpt-4o-mini' };
    } } },
  });

  const chat = 'c@s.whatsapp.net'; const user = 'u@s.whatsapp.net';
  for (let i = 0; i < 2; i += 1) {
    const dec = await ai.router.shouldRespond({ chatJid: chat, userJid: user, text: 'hello' });
    assert.equal(dec.respond, true);
    await ai.chat({ chatJid: chat, userJid: user, text: 'hello', optIn: dec.optIn });
  }
  // 3rd call hits the rate limit (2 already sent)
  const dec3 = await ai.router.shouldRespond({ chatJid: chat, userJid: user, text: 'hello' });
  assert.equal(dec3.respond, false);
  assert.equal(dec3.reason, 'rate_limit_user');
  assert.equal(calls, 2);  // provider was not called for the rate-limited turn
});

test('ai.clearMemory removes all turns for the chat', async () => {
  const s = freshStore(); installStore(s); applyAiConfig();
  const ai = freshAi();
  const chat = 'm@s.whatsapp.net';
  await s.appendAiTurn(chat, { role: 'user',      content: 'a', ts: Date.now() });
  await s.appendAiTurn(chat, { role: 'assistant', content: 'b', ts: Date.now() });
  assert.equal((await s.getRecentAiTurns(chat, 10)).length, 2);
  await ai.clearMemory(chat);
  assert.equal((await s.getRecentAiTurns(chat, 10)).length, 0);
});

test('toolRegistry: SSRF guard rejects private hosts in fetch_url', async () => {
  const s = freshStore(); installStore(s); applyAiConfig();
  const ai = freshAi();
  for (const host of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', 'localhost', '172.16.0.1']) {
    const r = await ai.tools.invoke('fetch_url', { url: `http://${host}/x` });
    assert.equal(r.ok, true, `invoke should return wrapper for ${host}`);
    assert.equal(r.result.error, 'private_host_blocked', `expected SSRF block for ${host}`);
  }
});

test('toolRegistry: getActiveSpec hides tools whose API key is missing', async () => {
  const s = freshStore(); installStore(s); applyAiConfig();
  const ai = freshAi();
  const names = ai.tools.getActiveSpec().map((t) => t.name);
  // toolWhitelist only allows get_blocklist + latest_hackernews; VT/OTX would
  // be excluded anyway, but here we also confirm whitelist filtering works
  assert.ok(names.includes('get_blocklist'));
  assert.ok(!names.includes('check_virustotal'));
});

test('cost tracker: priceFor returns Ollama=$0 and matches default fallback for unknown model', () => {
  const ai = freshAi();
  assert.deepEqual(ai.cost.priceFor('local', 'anything'), [0, 0]);
  assert.deepEqual(ai.cost.priceFor('openai', 'gpt-4o-mini'), [0.15, 0.60]);
  // unknown model -> fallback (gpt-4o-mini rates)
  assert.deepEqual(ai.cost.priceFor('openai', 'totally-not-a-real-model'), [0.15, 0.60]);
});

test('personas.pick: returns hardcoded GENERAL for general, THREAT_INTEL for default', () => {
  const ai = freshAi();
  const g = ai.personas.pick({ persona: 'general' });
  const t = ai.personas.pick({ persona: 'threat-intel' });
  const c = ai.personas.pick({ persona: 'custom', customPersona: 'You are pirate.' });
  assert.ok(g.length > 0 && g.toLowerCase().includes('friendly'));
  assert.ok(t.length > 0 && t.toLowerCase().includes('threat'));
  assert.equal(c, 'You are pirate.');
});
