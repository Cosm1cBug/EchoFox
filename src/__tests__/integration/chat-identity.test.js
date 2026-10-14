/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Regression tests for the merged chat/contact view and per-participant
 * presence.
 *
 * Two bugs pinned here:
 *
 *  1. presence.update recorded presence against the CHAT jid using only
 *     `Object.keys(presences)[0]`. For a group that stored one arbitrary
 *     participant's state under the GROUP jid and dropped everyone else.
 *     The dashboard's per-contact presence dots need the participant jid.
 *
 *  2. The Chats tab had no way to show identity + history + presence. The
 *     store now exposes listChatsEnriched(), a single query joining
 *     contacts / chats / lid_mapping / messages / presence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { LRUCache } = require('lru-cache');

const { makeSQLiteStore } = require('../../store/sqliteStore');
const storeInstance = require('../../store/instance');

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
    `echofox-chatid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  const store = makeSQLiteStore({ dbPath, logger, groupCache: new LRUCache({ max: 10 }) });
  // presence.update resolves the store from the process singleton, not from
  // an argument, so it must be registered before invoking the handler.
  storeInstance.__resetForTests();
  storeInstance.setStore(store);
  return { store, dbPath };
}

/** Seed a chats row directly (updateChat only updates existing rows). */
function seedChat(dbPath, jid, fields = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.prepare('INSERT OR REPLACE INTO chats (jid,name,unread,ts) VALUES (?,?,?,?)').run(
    jid,
    fields.name ?? null,
    fields.unread ?? 0,
    fields.ts ?? Math.floor(Date.now() / 1000),
  );
  db.close();
}

/** Seed a message row directly (bypasses the upsert path for determinism). */
function seedMessages(dbPath, rows) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const ins = db.prepare(
    'INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (?,?,?,?,?,?)',
  );
  for (const r of rows) ins.run(r.jid, r.id, r.fromMe ? 1 : 0, r.participant ?? null, null, r.ts);
  db.close();
}

test('presence is recorded per PARTICIPANT, not per chat', async () => {
  const { store } = newStore();
  const handler = require('../../events/presence.update');

  // A group presence update: one chat jid, two participants.
  await handler({
    u: {
      id: 'somegroup@g.us',
      presences: {
        'alice@lid': { lastKnownPresence: 'available' },
        'bob@lid': { lastKnownPresence: 'unavailable', lastSeen: 1700000000 },
      },
    },
  });

  const alice = await store.getPresence('alice@lid');
  const bob = await store.getPresence('bob@lid');
  const group = await store.getPresence('somegroup@g.us');

  assert.ok(alice, 'alice must have a presence row keyed by her own jid');
  assert.equal(alice.last_state, 'available');
  assert.ok(bob, 'bob must have a presence row — the old code dropped all but the first');
  assert.equal(bob.last_state, 'unavailable');
  assert.equal(group, null, 'nothing should be keyed by the GROUP jid');

  store.close();
});

test('1:1 presence persists durable states but not transient ones', async () => {
  const { store } = newStore();
  const handler = require('../../events/presence.update');
  const chat = '1234@s.whatsapp.net';

  // 'available' is durable → persisted
  await handler({ u: { id: chat, presences: { [chat]: { lastKnownPresence: 'available' } } } });
  const p1 = await store.getPresence(chat);
  assert.ok(p1, 'available must be persisted');
  assert.equal(p1.last_state, 'available');

  // 'composing' is transient (~10s lifetime) → cache only, NOT persisted.
  // This is deliberate: writing typing indicators to disk would flood the
  // table for no benefit.
  const { getPresenceCache } = require('../../events/presence.update');
  await handler({ u: { id: chat, presences: { [chat]: { lastKnownPresence: 'composing' } } } });
  assert.equal(getPresenceCache().get(chat)?.state, 'composing', 'cache sees the typing state');
  const p2 = await store.getPresence(chat);
  assert.equal(p2.last_state, 'available', 'the DB keeps the last DURABLE state');

  store.close();
});

test('listChatsEnriched merges identity, both addressing forms, history and presence', async () => {
  const { store, dbPath } = newStore();
  const now = Math.floor(Date.now() / 1000);

  await store.bulkUpsertContacts([
    { id: '111@s.whatsapp.net', name: 'Saved Name', notify: 'Their Pushname' },
    { id: '222@lid', name: null, notify: 'Ravi' },
  ]);
  await store.setLidMapping('222@lid', '917000000000@s.whatsapp.net');
  await store.recordPresence('111@s.whatsapp.net', 'available', null, '111@s.whatsapp.net');

  seedMessages(dbPath, [
    { jid: '111@s.whatsapp.net', id: 'm1', fromMe: false, ts: now - 86400 * 30 },
    { jid: '111@s.whatsapp.net', id: 'm2', fromMe: false, ts: now - 600 },
    { jid: '111@s.whatsapp.net', id: 'm3', fromMe: true, ts: now - 300 }, // ours — excluded
    { jid: '222@lid', id: 'm4', fromMe: false, ts: now - 3600 },
  ]);

  const out = store.listChatsEnriched({ limit: 50, offset: 0 });
  assert.equal(out.total, 2);
  assert.equal(out.items.length, 2);

  const pn = out.items.find((r) => r.jid === '111@s.whatsapp.net');
  assert.ok(pn, 'the PN-keyed contact must be present');
  assert.equal(pn.savedName, 'Saved Name');
  assert.equal(pn.pushName, 'Their Pushname');
  assert.equal(pn.firstSeenTs, now - 86400 * 30, 'first seen = oldest inbound message');
  assert.equal(pn.lastSeenTs, now - 600, 'last seen = newest inbound message (not ours)');
  assert.equal(pn.messageCount, 2, 'outbound messages must not be counted as contact activity');
  assert.equal(pn.presenceState, 'available');

  const lid = out.items.find((r) => r.jid === '222@lid');
  assert.ok(lid, 'the LID-keyed contact must be present');
  assert.equal(lid.pushName, 'Ravi');
  assert.equal(lid.phoneJid, '917000000000@s.whatsapp.net', 'PN resolved from lid_mapping');

  store.close();
});

test('listChatsEnriched returns an empty, well-formed result on a fresh DB', () => {
  const { store } = newStore();
  const out = store.listChatsEnriched();
  assert.deepEqual(out, { items: [], total: 0, limit: 200, offset: 0 });
  store.close();
});

test('a chat with no contact row still appears (UNION of both tables)', async () => {
  const { store, dbPath } = newStore();
  seedChat(dbPath, 'orphan@s.whatsapp.net', { unread: 1 });

  const out = store.listChatsEnriched({ limit: 10, offset: 0 });
  assert.equal(out.total, 1);
  assert.equal(out.items[0].jid, 'orphan@s.whatsapp.net');
  assert.equal(out.items[0].savedName, null);
  assert.equal(out.items[0].unread, 1);

  store.close();
});
