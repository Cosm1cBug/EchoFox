/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { LRUCache } = require('lru-cache');
const pino = require('pino');

process.env.NODE_ENV = 'test';
const cfg = require('../../lib/configLoader');
const { schema } = require('../../lib/configSchema');
const { translateLegacy, applyEnv } = require('../../lib/configTransforms');
const guard = require('../../lib/netGuard');
const privacy = require('../../lib/privacyPolicy');
const network = require('../../lib/network');
const instance = require('../../store/instance');
const tools = require('../../services/ai/toolRegistry');
const ai = require('../../services/ai');
const telegram = require('../../services/telegram/transport');
const context = {
  chatJid: '12345@s.whatsapp.net',
  userJid: '12345@s.whatsapp.net',
  isAdmin: false,
};
const publicDns = async () => [{ address: '8.8.8.8', family: 4 }];

let store;
test.beforeEach(() => {
  cfg.__resetForTests();
  cfg.__testOverride({
    bot: { public: true },
    ai: { enabled: true, enableToolCalling: true },
    network: { httpProxy: '', httpsProxy: '', socksProxy: '' },
  });
  instance.__resetForTests();
  ai.cost._resetReservationsForTests();
  ai.router._resetForTests();
});
test.afterEach(() => {
  store?.close();
  store = null;
  instance.__resetForTests();
  telegram._resetForTests();
});
function sqlite() {
  store = require('../../store/sqliteStore').makeSQLiteStore({
    dbPath: ':memory:',
    logger: pino({ level: 'silent' }),
    groupCache: new LRUCache({ max: 20 }),
  });
  instance.setStore(store);
  return store;
}
function adapter(t, handler) {
  const ax = network.configuredAxios();
  const original = ax.defaults.adapter;
  ax.defaults.adapter = handler;
  t.after(() => {
    ax.defaults.adapter = original;
  });
}
function response(config, data, status = 200, headers = {}) {
  return { config, data, status, statusText: 'test', headers };
}

test('config: all fifteen formerly discarded sections survive real translation and validation', () => {
  const sections = {
    antiBan: { typingIndicator: false },
    network: { fetchTimeoutMs: 12345 },
    backup: { retain: 11 },
    metrics: { enabled: false },
    webhooks: { retries: 7 },
    i18n: { defaultLocale: 'fr' },
    groupSettings: { '1@g.us': { silentMode: true } },
    schedules: [{ name: 'test', cron: '0 * * * *', command: 'ping' }],
    privacy: { storeMessageBodies: false },
    ai: { enabled: true },
    tts: { defaultLang: 'fr' },
    telegram: { enabled: true },
    alerts: { enabled: false },
    audit: { retentionDays: 31 },
    leveling: { xpMultiplier: 2 },
  };
  const parsed = schema.parse(translateLegacy(sections));
  const expected = schema.parse(sections);
  for (const section of Object.keys(sections)) {
    assert.deepEqual(parsed[section], expected[section], section);
    assert.notDeepEqual(
      parsed[section],
      schema.parse({})[section],
      `${section} must really override defaults`,
    );
  }
});

test('config: mixed legacy/canonical values resolve per field, including nested API keys', () => {
  const parsed = schema.parse(
    translateLegacy({
      options: { prefix: '!', adminPrefix: '%', ReadStatus: false },
      bot: { prefix: '?' },
      omdb: { key: 'legacy', url: 'https://example.com/' },
      apis: { omdb: { apiKey: 'canonical' } },
      OpenAI: { apiKey: 'legacy-ai' },
      ai: { enabled: false },
    }),
  );
  assert.equal(parsed.bot.prefix, '?');
  assert.equal(parsed.bot.adminPrefix, '%');
  assert.equal(parsed.features.readStatus, false);
  assert.equal(parsed.apis.omdb.apiKey, 'canonical');
  assert.equal(parsed.apis.omdb.url, 'https://example.com/');
  assert.equal(parsed.ai.providers.openai.apiKey, 'legacy-ai');
  assert.equal(parsed.ai.enabled, false);
});

test('config: environment maps canonical case/nesting, typed strings, JSON, and leaf precedence', () => {
  const parsed = schema.parse(
    applyEnv(
      {},
      {
        ECHOFOX_STORE_DB_TYPE: 'POSTGRES',
        ECHOFOX_APIS_OMDB_API_KEY: '00123',
        ECHOFOX_AI_PROVIDERS_OPENAI_APIKEY: 'fake-key',
        ECHOFOX_BOT_ADMIN_PREFIX: '!',
        ECHOFOX_PRIVACY_STORE_MESSAGE_BODIES: 'false',
        ECHOFOX_AI_MAX_TOKENS: '1234',
        ECHOFOX_AI: '{"enabled":true,"maxTokens":100}',
        ECHOFOX_ADMINS: '["12345@s.whatsapp.net"]',
      },
    ),
  );
  assert.equal(parsed.storeDB.type, 'POSTGRES');
  assert.equal(parsed.apis.omdb.apiKey, '00123');
  assert.equal(parsed.ai.providers.openai.apiKey, 'fake-key');
  assert.equal(parsed.bot.adminPrefix, '!');
  assert.equal(parsed.privacy.storeMessageBodies, false);
  assert.equal(parsed.ai.maxTokens, 1234);
  assert.equal(parsed.ai.enabled, true);
  assert.deepEqual(parsed.admins, ['12345@s.whatsapp.net']);
  for (const env of [
    { ECHOFOX_AI_ENABLD: 'SECRET_CANARY' },
    { ECHOFOX_AI_ENABLED: 'SECRET_CANARY' },
    { ECHOFOX_ADMINS: 'SECRET_CANARY' },
  ]) {
    assert.throws(
      () => applyEnv({}, env),
      (error) => !error.message.includes('SECRET_CANARY'),
    );
  }
  assert.throws(
    () => applyEnv({}, { ECHOFOX_AI: '{"__proto__":{"polluted":true}}' }),
    /Invalid configuration/,
  );
  assert.equal({}.polluted, undefined);
});

test('config: config:check uses external config through the real loader and never prints credentials', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echofox-config-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.cjs');
  fs.writeFileSync(
    file,
    'module.exports = { ai: { enabled: true, providers: { openai: { apiKey: "SECRET_CANARY" } } }, privacy: { storeMessageBodies: false } };',
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('ECHOFOX_')),
  );
  const run = spawnSync(process.execPath, ['scripts/check-config.js'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...env, ECHOFOX_CONFIG: file },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.aiEnabled, true);
  assert.equal(result.storeMessageBodies, false);
  assert.equal(result.configuredProviders.openai, true);
  assert.ok(!(run.stdout + run.stderr).includes('SECRET_CANARY'));
  fs.writeFileSync(
    file,
    'module.exports = { dashboard: { enabled: true, username: "", password: "SECRET_CANARY" } };',
  );
  const invalid = spawnSync(process.execPath, ['scripts/check-config.js'], {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...env, ECHOFOX_CONFIG: file },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notEqual(invalid.status, 0);
  assert.ok(!(invalid.stdout + invalid.stderr).includes('SECRET_CANARY'));
});

test('privacy: SQLite edited payloads cannot bypass disabled body storage or excluded-chat policy', async () => {
  const s = sqlite();
  const jid = context.chatJid;
  await s.saveMessages([
    {
      key: { remoteJid: jid, id: 'canary' },
      message: { conversation: 'ORIGINAL_CANARY' },
      messageTimestamp: 100,
    },
  ]);
  cfg.__testOverride({ privacy: { storeMessageBodies: false } });
  await require('../../events/messages.update')({
    store: s,
    payload: [
      {
        key: { remoteJid: jid, id: 'canary' },
        update: { message: { conversation: 'EDIT_CANARY' } },
      },
    ],
  });
  // Direct adapter calls must be guarded too, not just event-handler calls.
  await s.recordMessageEdit(jid, 'canary', jid, 'OLD_CANARY', 'EDIT_CANARY', 101);
  await s.updateMessageBody(jid, 'canary', { conversation: 'EDIT_CANARY' }, 101);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM message_edits').get().n, 0);
  assert.equal(
    await s.getMessage({ remoteJid: jid, id: 'canary' }),
    undefined,
    'old hot-cache body is hidden',
  );
  assert.deepEqual(await s.listMessages(jid), []);
  const persisted = s.db
    .prepare('SELECT msg FROM messages WHERE jid = ? AND id = ?')
    .get(jid, 'canary');
  assert.ok(!Buffer.from(persisted.msg).includes(Buffer.from('EDIT_CANARY')));
  cfg.__testOverride({ privacy: { storeMessageBodies: true, excludeFromStore: [jid] } });
  await s.recordMessageEdit(jid, 'canary', jid, '', 'EXCLUDED_CANARY', 102);
  await s.appendAiTurn(jid, { role: 'user', content: 'EXCLUDED_CANARY', ts: 1 });
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM message_edits').get().n, 0);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM ai_conversations').get().n, 0);
});

test('privacy: shared adapter boundary denies content writes/reads without changing adapter closure', async () => {
  cfg.__testOverride({ privacy: { storeMessageBodies: false } });
  let calls = 0;
  const close = () => 'unchanged';
  const fake = privacy.withPrivacyPolicy({
    recordMessageEdit() {
      calls++;
    },
    updateMessageBody() {
      calls++;
    },
    getMessage() {
      calls++;
    },
    listMessages() {
      calls++;
    },
    appendAiTurn() {
      calls++;
    },
    getRecentAiTurns() {
      calls++;
    },
    close,
  });
  for (const name of [
    'recordMessageEdit',
    'updateMessageBody',
    'listMessages',
    'appendAiTurn',
    'getRecentAiTurns',
  ])
    await fake[name](context.chatJid);
  await fake.getMessage({ remoteJid: context.chatJid });
  assert.equal(calls, 0);
  assert.equal(fake.close, close);
});

test('privacy: memoryTurns=0 and body-disabled AI still send current prompt without persisting it', async (t) => {
  const s = sqlite();
  cfg.__testOverride({ ai: { memoryTurns: 0 }, privacy: { storeMessageBodies: false } });
  let prompt;
  t.mock.method(ai.providers.openai, 'chat', async ({ history }) => {
    prompt = history;
    return { content: 'ok', model: 'gpt-4o-mini', usage: {} };
  });
  const result = await ai.chat({ ...context, text: 'PROMPT_CANARY' });
  assert.equal(result.reply, 'ok');
  assert.deepEqual(
    prompt.map((turn) => turn.content),
    ['PROMPT_CANARY'],
  );
  assert.deepEqual(await ai.conv.recent(context.chatJid, 0), []);
  assert.equal(s.db.prepare('SELECT count(*) AS n FROM ai_conversations').get().n, 0);
});

test('tools: execution enforces own names, whitelist, enabled state, API keys and strict argument schema', async () => {
  for (const name of ['toString', 'constructor', '__proto__'])
    assert.equal((await tools.invoke(name, {}, context)).error, 'unknown_tool');
  cfg.__testOverride({ ai: { toolWhitelist: ['get_presence_in_chat', 'check_virustotal'] } });
  assert.equal(
    (await tools.invoke('fetch_url', { url: 'https://example.com' }, context)).error,
    'tool_not_allowed',
  );
  assert.equal(
    (await tools.invoke('check_virustotal', { ioc: 'example.com' }, context)).error,
    'missing_api_key',
  );
  assert.equal(
    (await tools.invoke('get_presence_in_chat', { chat_jid: context.chatJid })).error,
    'missing_caller_context',
  );
  for (const args of [
    {},
    { chat_jid: context.chatJid, limit: 201 },
    { chat_jid: context.chatJid, limit: '20' },
    { chat_jid: context.chatJid, isAdmin: true },
    [],
  ]) {
    assert.equal(
      (await tools.invoke('get_presence_in_chat', args, context)).error,
      'invalid_arguments',
    );
  }
  cfg.__testOverride({ ai: { enableToolCalling: false } });
  assert.equal(
    (await tools.invoke('get_presence_in_chat', { chat_jid: context.chatJid }, context)).error,
    'tools_disabled',
  );
});

test('tools: model cannot access another chat or global data; specs and execution apply identical permissions', async (t) => {
  const s = sqlite();
  let reads = 0;
  t.mock.method(s, 'getPresenceInChat', async () => {
    reads++;
    return ['canary'];
  });
  for (const tool of ['get_presence_in_chat', 'get_recent_messages', 'get_labels_for_chat']) {
    const key = tool === 'get_labels_for_chat' ? 'target_jid' : 'chat_jid';
    assert.equal(
      (await tools.invoke(tool, { [key]: '99999@s.whatsapp.net' }, context)).error,
      'chat_scope_denied',
    );
    assert.equal(
      (await tools.invoke(tool, { [key]: '99999@s.whatsapp.net' }, { ...context, isAdmin: true }))
        .error,
      'chat_scope_denied',
    );
  }
  assert.equal(reads, 0);
  for (const tool of ['get_blocklist', 'list_newsletters'])
    assert.equal((await tools.invoke(tool, {}, context)).error, 'admin_required');
  assert.ok(
    !tools
      .getActiveSpec(context)
      .some((spec) => ['get_blocklist', 'list_newsletters'].includes(spec.name)),
  );
  assert.equal(
    (await tools.invoke('get_presence_in_chat', { chat_jid: context.chatJid, limit: 1 }, context))
      .ok,
    true,
  );
  assert.equal(reads, 1);
  cfg.__testOverride({ privacy: { excludeFromStore: [context.chatJid] } });
  assert.deepEqual(tools.getActiveSpec(context), []);
  assert.equal(
    (await tools.invoke('get_presence_in_chat', { chat_jid: context.chatJid }, context)).error,
    'chat_excluded',
  );
});

test('SSRF: canonical IPv4/IPv6, mixed DNS answers, empty DNS and DNS failure are denied', async () => {
  for (const host of [
    '[::ffff:7f00:1]',
    '[::ffff:a00:1]',
    '[::1]',
    '[fe90::1]',
    '[fc00::1]',
    '127.1',
    '2130706433',
    '0x7f000001',
    'localhost.',
    '0.1.2.3',
    '100.64.1.1',
  ]) {
    await assert.rejects(guard.assertPublicUrl(`http://${host}/`), { code: 'EPRIVATE' }, host);
  }
  assert.equal(guard.isPrivateHost('8.8.8.8'), false);
  assert.equal(guard.isPrivateHost('2606:4700:4700::1111'), false);
  await assert.rejects(
    guard.assertPublicUrl('https://unresolved.example', {
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    }),
    { code: 'EDNS' },
  );
  await assert.rejects(guard.assertPublicUrl('https://empty.example', { lookup: async () => [] }), {
    code: 'EDNS',
  });
  await assert.rejects(
    guard.assertPublicUrl('https://mixed.example', {
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '::ffff:7f00:1', family: 6 },
      ],
    }),
    { code: 'EPRIVATE' },
  );
  const credentialUrl = new URL('https://example.com');
  credentialUrl.username = 'user';
  credentialUrl.password = 'password';
  await assert.rejects(guard.assertPublicUrl(credentialUrl.href), { code: 'EBADCREDENTIALS' });
});

test('SSRF: actual socket lookup uses validated addresses rather than looking up a second time', async () => {
  let resolutions = 0;
  const target = await guard.resolvePublicUrl('https://rebind.example/', {
    lookup: async () => [{ address: ++resolutions === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }],
  });
  const pinned = await new Promise((resolve, reject) =>
    target.lookup('rebind.example', { all: true }, (error, answers) =>
      error ? reject(error) : resolve(answers),
    ),
  );
  assert.deepEqual(pinned, [{ address: '8.8.8.8', family: 4 }]);
  assert.equal(resolutions, 1);
  await assert.rejects(
    new Promise((resolve, reject) =>
      target.lookup('other.example', {}, (error, address) =>
        error ? reject(error) : resolve(address),
      ),
    ),
    { code: 'EDNS' },
  );
});

test('SSRF: publicGet binds the pinned lookup to both agents and revalidates redirect destinations', async (t) => {
  t.mock.method(require('node:dns').promises, 'lookup', publicDns);
  let requests = 0;
  adapter(t, async (config) => {
    requests++;
    assert.equal(config.maxRedirects, 0);
    assert.equal(config.proxy, false);
    assert.equal(typeof config.httpAgent.options.lookup, 'function');
    assert.equal(typeof config.httpsAgent.options.lookup, 'function');
    assert.notEqual(config.httpsAgent.options.rejectUnauthorized, false);
    return response(config, '', 302, { location: 'http://169.254.169.254/latest/meta-data/' });
  });
  await assert.rejects(
    network.publicGet('redirect-regression', 'http://public.example', { maxRedirects: 2 }),
    { code: 'EPRIVATE' },
  );
  assert.equal(requests, 1, 'must never send the redirected private request');
  cfg.__testOverride({ network: { httpsProxy: 'http://proxy.example:8080' } });
  await assert.rejects(network.publicGet('proxy-regression', 'https://public.example'), {
    code: 'EUNSAFE_PROXY',
  });
  assert.equal(requests, 1);
});

test('HTTP: all seven AI HTTP tools cross the real Axios request boundary with URL/method', async (t) => {
  sqlite();
  cfg.__testOverride({
    apis: { virustotal: { apiKey: 'fake-vt' }, alienvault: { apiKey: 'fake-otx' } },
  });
  t.mock.method(require('node:dns').promises, 'lookup', publicDns);
  const seen = [];
  adapter(t, async (config) => {
    seen.push(config);
    assert.equal(config.method, 'get');
    assert.ok(config.url.startsWith('https://'));
    const data =
      config.url.includes('/releases?') || config.url.includes('/advisories?')
        ? []
        : config.responseType === 'text'
          ? '<rss></rss>'
          : {};
    return response(config, data);
  });
  for (const [name, args] of [
    ['check_virustotal', { ioc: 'example.com' }],
    ['search_alienvault', { ioc: 'example.com' }],
    ['latest_hackernews', {}],
    ['github_releases', { repo: 'nodejs/node' }],
    ['github_advisories', { query: 'test' }],
    ['wiki_lookup', { query: 'test' }],
    ['fetch_url', { url: 'https://public.example/test' }],
  ]) {
    const result = await tools.invoke(name, args, context);
    assert.equal(result.ok, true, name);
    assert.ok(!result.result.error, `${name}: ${result.result.error}`);
  }
  assert.equal(seen.length, 7);
});

test('HTTP: Telegram uses real Axios POST serialization and does not leak token-bearing errors', async (t) => {
  cfg.__testOverride({ telegram: { botToken: 'TOKEN_CANARY' } });
  adapter(t, async (config) => {
    assert.equal(config.method, 'post');
    assert.equal(config.url, 'https://api.telegram.org/botTOKEN_CANARY/sendMessage');
    assert.equal(JSON.parse(config.data).chat_id, '12345');
    return response(config, { ok: true, result: { message_id: 42 } });
  });
  assert.deepEqual(await telegram.sendMessage({ chatId: '12345', text: 'test' }), {
    ok: true,
    status: 200,
    messageId: 42,
  });
  network.configuredAxios().defaults.adapter = async () => {
    throw Object.assign(new Error('https://api.telegram.org/botTOKEN_CANARY/'), {
      response: {
        status: 429,
        data: { description: 'TOKEN_CANARY', parameters: { retry_after: 3 } },
      },
    });
  };
  const failure = await telegram.sendMessage({ chatId: '12345', text: 'test' });
  assert.equal(failure.ok, false);
  assert.equal(failure.retryAfter, 3);
  assert.equal(failure.error, 'http_429');
  assert.ok(!JSON.stringify(failure).includes('TOKEN_CANARY'));
});

test('AI: explicit opt-out beats mentions; private mode denies non-admin fallback', async () => {
  const s = sqlite();
  await s.setAiChatOptIn(context.chatJid, { enabled: false });
  assert.equal(
    (await ai.router.shouldRespond({ ...context, text: 'hey echofox' })).reason,
    'opted_out',
  );
  cfg.__testOverride({ bot: { public: false }, ai: { optInDefault: 'on' } });
  assert.equal(
    (
      await ai.router.shouldRespond({
        ...context,
        chatJid: '54321@s.whatsapp.net',
        text: 'hi echofox',
      })
    ).reason,
    'private_mode',
  );
});

test('AI: provider failure and bad provider setup always release reservations', async (t) => {
  sqlite();
  cfg.__testOverride({ ai: { costCapPerDayUsd: 5 } });
  t.mock.method(ai.providers.openai, 'chat', async () => {
    throw new Error('provider failed');
  });
  await assert.rejects(ai.chat({ ...context, text: 'test' }), /provider failed/);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
  await assert.rejects(
    ai.chat({ ...context, text: 'test', providerName: 'unknown' }),
    /unknown AI provider/,
  );
  assert.equal(ai.cost._reservedUsdForTests(), 0);
});

test('RSS: failed sends remain retryable; successful sends alone enter delivery ledger', async (t) => {
  const s = sqlite();
  await s.addSubscriber('rss', context.chatJid, { feeds: [{ url: 'https://feed.example/rss' }] });
  t.mock.method(require('node:dns').promises, 'lookup', publicDns);
  adapter(t, async (config) =>
    response(
      config,
      '<rss><channel><item><title>Test</title><link>https://article.example/1</link></item></channel></rss>',
    ),
  );
  const service = require('../../services/genericRssService');
  await service.checkAndDeliver({
    sendMessage: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(await s.hasSentItem('rss', context.chatJid, 'https://article.example/1'), false);
  await service.checkAndDeliver({ sendMessage: async () => ({ key: { id: 'sent' } }) });
  assert.equal(await s.hasSentItem('rss', context.chatJid, 'https://article.example/1'), true);
});

test('budget: concurrent admissions include the new reservation and cannot collectively exceed cap', async () => {
  sqlite();
  cfg.__testOverride({ ai: { costCapPerDayUsd: 1 } });
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => ai.cost.admit(0.6)));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    results
      .filter((result) => result.status === 'rejected')
      .every((result) => result.reason.code === 'ECOSTCAP'),
  );
  assert.equal(ai.cost._reservedUsdForTests(), 0.6);
  for (const result of results) if (result.status === 'fulfilled') ai.cost.release(result.value);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
});

test('budget: raw image charges persist real dollars and ledger failures do not become free capacity', async (t) => {
  const s = sqlite();
  await ai.cost.recordRaw('openai', 'image-test', 0.04);
  assert.equal(await ai.cost.todayTotalUsd(), 0.04);
  t.mock.method(s, 'recordAiUsage', async () => false);
  await assert.rejects(ai.cost.recordRaw('openai', 'image-test', 0.04), { code: 'EACCOUNTING' });
  await assert.rejects(ai.cost.admit(0.01), { code: 'EACCOUNTING' });
});

test('budget: unknown prices and unreadable balances deny admission rather than assuming cheap/free', async (t) => {
  const s = sqlite();
  assert.throws(() => ai.cost.estimateMaxCostUsd('openai', 'unknown-model'), {
    code: 'EUNKNOWN_PRICE',
  });
  cfg.__testOverride({ ai: { pricing: { 'openai:custom-model': [1, 2] } } });
  assert.deepEqual(ai.cost.priceFor('openai', 'custom-model'), [1, 2]);
  t.mock.method(s, 'getAiUsageDayTotal', async () => {
    throw new Error('unavailable');
  });
  await assert.rejects(ai.cost.admit(0.01), { code: 'EACCOUNTING' });
  await assert.rejects(ai.cost.isOverCap(), { code: 'EACCOUNTING' });
});

test('quota: simultaneous one-shot requests atomically consume persistent quota before any provider call', async (t) => {
  const s = sqlite();
  cfg.__testOverride({ ai: { rateLimitPerUserPerHour: 1 } });
  let calls = 0;
  t.mock.method(ai.providers.openai, 'chat', async () => {
    calls++;
    return { content: 'ok', usage: { promptTokens: 2, completionTokens: 1 } };
  });
  const ctx = { chat: context.chatJid, sender: context.userJid, react: async () => {} };
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => ai.oneShot({ ctx, system: 'test', prompt: 'test' })),
  );
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    results
      .filter((result) => result.status === 'rejected')
      .every((result) => result.reason.reason === 'rate_limit_user'),
  );
  assert.equal(await s.getAiRateUser(ctx.sender, Math.floor(Date.now() / 3600000)), 1);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
});

test('consent: ask, explain, summarize and imagine all honor explicit opt-out at their real entry points', async (t) => {
  const s = sqlite();
  cfg.__testOverride({ ai: { providers: { openai: { apiKey: 'fake' } } } });
  await s.setAiChatOptIn(context.chatJid, { enabled: false });
  let calls = 0;
  t.mock.method(ai.providers.openai, 'chat', async () => {
    calls++;
    throw new Error('must not call');
  });
  const ctx = {
    chat: context.chatJid,
    sender: context.userJid,
    quoted: { text: 'a'.repeat(220) },
    react: async () => {},
    reply: async () => {},
  };
  for (const name of ['ask', 'explain', 'summarize', 'imagine']) {
    await assert.rejects(
      require(`../../commands/general/${name}`).start(
        {},
        {},
        { ctx, text: name === 'summarize' ? '' : 'test' },
      ),
      (error) => error.reason === 'opted_out',
      name,
    );
  }
  assert.equal(calls, 0);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
});

test('accounting cleanup: failed reactions release reservations; uncertain provider outcomes are labelled estimates', async (t) => {
  sqlite();
  const ctx = {
    chat: context.chatJid,
    sender: context.userJid,
    react: async () => {
      throw new Error('reaction failed');
    },
  };
  await assert.rejects(ai.oneShot({ ctx, system: 'test', prompt: 'test' }), /reaction failed/);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
  assert.equal(await ai.cost.todayTotalUsd(), 0);
  ctx.react = async () => {};
  t.mock.method(ai.providers.openai, 'chat', async () => {
    throw new Error('timeout after possible billing');
  });
  await assert.rejects(ai.oneShot({ ctx, system: 'test', prompt: 'test' }), /possible billing/);
  assert.equal(ai.cost._reservedUsdForTests(), 0);
  assert.ok((await ai.cost.todayTotalUsd()) > 0);
  assert.match(
    store.db.prepare('SELECT model FROM ai_usage_daily').get().model,
    /:unconfirmed-estimate$/,
  );
});

test('logging: credentials are always redacted, including nested errors and token-bearing URLs', () => {
  const { makeSanitizer } = require('../../lib/logSanitizer');
  const sanitize = makeSanitizer(() => ({
    ai: { providers: { openai: { apiKey: 'KNOWN_SECRET_CANARY' } } },
    privacy: { minimiseLogs: false },
  }));
  const error = Object.assign(new Error('UNKNOWN_ERROR_CANARY'), {
    config: { headers: { Authorization: 'ERROR_HEADER_CANARY' } },
  });
  const credentialUrl = new URL('https://example.com/?api_key=QUERY_CANARY');
  credentialUrl.username = 'user';
  credentialUrl.password = 'URL_PASSWORD_CANARY';
  const result = JSON.stringify(
    sanitize({
      apiKey: 'STRUCTURED_CANARY',
      nested: { headers: { Authorization: 'AUTH_CANARY', 'X-API-Key': 'HEADER_CANARY' } },
      url: credentialUrl.href,
      telegram: 'https://api.telegram.org/botTELEGRAM_CANARY/sendMessage',
      err: error,
      detail: 'Failure KNOWN_SECRET_CANARY',
    }),
  );
  assert.ok(!result.includes('CANARY'), result);
});

test('logging: actual production logger sanitizes messages and child bindings', () => {
  const run = spawnSync(
    process.execPath,
    [
      '-e',
      `const l=require('./src/core/logger'); l.child({apiKey:'CHILD_CANARY'}).error({err:new Error('ERROR_CANARY'),botToken:'TOKEN_CANARY'},'https://api.telegram.org/botURL_CANARY/sendMessage');`,
    ],
    {
      cwd: path.resolve(__dirname, '../../..'),
      env: { ...process.env, NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.includes('REDACTED'));
  assert.ok(!(run.stdout + run.stderr).includes('CANARY'));
});

test('config: malformed canonical sections and conflicting aliases fail rather than becoming defaults', () => {
  for (const input of [
    { admins: null },
    { bot: null },
    { apis: 'invalid' },
    { ai: false },
    { ai: { providers: null } },
    { ai: { providers: { openai: 'invalid' } } },
    { store: { instanceId: null } },
  ]) {
    assert.equal(schema.safeParse(translateLegacy(input)).success, false);
  }
  assert.throws(
    () => applyEnv({}, { ECHOFOX_BOT_ADMINPREFIX: 'one', ECHOFOX_BOT_ADMIN_PREFIX: 'two' }),
    /Conflicting configuration/,
  );
});

test('privacy: allowed SQLite edits update canonical data AND cache; explicit zero memory reads stay empty', async () => {
  const s = sqlite();
  await s.saveMessages([
    {
      key: { remoteJid: context.chatJid, id: 'editable' },
      message: { conversation: 'original' },
      messageTimestamp: 100,
    },
  ]);
  await require('../../events/messages.update')({
    store: s,
    payload: [
      {
        key: { remoteJid: context.chatJid, id: 'editable' },
        update: { message: { conversation: 'edited' } },
      },
    ],
  });
  assert.equal(
    (await s.getMessage({ remoteJid: context.chatJid, id: 'editable' })).conversation,
    'edited',
  );
  assert.equal(s.getMessageEdits(context.chatJid, 'editable').length, 1);
  await s.appendAiTurn(context.chatJid, { role: 'user', content: 'remember', ts: 1 });
  assert.deepEqual(await s.getRecentAiTurns(context.chatJid, 0), []);
});

test('Redis accounting boundary: one atomic EVAL; corrupt ledger is not silently treated as zero', async () => {
  const { SCRIPT, recordUsage, totalUsage } = require('../../lib/redisAiLedger');
  let calls = 0;
  await recordUsage(
    {
      eval: async (script, keys, dayKey, modelKey, input, output, dollars) => {
        calls++;
        assert.equal(script, SCRIPT);
        assert.equal(keys, 1);
        assert.equal(dayKey, 'ai_usage:2026-10-22');
        assert.equal(modelKey, 'openai:test:unconfirmed-estimate');
        assert.equal(input, 1);
        assert.equal(output, 2);
        assert.equal(dollars, 0.04);
        return 1;
      },
    },
    {
      day: '2026-10-22',
      provider: 'openai',
      model: 'test:unconfirmed-estimate',
      promptTokens: 1,
      completionTokens: 2,
      costUsd: 0.04,
    },
  );
  assert.equal(calls, 1);
  assert.equal(totalUsage({ a: '{"cost_usd":0.04}', b: '{"cost_usd":0.06}' }), 0.1);
  assert.throws(() => totalUsage({ a: 'not-json' }));
  assert.throws(() => totalUsage({ a: '{"cost_usd":"invalid"}' }));
  await assert.rejects(recordUsage({ eval: async () => 0 }, { day: 'test', costUsd: 0.04 }));
});

test('supervisor health observation: naturally exited children are down even when killed=false', () => {
  const { isWorkerAlive } = require('../../lib/workerHealth');
  const alive = { pid: 123, killed: false, exitCode: null, signalCode: null };
  assert.equal(isWorkerAlive(alive), true);
  assert.equal(isWorkerAlive({ ...alive, exitCode: 0 }), false);
  assert.equal(isWorkerAlive({ ...alive, signalCode: 'SIGSEGV' }), false);
  assert.equal(isWorkerAlive({ ...alive, killed: true }), false);
  assert.equal(isWorkerAlive(null), false);
});

test('accounting: unexpected unknown response-model prices latch a fault and retain an explicit estimate', async (t) => {
  sqlite();
  t.mock.method(ai.providers.openai, 'chat', async () => ({
    content: 'test',
    model: 'unpriced-response-model',
    usage: { promptTokens: 1, completionTokens: 1 },
  }));
  const ctx = { chat: context.chatJid, sender: context.userJid, react: async () => {} };
  await assert.rejects(ai.oneShot({ ctx, system: 'test', prompt: 'test' }), {
    code: 'EUNKNOWN_PRICE',
  });
  assert.equal(ai.cost._reservedUsdForTests(), 0);
  assert.ok((await ai.cost.todayTotalUsd()) > 0);
  await assert.rejects(ai.cost.admit(0.01), { code: 'EACCOUNTING' });
});

test('crash reporting: outbound WhatsApp/Telegram notifications contain references, not raw secrets/bodies/stacks', async (t) => {
  sqlite();
  cfg.__testOverride({ channels: { errLogs: '1@g.us' }, privacy: { minimiseLogs: true } });
  const forwarded = [];
  t.mock.method(require('../../services/telegram'), 'forward', (_channel, event) => {
    forwarded.push(event.text);
  });
  const ctx = {
    chat: context.chatJid,
    sender: context.userJid,
    body: 'BODY_SECRET_CANARY',
    reply: async () => {},
    react: async () => {},
  };
  await require('../../core/commandRunner').run({
    sock: {
      sendMessage: async (_jid, payload) => {
        forwarded.push(payload.text);
      },
    },
    cmd: {
      name: 'credential-error-fixture',
      noLimit: true,
      start: async () => {
        throw new Error('ERROR_SECRET_CANARY');
      },
    },
    m: {},
    ctx,
    handlerArgs: { ctx },
  });
  await new Promise(setImmediate);
  assert.equal(forwarded.length, 2);
  assert.ok(forwarded.every((message) => message.includes('Reference:')));
  assert.ok(!forwarded.join('').includes('CANARY'));
  assert.ok(!forwarded.join('').includes(context.userJid));
});

test('non-interactive development logging retains genuine errors as JSON without a background pretty worker', () => {
  const script = `
    const assert = require('node:assert/strict');
    let ports = 0;
    require('node:async_hooks').createHook({ init(_id, type) { if (type === 'MESSAGEPORT') ports++; } }).enable();
    const log = require('./src/core/logger');
    const error = new Error('genuine-fixture-error'); error.code = 'EFIXTURE';
    log.error({ err: error, apiKey: 'NONTTY_SECRET_CANARY' }, 'nontty-fixture');
    assert.equal(ports, 0, 'piped logging must not create a pretty-transport worker');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
    timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes('NONTTY_SECRET_CANARY'));
  const entry = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((row) => row.msg === 'nontty-fixture');
  assert.equal(entry.level, 50);
  assert.equal(entry.err.type, 'Error');
  assert.equal(entry.err.code, 'EFIXTURE');
  assert.match(entry.err.stack, /at /);
});
