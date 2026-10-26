/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { uploadWithNodeHttp } = require('@whiskeysockets/baileys');

process.env.NODE_ENV = 'test';
const cfg = require('../../lib/configLoader');
const { schema } = require('../../lib/configSchema');
const { applyEnv, translateLegacy } = require('../../lib/configTransforms');

function networkFor(t, overrides = {}) {
  cfg.__resetForTests();
  cfg.__testOverride({
    network: {
      httpProxy: '',
      httpsProxy: '',
      socksProxy: '',
      extraCaCertPath: '',
      mediaUploadTimeoutMs: 30_000,
      ...overrides,
    },
  });
  // Each fixture owns only its freshly loaded agents. No production reset hook
  // or changes to global TLS/HTTPS agents are needed to test the cache.
  const file = require.resolve('../../lib/network');
  delete require.cache[file];
  const network = require(file);
  const agents = new Set();
  t.after(() => {
    for (const agent of agents) agent?.destroy();
    cfg.__resetForTests();
  });
  return {
    network,
    track(agent) {
      if (agent) agents.add(agent);
      return agent;
    },
  };
}

test('media timeout has a validated default and typed environment override', () => {
  assert.equal(schema.parse({}).network.mediaUploadTimeoutMs, 30_000);
  const parsed = schema.parse(
    applyEnv(translateLegacy({ network: {} }), {
      ECHOFOX_NETWORK_MEDIA_UPLOAD_TIMEOUT_MS: '45000',
    }),
  );
  assert.equal(parsed.network.mediaUploadTimeoutMs, 45_000);
  assert.equal(typeof parsed.network.mediaUploadTimeoutMs, 'number');
  for (const value of [0, -1, 999, 300_001, 1000.5, Infinity, NaN, 'invalid']) {
    assert.equal(schema.safeParse({ network: { mediaUploadTimeoutMs: value } }).success, false);
  }
  assert.equal(
    schema.parse({ network: { mediaUploadTimeoutMs: 1000 } }).network.mediaUploadTimeoutMs,
    1000,
  );
  assert.equal(
    schema.parse({ network: { mediaUploadTimeoutMs: 300_000 } }).network.mediaUploadTimeoutMs,
    300_000,
  );
});

test('direct media uploads use a cached dedicated HTTPS agent, not the 5s global agent', (t) => {
  const originalGlobalTimeout = https.globalAgent.options.timeout;
  const { network, track } = networkFor(t);
  const media = track(network.getMediaAgent());
  assert.ok(media instanceof https.Agent);
  assert.notEqual(media, https.globalAgent);
  assert.equal(media.options.timeout, 30_000);
  assert.equal(media.keepAlive, true);
  assert.notEqual(media.options.rejectUnauthorized, false);
  assert.equal(network.getMediaAgent(), media);
  assert.equal(network.getWsAgent(), undefined);
  assert.equal(network.configuredAxios().defaults.timeout, 30_000);
  assert.equal(https.globalAgent.options.timeout, originalGlobalTimeout);
  assert.equal(network.getMediaUploadTimeoutMs({}), 30_000);
});

test('upload timeout is independent of Axios and WS/proxy agents', (t) => {
  const { network, track } = networkFor(t, {
    fetchTimeoutMs: 12_345,
    mediaUploadTimeoutMs: 45_000,
    httpsProxy: 'http://proxy.example.invalid:8080',
  });
  const media = track(network.getMediaAgent());
  const ws = track(network.getWsAgent());
  assert.notEqual(media, ws);
  assert.equal(media.options.timeout, 45_000);
  assert.equal(media.connectOpts.timeout, 45_000);
  assert.equal(ws.options.timeout, undefined);
  assert.equal(network.configuredAxios().defaults.timeout, 12_345);
  assert.equal(media.proxy.hostname, 'proxy.example.invalid');
});

test('media uploads preserve configured SOCKS precedence with a bounded timeout', (t) => {
  const { network, track } = networkFor(t, {
    socksProxy: 'socks5h://socks.example.invalid:1080',
    httpsProxy: 'http://https.example.invalid:8080',
  });
  const media = track(network.getMediaAgent());
  const ws = track(network.getWsAgent());
  assert.ok(media instanceof require('socks-proxy-agent').SocksProxyAgent);
  assert.equal(media.proxy.host, 'socks.example.invalid');
  assert.equal(media.options.timeout, 30_000);
  assert.equal(media.timeout, 30_000);
  assert.notEqual(media, ws);
  assert.equal(ws.options.timeout, undefined);
});

test('direct, HTTPS-proxy and SOCKS media agents retain custom roots and TLS verification', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'echofox-upload-ca-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const certPath = path.join(dir, 'extra-ca.pem');
  // Public certificate already in Node's trust store; no private key fixture.
  const cert = tls.rootCertificates[0];
  await fs.writeFile(certPath, cert);
  for (const proxy of [
    {},
    { httpsProxy: 'http://proxy.example.invalid:8080' },
    { socksProxy: 'socks5h://proxy.example.invalid:1080' },
  ]) {
    const { network, track } = networkFor(t, { ...proxy, extraCaCertPath: certPath });
    const media = track(network.getMediaAgent());
    assert.ok(media.options.ca.includes(cert));
    assert.equal(media.options.ca.length, tls.rootCertificates.length + 1);
    assert.notEqual(media.options.rejectUnauthorized, false);
    if (media.connectOpts) assert.ok(media.connectOpts.ca.includes(cert));
  }
});

test('invalid proxies and missing requested CA files fail closed, never fall back to direct', (t) => {
  for (const settings of [
    { httpsProxy: 'not a URL' },
    { socksProxy: 'socks9://proxy.example.invalid:1080' },
    { extraCaCertPath: path.join(os.tmpdir(), 'echofox-definitely-missing-ca', 'ca.pem') },
  ]) {
    const { network } = networkFor(t, settings);
    assert.throws(
      () => network.getMediaAgent(),
      /Cannot initialize WhatsApp media transport|Cannot load configured extra CA/,
    );
  }
});

async function uploadFixture(t, { delayMs = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'echofox-upload-test-'));
  const filePath = path.join(directory, 'image.bin');
  await fs.writeFile(filePath, Buffer.alloc(1024, 1));
  const timers = new Set();
  const agents = new Set();
  const requests = [];
  // Loopback HTTP isolates timeout semantics shared by Node's HTTP/HTTPS
  // Agent implementation. Production still uses HTTPS with verified TLS.
  const server = http.createServer((req, res) => {
    req.resume();
    requests.push(req);
    if (delayMs !== null) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!res.destroyed) res.end(JSON.stringify({ url: 'https://example.invalid/uploaded' }));
      }, delayMs);
      timers.add(timer);
    }
  });
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    for (const agent of agents) agent.destroy();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    filePath,
    requests,
    url: `http://127.0.0.1:${server.address().port}/upload`,
    agent(timeout) {
      const agent = new http.Agent({ keepAlive: true, timeout });
      agents.add(agent);
      return agent;
    },
  };
}

test('real Baileys uploader: delayed response fails with short inherited agent timeout and succeeds with media timeout', async (t) => {
  const { network, track } = networkFor(t, { mediaUploadTimeoutMs: 10_000 });
  const media = track(network.getMediaAgent());
  const fixture = await uploadFixture(t, { delayMs: 750 });
  const request = { url: fixture.url, filePath: fixture.filePath, headers: {} };
  // Scale the inherited 5s timeout down for a deterministic, fast local repro.
  const shortAgent = fixture.agent(100);
  await assert.rejects(uploadWithNodeHttp({ ...request, agent: shortAgent }), /Upload timeout/);
  const uploadAgent = fixture.agent(media.options.timeout);
  assert.deepEqual(await uploadWithNodeHttp({ ...request, agent: uploadAgent }), {
    url: 'https://example.invalid/uploaded',
  });
  // Explicit per-send mediaUploadTimeoutMs also overrides a shorter agent.
  assert.deepEqual(await uploadWithNodeHttp({ ...request, agent: shortAgent, timeoutMs: 10_000 }), {
    url: 'https://example.invalid/uploaded',
  });
  assert.ok(fixture.requests.length >= 2);
});

test('real Baileys uploader still rejects a stalled request; uploads were not made unbounded', async (t) => {
  const { network, track } = networkFor(t, { mediaUploadTimeoutMs: 1000 });
  const media = track(network.getMediaAgent());
  const fixture = await uploadFixture(t);
  const agent = fixture.agent(media.options.timeout);
  await assert.rejects(
    uploadWithNodeHttp({
      url: fixture.url,
      filePath: fixture.filePath,
      headers: {},
      agent,
    }),
    /Upload timeout/,
  );
});

test('worker uses the dedicated media agent without replacing the WebSocket agent', async () => {
  const worker = await fs.readFile(path.join(__dirname, '../../core/worker.js'), 'utf8');
  assert.match(worker, /agent: getWsAgent\(\)/);
  assert.match(worker, /fetchAgent: getMediaAgent\(\)/);
  assert.doesNotMatch(worker, /fetchAgent: getWsAgent\(\)/);
});
