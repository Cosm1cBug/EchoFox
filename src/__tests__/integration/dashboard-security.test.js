/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { startDashboard } = require('../../dashboard/server');

const password = 'dashboard-fixture-password';
const authorization = 'Basic ' + Buffer.from(`admin:${password}`).toString('base64');
async function server(t, patch = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echofox-dashboard-fixture-'));
  const config = {
    dashboard: {
      username: 'admin',
      password,
      host: '0.0.0.0',
      buildOnBoot: false,
      authMaxFailures: 3,
      authWindowMs: 1000,
      trustProxy: false,
      ...patch,
    },
  };
  const app = startDashboard(0, {}, config, { reactDir: dir });
  t.after(async () => {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await once(app, 'listening');
  return { app, port: app.address().port, dir };
}
function request(port, url = '/', headers = { Authorization: authorization }, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: url, method, headers, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (part) => {
          body += part;
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('dashboard: missing credentials cannot disable authentication at the HTTP boundary', () => {
  assert.throws(
    () => startDashboard(0, {}, { dashboard: { username: '', password } }),
    /authentication requires/,
  );
  assert.throws(
    () => startDashboard(0, {}, { dashboard: { username: 'admin', password: '' } }),
    /authentication requires/,
  );
});

test('dashboard: repeated successful polling never consumes failed-authentication budget', async (t) => {
  const { port } = await server(t);
  for (let i = 0; i < 40; i++) assert.equal((await request(port)).status, 301);
  assert.equal(
    (await request(port, '/', {})).status,
    401,
    'fresh failure must not inherit successful polling',
  );
});

test('dashboard: bad Basic credentials are bounded, with no unauthenticated API/data access', async (t) => {
  const { port } = await server(t);
  for (let i = 0; i < 3; i++) assert.equal((await request(port, '/api/contacts', {})).status, 401);
  const blocked = await request(port, '/api/contacts', {});
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) >= 1);
});

test('dashboard: mutations require intentional header and refuse cross-origin browser requests', async (t) => {
  const { port } = await server(t);
  assert.equal(
    (await request(port, '/api/not-a-route', { Authorization: authorization }, 'POST')).status,
    403,
  );
  assert.equal(
    (
      await request(
        port,
        '/api/not-a-route',
        {
          Authorization: authorization,
          'X-EchoFox-Request': '1',
          Origin: 'https://attacker.example',
        },
        'POST',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        port,
        '/api/not-a-route',
        {
          Authorization: authorization,
          'X-EchoFox-Request': '1',
          Origin: `http://127.0.0.1:${port}`,
        },
        'POST',
      )
    ).status,
    404,
  );
});

test('dashboard: completed manual/background build replaces maintenance routes without server restart', async (t) => {
  const { port, dir } = await server(t);
  assert.equal((await request(port, '/dashboard/')).status, 503);
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>READY_CANARY</html>');
  const ready = await request(port, '/dashboard/');
  assert.equal(ready.status, 200);
  assert.match(ready.body, /READY_CANARY/);
  assert.equal((await request(port, '/dashboard/any-spa-route')).status, 200);
});
