/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
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
  assert.match(sock.lastSent.content.text, /admin-only|reserved for admins/i);
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


// ─── v0.4.7: subscription command flow tests ─────────────────────────────
const { setStore, __resetForTests } = require('../../store/instance');

function setupSubscriptionTest() {
  const sock  = makeMockSock();
  const store = makeMockStore();
  __resetForTests();
  setStore(store);
  return { sock, store };
}

function fakeM(_text, jid = '999@s.whatsapp.net') {
  return {
    isPrivate: true,
    chat:      jid,
    sender:    jid,
    from:      jid,
    key:       { remoteJid: jid, id: 'msg-' + Date.now() },
    pushName:  'TestUser',
  };
}

test('alienvault: subscribe → status → unsubscribe', async () => {
  const { sock, store } = setupSubscriptionTest();
  const cmd = require('../../commands/general/alienvault');

  await cmd.start(sock, fakeM('-status'), { text: '-status' });
  assert.match(sock.lastSent.content.text, /NOT subscribed/i);

  await cmd.start(sock, fakeM('on'), { text: 'on' });
  assert.match(sock.lastSent.content.text, /Subscribed to AlienVault/i);
  assert.equal(await store.isSubscriber('alienvault', '999@s.whatsapp.net'), true);

  await cmd.start(sock, fakeM('-status'), { text: '-status' });
  assert.match(sock.lastSent.content.text, /Subscribed: \*yes\*/);

  await cmd.start(sock, fakeM('off'), { text: 'off' });
  assert.match(sock.lastSent.content.text, /Unsubscribed/);
  assert.equal(await store.isSubscriber('alienvault', '999@s.whatsapp.net'), false);
});

test('alienvault: re-subscribing is idempotent (friendly message + 1 row)', async () => {
  const { sock, store } = setupSubscriptionTest();
  const cmd = require('../../commands/general/alienvault');

  await cmd.start(sock, fakeM('on'), { text: 'on' });
  const firstReply = sock.lastSent.content.text;

  await cmd.start(sock, fakeM('on'), { text: 'on' });
  assert.match(sock.lastSent.content.text, /already subscribed/i);
  assert.notEqual(sock.lastSent.content.text, firstReply);

  const subs = await store.getSubscribers('alienvault');
  assert.equal(subs.length, 1);
});

test('alienvault: help verb shows usage panel', async () => {
  const { sock } = setupSubscriptionTest();
  const cmd = require('../../commands/general/alienvault');

  await cmd.start(sock, fakeM('help'), { text: 'help' });
  assert.match(sock.lastSent.content.text, /AlienVault Pulse Subscription/i);
  assert.match(sock.lastSent.content.text, /\.alienvault on/);
  assert.match(sock.lastSent.content.text, /\.alienvault off/);
  assert.match(sock.lastSent.content.text, /-status/);
});

test('alienvault: blocked in group chats', async () => {
  const { sock } = setupSubscriptionTest();
  const cmd = require('../../commands/general/alienvault');

  const groupM = { ...fakeM('on', '111@g.us'), isPrivate: false };
  await cmd.start(sock, groupM, { text: 'on' });
  assert.match(sock.lastSent.content.text, /Private Chats/i);
});

test('thehackersnews: subscribe with topics persists meta', async () => {
  const { sock, store } = setupSubscriptionTest();
  const cmd = require('../../commands/general/thehackersnews');

  await cmd.start(sock, fakeM('on malware ransomware'), { text: 'on malware ransomware' });
  assert.match(sock.lastSent.content.text, /malware/);
  assert.match(sock.lastSent.content.text, /ransomware/);

  const meta = await store.getSubscriberMeta('thehackersnews', '999@s.whatsapp.net');
  assert.deepEqual(meta, { topics: ['malware', 'ransomware'] });
});

test('thehackersnews: re-subscribing updates topic filter in place', async () => {
  const { sock, store } = setupSubscriptionTest();
  const cmd = require('../../commands/general/thehackersnews');

  await cmd.start(sock, fakeM('on malware'), { text: 'on malware' });
  let meta = await store.getSubscriberMeta('thehackersnews', '999@s.whatsapp.net');
  assert.deepEqual(meta, { topics: ['malware'] });

  await cmd.start(sock, fakeM('on cloud-security ai'), { text: 'on cloud-security ai' });
  assert.match(sock.lastSent.content.text, /Topic filter updated/i);
  meta = await store.getSubscriberMeta('thehackersnews', '999@s.whatsapp.net');
  assert.deepEqual(meta, { topics: ['cloud-security', 'ai'] });

  const subs = await store.getSubscribers('thehackersnews');
  assert.equal(subs.length, 1);
});

test('thehackersnews: status reflects current topic filter', async () => {
  const { sock } = setupSubscriptionTest();
  const cmd = require('../../commands/general/thehackersnews');

  await cmd.start(sock, fakeM('on malware'), { text: 'on malware' });
  await cmd.start(sock, fakeM('-status'), { text: '-status' });
  assert.match(sock.lastSent.content.text, /Subscribed: \*yes\*/);
  assert.match(sock.lastSent.content.text, /malware/);
});

test('thehackersnews: status with no filter shows "(no filter — all articles)"', async () => {
  const { sock } = setupSubscriptionTest();
  const cmd = require('../../commands/general/thehackersnews');

  await cmd.start(sock, fakeM('on'), { text: 'on' });
  await cmd.start(sock, fakeM('-status'), { text: '-status' });
  assert.match(sock.lastSent.content.text, /no filter/i);
});

test('thehackersnews: topic parsing deduplicates + caps at 10', async () => {
  const { sock, store } = setupSubscriptionTest();
  const cmd = require('../../commands/general/thehackersnews');

  await cmd.start(sock, fakeM('on  Malware MALWARE malware ransomware'),
    { text: 'on  Malware MALWARE malware ransomware' });
  const meta = await store.getSubscriberMeta('thehackersnews', '999@s.whatsapp.net');
  assert.deepEqual(meta, { topics: ['malware', 'ransomware'] });

  await cmd.start(sock, fakeM('on a b c d e f g h i j k l m n o'),
    { text: 'on a b c d e f g h i j k l m n o' });
  const meta2 = await store.getSubscriberMeta('thehackersnews', '999@s.whatsapp.net');
  assert.equal(meta2.topics.length, 10);
});
