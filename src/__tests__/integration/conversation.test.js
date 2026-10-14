/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Conversation read-model tests for the dashboard Chat tab.
 *
 * Covers store.listMessages(): decoding, ordering, the `before` cursor,
 * outbound/inbound attribution, and the storeMessageBodies=false case.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { LRUCache } = require('lru-cache');
const { proto } = require('@whiskeysockets/baileys');

const { makeSQLiteStore } = require('../../store/sqliteStore');

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
    `echofox-conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  return {
    store: makeSQLiteStore({ dbPath, logger, groupCache: new LRUCache({ max: 10 }) }),
    dbPath,
  };
}

function seed(dbPath, jid, rows) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (?,?,?,?,?,?)',
  );
  for (const r of rows) {
    ins.run(
      jid,
      r.id,
      r.fromMe ? 1 : 0,
      r.participant ?? null,
      r.message ? Buffer.from(proto.Message.encode(r.message).finish()) : null,
      r.ts,
    );
  }
  db.close();
}

test('listMessages returns oldest-first with decoded text', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, 'c@s.whatsapp.net', [
    {
      id: 'b',
      fromMe: false,
      ts: now - 100,
      message: proto.Message.create({ conversation: 'second' }),
    },
    {
      id: 'a',
      fromMe: false,
      ts: now - 200,
      message: proto.Message.create({ conversation: 'first' }),
    },
    {
      id: 'c',
      fromMe: true,
      ts: now - 50,
      message: proto.Message.create({ conversation: 'mine' }),
    },
  ]);

  const out = store.listMessages('c@s.whatsapp.net', { limit: 10 });
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((m) => m.id),
    ['a', 'b', 'c'],
    'must be oldest-first',
  );
  assert.equal(out[0].text, 'first');
  assert.equal(out[2].fromMe, true);
  assert.equal(out[2].text, 'mine');

  store.close();
});

test('listMessages decodes media types and captions', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, 'c@s.whatsapp.net', [
    {
      id: 'i',
      fromMe: false,
      ts: now - 30,
      message: proto.Message.create({ imageMessage: { caption: 'pic', mimetype: 'image/jpeg' } }),
    },
    {
      id: 'v',
      fromMe: false,
      ts: now - 20,
      message: proto.Message.create({ videoMessage: { caption: 'vid', mimetype: 'video/mp4' } }),
    },
    {
      id: 'a',
      fromMe: false,
      ts: now - 10,
      message: proto.Message.create({ audioMessage: { mimetype: 'audio/ogg' } }),
    },
  ]);

  const byId = Object.fromEntries(
    store.listMessages('c@s.whatsapp.net', { limit: 10 }).map((m) => [m.id, m]),
  );
  assert.equal(byId.i.type, 'image');
  assert.equal(byId.i.text, 'pic');
  assert.equal(byId.v.type, 'video');
  assert.equal(byId.a.type, 'audio');
  assert.equal(byId.a.mimetype, 'audio/ogg');

  store.close();
});

test('listMessages honours the `before` cursor for pagination', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, 'c@s.whatsapp.net', [
    {
      id: 'p1',
      fromMe: false,
      ts: now - 300,
      message: proto.Message.create({ conversation: 'p1' }),
    },
    {
      id: 'p2',
      fromMe: false,
      ts: now - 200,
      message: proto.Message.create({ conversation: 'p2' }),
    },
    {
      id: 'p3',
      fromMe: false,
      ts: now - 100,
      message: proto.Message.create({ conversation: 'p3' }),
    },
  ]);

  const page = store.listMessages('c@s.whatsapp.net', { limit: 10, before: now - 150 });
  assert.deepEqual(
    page.map((m) => m.id),
    ['p1', 'p2'],
    'only messages older than the cursor',
  );

  store.close();
});

test('listMessages keeps rows whose body was not stored', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, 'c@s.whatsapp.net', [{ id: 'nobody', fromMe: false, ts: now - 10, message: null }]);

  const out = store.listMessages('c@s.whatsapp.net', { limit: 10 });
  assert.equal(out.length, 1, 'the message must still appear');
  assert.equal(out[0].type, 'unavailable');

  store.close();
});

test('listMessages is scoped to one chat', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, 'a@s.whatsapp.net', [
    {
      id: 'x',
      fromMe: false,
      ts: now - 10,
      message: proto.Message.create({ conversation: 'from a' }),
    },
  ]);
  seed(dbPath, 'b@s.whatsapp.net', [
    {
      id: 'y',
      fromMe: false,
      ts: now - 5,
      message: proto.Message.create({ conversation: 'from b' }),
    },
  ]);

  assert.equal(store.listMessages('a@s.whatsapp.net', { limit: 10 }).length, 1);
  assert.equal(store.listMessages('b@s.whatsapp.net', { limit: 10 })[0].text, 'from b');
  assert.equal(store.listMessages('nobody@s.whatsapp.net', { limit: 10 }).length, 0);

  store.close();
});

test('listMessages clamps the limit and rejects an empty jid', () => {
  const { store } = newStore();
  assert.deepEqual(store.listMessages('', { limit: 10 }), []);
  assert.deepEqual(store.listMessages(null), []);
  // a silly limit must not blow up
  const big = store.listMessages('c@s.whatsapp.net', { limit: 999999 });
  assert.ok(Array.isArray(big));
  store.close();
});
