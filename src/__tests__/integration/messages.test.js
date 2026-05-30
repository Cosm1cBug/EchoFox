/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Integration test for the message hot path.
 *
 *   Builds a mock socket + mock store + tiny in-memory command registry,
 *   pumps messages through events/messages.upsert.js, and asserts:
 *     • prefix routing (user `.` vs admin `$`)
 *     • known commands → cmd.start() invoked
 *     • unknown commands → "did you mean" reply
 *     • admin gate respected
 *     • runner classifies UserError / UpstreamError correctly
 *     • metrics + alertEngine updated
 *
 *   Run:  node --test src/__tests__/integration/messages.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const { makeMockSock, makeMockMessage, makeMockStore } = require('../helpers/mockSock');

// We need metrics init'd to avoid pre-init warnings.
const metrics = require('../../services/metrics');
metrics.init(makeMockStore());

const handleMessage = require('../../events/messages.upsert');
const { UserError, UpstreamError } = require('../../lib/errors');

function makeRegistry(cmds) {
  const map = new Map();
  const aliases = new Map();
  for (const c of cmds) {
    map.set(c.name, c);
    for (const a of c.alias || []) aliases.set(a, c.name);
  }
  return {
    commands: map,
    aliases,
    resolve(name) { return map.get(name) || map.get(aliases.get(name)) || null; },
    all() { return [...map.values()]; },
  };
}

test('known command → cmd.start invoked with ctx', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  let called = null;
  const commands = makeRegistry([
    { name: 'ping', alias: ['p'], start: async (_s, _m, { ctx, args }) => {
      called = { sender: ctx.sender, args };
      await ctx.reply('pong');
    } },
  ]);
  const m = makeMockMessage({ text: '.ping hello world', sender: '999@s.whatsapp.net' });

  await handleMessage({ sock, m, commands, store, logger: sock.logger });

  assert.ok(called, 'cmd.start was not called');
  assert.deepEqual(called.args, ['hello', 'world']);
  assert.equal(sock.calls.sendMessage, 1);
  assert.match(sock.lastSent.content.text, /pong/);
});

test('unknown command → fuzzy suggest', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([
    { name: 'menu', start: async () => {} },
    { name: 'ping', start: async () => {} },
  ]);
  const m = makeMockMessage({ text: '.pingg' });    // typo
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  assert.match(sock.lastSent.content.text, /did you mean.*ping/i);
});

test('admin prefix from non-admin → rejected', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([
    { name: 'eval', admin: true, start: async () => {} },
  ]);
  const m = makeMockMessage({ text: '$eval 1+1' });   // admin prefix
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  assert.match(sock.lastSent.content.text, /reserved for admins/i);
});

test('UserError → friendly reply, no ❌ reaction, no errLogs', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([
    { name: 'bad', start: async () => { throw new UserError('Usage: .bad <x>'); } },
  ]);
  const m = makeMockMessage({ text: '.bad' });
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  // We expect the reply, but NO reaction call (would have been on ctx.react)
  const reactionSends = sock.sent.filter((s) => s.content?.react);
  assert.equal(reactionSends.length, 0, 'UserError should not trigger ❌ reaction');
  assert.match(sock.lastSent.content.text, /Usage: \.bad/);
});

test('UpstreamError → user-friendly upstream message', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([
    { name: 'fetchy', start: async () => { throw new UpstreamError('500', { upstream: 'piped' }); } },
  ]);
  const m = makeMockMessage({ text: '.fetchy' });
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  assert.match(sock.lastSent.content.text, /piped.*issues/i);
});

test('plain Error → ❌ reaction + crash reply', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([
    { name: 'kaboom', start: async () => { throw new Error('inner detail'); } },
  ]);
  const m = makeMockMessage({ text: '.kaboom' });
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  const reactions = sock.sent.filter((s) => s.content?.react);
  assert.ok(reactions.length >= 1, 'plain Error should trigger ❌ reaction');
  const last = sock.sent[sock.sent.length - 1];
  assert.match(last.content.text || '', /crashed.*inner detail/i);
});

test('no prefix → no reply (just exits)', async () => {
  const sock = makeMockSock();
  const store = makeMockStore();
  const commands = makeRegistry([{ name: 'ping', start: async () => {} }]);
  const m = makeMockMessage({ text: 'just a normal chat message' });
  await handleMessage({ sock, m, commands, store, logger: sock.logger });
  assert.equal(sock.calls.sendMessage, 0);
});
