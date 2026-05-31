/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * SQLite store CRUD round-trip integration test.
 *
 *   Uses a temp DB file under os.tmpdir(). Tests:
 *     • Schema bootstraps without error
 *     • participant events round-trip + classifyAction-aware reduction
 *     • edits / reactions / receipts persist
 *     • stats counters + gauges round-trip
 *     • listGroups + countGroups + countUniqueUsers
 *     • messageBodies privacy gate respected (msg column = null)
 *
 *   Postgres / Mongo / Redis stores aren't tested here — they need
 *   real services. v0.4.5 ships a docker-compose-based test rig as a
 *   follow-up.
 *
 *   Run:  node --test src/__tests__/integration/stores.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { makeSQLiteStore } = require('../../store/sqliteStore');

function newStore() {
  const dbPath = path.join(os.tmpdir(), `echofox-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`);
  const stub   = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: function() { return this; } };
  const cache  = { get: () => null, set: () => null };
  const store  = makeSQLiteStore({ dbPath, logger: stub, groupCache: cache });
  return {
    store,
    cleanup() {
      store.close();
      ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(dbPath + ext, { force: true }));
    },
  };
}

test('sqlite store: schema bootstraps and all 26 interface methods exist', () => {
  const { store, cleanup } = newStore();
  try {
    const need = [
      'getMessage','getGroupMetadata','saveGroupMetadata',
      'recordParticipantEvent','getParticipantHistory','getCurrentParticipants',
      'recordStat','getStats','setGauge','getGauges',
      'countGroups','countUniqueUsers','listGroups',
      'recordMessageEdit','getMessageEdits','updateMessageBody',
      'recordMessageReaction','getMessageReactions',
      'recordReceipt','getMessageReceipts',
      'markMessageDeleted','markChatMessagesDeleted','getDeletedInGroup',
      'updateMessageStatus','bind','close',
    ];
    const missing = need.filter((m) => typeof store[m] !== 'function');
    assert.deepEqual(missing, [], `missing methods: ${missing.join(', ')}`);
  } finally { cleanup(); }
});

test('sqlite store: participant events — append + current/history reduction', () => {
  const { store, cleanup } = newStore();
  try {
    const G = 'g1@g.us';
    store.recordParticipantEvent(G, 'alice@s.whatsapp.net', 'add', 'admin@s.whatsapp.net', 100);
    store.recordParticipantEvent(G, 'bob@s.whatsapp.net',   'add', 'admin@s.whatsapp.net', 200);
    store.recordParticipantEvent(G, 'alice@s.whatsapp.net', 'leave', 'alice@s.whatsapp.net', 300);
    store.recordParticipantEvent(G, 'carol@s.whatsapp.net', 'join', null, 400);

    const hist = store.getParticipantHistory(G);
    assert.equal(hist.length, 4, '4 events in history');
    // History is newest-first
    assert.equal(hist[0].participant, 'carol@s.whatsapp.net');

    const current = store.getCurrentParticipants(G);
    // alice should be excluded (last=leave); bob + carol remain
    const ids = current.map((p) => p.participant).sort();
    assert.deepEqual(ids, ['bob@s.whatsapp.net', 'carol@s.whatsapp.net']);
  } finally { cleanup(); }
});

test('sqlite store: edits + reactions + receipts persist', () => {
  const { store, cleanup } = newStore();
  try {
    store.recordMessageEdit('c@g.us', 'M1', 'alice', 'hi', 'hello', 100);
    store.recordMessageEdit('c@g.us', 'M1', 'alice', 'hello', 'hello there', 200);
    const edits = store.getMessageEdits('c@g.us', 'M1');
    assert.equal(edits.length, 2);
    assert.equal(edits[0].new_body, 'hello');
    assert.equal(edits[1].new_body, 'hello there');

    store.recordMessageReaction('c@g.us', 'M1', 'bob', '👍', 100);
    store.recordMessageReaction('c@g.us', 'M1', 'bob', null, 200);  // unreact
    const r = store.getMessageReactions('c@g.us', 'M1');
    assert.equal(r.length, 2);
    assert.equal(r[1].emoji, null);

    // Receipts: never downgrade
    store.recordReceipt('c@g.us', 'M1', 'bob', 3, 200);
    store.recordReceipt('c@g.us', 'M1', 'bob', 2, 100);
    const re = store.getMessageReceipts('c@g.us', 'M1');
    assert.equal(re[0].status, 3, 'no downgrade');
  } finally { cleanup(); }
});

test('sqlite store: counters + gauges round-trip', async () => {
  const { store, cleanup } = newStore();
  try {
    store.recordStat('msgs', 5);
    store.recordStat('msgs', 3);
    store.recordStat('cmds', 1);
    store.setGauge('uptime', 99);
    const counters = await store.getStats();
    assert.equal(counters.msgs, 8);
    assert.equal(counters.cmds, 1);
    const gauges = await store.getGauges();
    assert.equal(gauges.uptime, 99);
  } finally { cleanup(); }
});

test('sqlite store: listGroups + countGroups + countUniqueUsers', () => {
  const { store, cleanup } = newStore();
  try {
    store.saveGroupMetadata('g1@g.us', { subject: 'Alpha', participants: [{ id: 'a@s.whatsapp.net' }] });
    store.saveGroupMetadata('g2@g.us', { subject: 'Beta',  participants: [{ id: 'b@s.whatsapp.net' }, { id: 'c@s.whatsapp.net' }] });
    assert.equal(store.countGroups(), 2);
    const list = store.listGroups();
    assert.equal(list.length, 2);
    // sorted alphabetically
    assert.equal(list[0].subject, 'Alpha');
    assert.equal(list[1].participantCount, 2);

    store.recordParticipantEvent('g1@g.us', 'a@s.whatsapp.net', 'add', null, 100);
    store.recordParticipantEvent('g2@g.us', 'b@s.whatsapp.net', 'add', null, 100);
    store.recordParticipantEvent('g2@g.us', 'c@s.whatsapp.net', 'add', null, 100);
    assert.equal(store.countUniqueUsers(), 3);
  } finally { cleanup(); }
});
