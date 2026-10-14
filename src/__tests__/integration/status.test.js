/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Status / Stories read-model tests.
 *
 * There is deliberately NO new capture path: statuses are rows already in
 * `messages` with jid='status@broadcast', and views are rows already in
 * `message_receipts` for the same jid (Baileys emits message-receipt.update
 * for status broadcasts — messages-recv.js:1186). These tests pin the
 * read-only projections the dashboard consumes.
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
    `echofox-status-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  return {
    store: makeSQLiteStore({ dbPath, logger, groupCache: new LRUCache({ max: 10 }) }),
    dbPath,
  };
}

function seed(dbPath, { statuses = [], views = [] }) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const insStatus = db.prepare(
    'INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (?,?,?,?,?,?)',
  );
  for (const s of statuses) {
    insStatus.run(
      'status@broadcast',
      s.id,
      s.fromMe ? 1 : 0,
      s.participant,
      Buffer.from(proto.Message.encode(s.message).finish()),
      s.ts,
    );
  }
  const insView = db.prepare(
    'INSERT OR REPLACE INTO message_receipts (jid,message_id,recipient,status,ts) VALUES (?,?,?,?,?)',
  );
  for (const v of views) insView.run('status@broadcast', v.id, v.recipient, 3, v.ts);
  db.close();
}

test('listStatuses decodes text, image and video types', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);

  seed(dbPath, {
    statuses: [
      {
        id: 's1',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 300,
        message: proto.Message.create({ conversation: 'hello world' }),
      },
      {
        id: 's2',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 200,
        message: proto.Message.create({
          imageMessage: { caption: 'sunset', mimetype: 'image/jpeg' },
        }),
      },
      {
        id: 's3',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 100,
        message: proto.Message.create({ videoMessage: { caption: 'clip', mimetype: 'video/mp4' } }),
      },
    ],
  });

  const list = store.listStatuses({ since: 0, limit: 50 });
  assert.equal(list.length, 3);

  const byId = Object.fromEntries(list.map((x) => [x.id, x]));
  assert.equal(byId.s1.type, 'text');
  assert.equal(byId.s1.text, 'hello world');
  assert.equal(byId.s2.type, 'image');
  assert.equal(byId.s2.text, 'sunset');
  assert.equal(byId.s2.mimetype, 'image/jpeg');
  assert.equal(byId.s3.type, 'video');
  assert.equal(byId.s3.mimetype, 'video/mp4');

  store.close();
});

test('listStatuses attaches view counts from message_receipts', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);

  seed(dbPath, {
    statuses: [
      {
        id: 'mine',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 300,
        message: proto.Message.create({ conversation: 'x' }),
      },
      {
        id: 'theirs',
        fromMe: false,
        participant: '999@lid',
        ts: now - 200,
        message: proto.Message.create({ conversation: 'y' }),
      },
    ],
    views: [
      { id: 'mine', recipient: '111@s.whatsapp.net', ts: now - 250 },
      { id: 'mine', recipient: '222@s.whatsapp.net', ts: now - 240 },
    ],
  });

  const byId = Object.fromEntries(
    store.listStatuses({ since: 0, limit: 50 }).map((x) => [x.id, x]),
  );
  assert.equal(byId.mine.viewCount, 2);
  assert.equal(byId.theirs.viewCount, 0, "no receipts exist for other people's statuses");

  store.close();
});

test('getStatusViewers returns the viewer list for one status', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, {
    statuses: [
      {
        id: 'mine',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 100,
        message: proto.Message.create({ conversation: 'x' }),
      },
    ],
    views: [
      { id: 'mine', recipient: '111@s.whatsapp.net', ts: now - 90 },
      { id: 'mine', recipient: '222@s.whatsapp.net', ts: now - 80 },
    ],
  });

  const viewers = store.getStatusViewers('mine');
  assert.equal(viewers.length, 2);
  assert.deepEqual(viewers.map((v) => v.recipient).sort(), [
    '111@s.whatsapp.net',
    '222@s.whatsapp.net',
  ]);
  assert.equal(store.getStatusViewers('does-not-exist').length, 0);

  store.close();
});

test('listStatuses honours the `since` window', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, {
    statuses: [
      {
        id: 'old',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 40 * 86400,
        message: proto.Message.create({ conversation: 'old' }),
      },
      {
        id: 'new',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 60,
        message: proto.Message.create({ conversation: 'new' }),
      },
    ],
  });

  const recent = store.listStatuses({ since: now - 7 * 86400, limit: 50 });
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, 'new');

  store.close();
});

test('listStatuses filters by author', () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);
  seed(dbPath, {
    statuses: [
      {
        id: 'a',
        fromMe: true,
        participant: 'me@s.whatsapp.net',
        ts: now - 100,
        message: proto.Message.create({ conversation: 'a' }),
      },
      {
        id: 'b',
        fromMe: false,
        participant: '999@lid',
        ts: now - 90,
        message: proto.Message.create({ conversation: 'b' }),
      },
    ],
  });

  const mine = store.listStatuses({ since: 0, participant: 'me@s.whatsapp.net', limit: 50 });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, 'a');

  store.close();
});

test('listStatuses survives a row with a null body (storeMessageBodies=false)', () => {
  const { store, dbPath } = newStore();
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.prepare(
    'INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (?,?,?,?,?,?)',
  ).run('status@broadcast', 'nobody', 1, 'me@s.whatsapp.net', null, Math.floor(Date.now() / 1000));
  db.close();

  const list = store.listStatuses({ since: 0, limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].type, 'unknown', 'no body → type unknown, no throw');

  store.close();
});
