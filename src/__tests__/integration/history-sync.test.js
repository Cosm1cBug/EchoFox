/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * History-sync persistence tests (v1.20.0 — E1 fix).
 *
 * Baileys delivers history messages ONLY inside the `messaging-history.set`
 * payload (they are never re-emitted via `messages.upsert`). Before E1 the
 * handler persisted nothing: it called store.saveChat/saveContact (which no
 * backend implemented) and left `messages[]` on the floor. These tests pin
 * the fixed contract:
 *
 *   messages[]      → store.saveMessages()  (same non-human filter as live)
 *   chats[]         → store.saveChat()
 *   contacts[]      → store.bulkUpsertContacts()
 *   lidPnMappings[] → store.setLidMapping(lid, pn)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { LRUCache } = require('lru-cache');
const { proto } = require('@whiskeysockets/baileys');

const { makeSQLiteStore } = require('../../store/sqliteStore');
const onHistorySet = require('../../events/messaging-history.set');

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return this;
  },
};

function newStore() {
  const dbPath = path.join(
    os.tmpdir(),
    `echofox-hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  return {
    store: makeSQLiteStore({ dbPath, logger, groupCache: new LRUCache({ max: 10 }) }),
    dbPath,
  };
}

function msg(id, text, opts = {}) {
  return {
    key: {
      remoteJid: opts.jid || '123@s.whatsapp.net',
      id,
      fromMe: !!opts.fromMe,
      participant: opts.participant ?? null,
    },
    message: proto.Message.create({ conversation: text }),
    messageTimestamp: opts.ts ?? Math.floor(Date.now() / 1000),
  };
}

test('messaging-history.set persists history messages (they never arrive via messages.upsert)', async () => {
  const { store } = newStore();
  const now = Math.floor(Date.now() / 1000);

  await onHistorySet({
    sock: null,
    store,
    payload: {
      messages: [
        msg('m2', 'older', { ts: now - 200 }),
        msg('m1', 'newer', { ts: now - 100 }),
        msg('mine', 'from me', { ts: now - 50, fromMe: true }),
      ],
    },
  });

  const out = store.listMessages('123@s.whatsapp.net', { limit: 10 });
  assert.equal(out.length, 3, 'all three history messages must land in the store');
  assert.deepEqual(
    out.map((m) => m.id),
    ['m2', 'm1', 'mine'],
    'oldest-first for the conversation view',
  );
  assert.equal(out[0].text, 'older');
  assert.equal(out[2].fromMe, true);

  // getMessage() (Baileys retry contract) must find backfilled messages too
  const decoded = await store.getMessage({ remoteJid: '123@s.whatsapp.net', id: 'm1' });
  assert.equal(decoded?.conversation, 'newer');

  store.close();
});

test('history sync filters non-human content exactly like the live path', async () => {
  const { store } = newStore();

  const human = msg('h1', 'hello there');
  const noise = [
    {
      key: { remoteJid: '123@s.whatsapp.net', id: 'p1', fromMe: false },
      message: proto.Message.create({ protocolMessage: { type: 0 } }),
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
    {
      key: { remoteJid: '123@s.whatsapp.net', id: 'r1', fromMe: false },
      message: proto.Message.create({ reactionMessage: { text: '👍' } }),
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
    {
      key: { remoteJid: '123@s.whatsapp.net', id: 's1', fromMe: false },
      message: proto.Message.create({ senderKeyDistributionMessage: {} }),
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  ];

  await onHistorySet({ sock: null, store, payload: { messages: [human, ...noise] } });

  const out = store.listMessages('123@s.whatsapp.net', { limit: 10 });
  assert.equal(out.length, 1, 'only the human message is conversation');
  assert.equal(out[0].id, 'h1');

  store.close();
});

test('messaging-history.set saves chats (name/unread/ts + pinned/mute/archived)', async () => {
  const { store } = newStore();
  const now = Math.floor(Date.now() / 1000);

  await onHistorySet({
    sock: null,
    store,
    payload: {
      chats: [
        {
          id: '123@s.whatsapp.net',
          name: 'Saved Name',
          unreadCount: 3,
          conversationTimestamp: now - 10,
          pinned: true,
          mute: 0,
          archived: false,
        },
      ],
    },
  });

  const chat = await store.getChat('123@s.whatsapp.net');
  assert.ok(chat, 'chat row must exist after history sync');
  assert.equal(chat.name, 'Saved Name');
  assert.equal(chat.unread, 3);
  assert.equal(chat.ts, now - 10);
  assert.equal(chat.pinned, 1);
  assert.equal(chat.archived, 0);

  store.close();
});

test('messaging-history.set saves contacts (incl. status + verifiedName)', async () => {
  const { store } = newStore();

  await onHistorySet({
    sock: null,
    store,
    payload: {
      contacts: [
        {
          id: '123@s.whatsapp.net',
          name: 'Alice',
          notify: 'Ali',
          imgUrl: 'https://pps.example/pic.jpg',
          status: 'hey there',
          verifiedName: 'Alice Corp',
        },
      ],
    },
  });

  const c = await store.getContact('123@s.whatsapp.net');
  assert.ok(c, 'contact row must exist after history sync');
  assert.equal(c.name, 'Alice');
  assert.equal(c.notify, 'Ali');
  assert.equal(c.img_url, 'https://pps.example/pic.jpg');
  assert.equal(c.status, 'hey there');
  assert.equal(c.verified_name, 'Alice Corp');

  store.close();
});

test('messaging-history.set persists lidPnMappings from the sync', async () => {
  const { store } = newStore();

  await onHistorySet({
    sock: null,
    store,
    payload: {
      lidPnMappings: [{ lid: '999@lid', pn: '15551234567@s.whatsapp.net' }],
    },
  });

  assert.equal(await store.getLidMapping('999@lid'), '15551234567@s.whatsapp.net');
  assert.equal(await store.getReverseLidMapping('15551234567@s.whatsapp.net'), '999@lid');

  store.close();
});

test('handler is safe on empty payloads and missing stores', async () => {
  const { store } = newStore();
  await onHistorySet({ sock: null, store, payload: null });
  await onHistorySet({ sock: null, store, payload: {} });
  await onHistorySet({ sock: null, store: null, payload: { messages: [msg('x', 'y')] } });
  store.close();
});

test('store.saveMessages is the shared path for live upserts and history (filter parity)', async () => {
  const { store } = newStore();

  const n = await store.saveMessages([
    msg('l1', 'live-style'),
    {
      key: { remoteJid: '123@s.whatsapp.net', id: 'l2', fromMe: false },
      message: proto.Message.create({ protocolMessage: { type: 0 } }),
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  ]);
  assert.equal(n, 1, 'returns the number of rows actually written');

  const out = store.listMessages('123@s.whatsapp.net', { limit: 10 });
  assert.equal(out.length, 1);

  store.close();
});
