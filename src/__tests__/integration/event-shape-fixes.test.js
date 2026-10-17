/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Event-shape fixes (v1.20.0, E2–E6) integration test.
 *
 * Every payload below matches the VERIFIED Baileys 7.0.0-rc14 emit sites
 * (see BAILEYS_EVENTS_AUDIT.md):
 *
 *   E2 lid-mapping.update     {lid, pn}
 *   E3 labels.edit            single Label object OR array of labels
 *   E4 labels.association     {type:'add'|'remove', association:{type:'label_jid'|'label_message', chatId, messageId?, labelId}}
 *   E5 message-capping.update NewChatMessageCapInfo (8 account-level fields, NO jid)
 *   E6 newsletter.reaction    {id, server_id, reaction:{code?, count?, removed?}} (singular)
 *
 * Run:  node --test src/__tests__/integration/event-shape-fixes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const instance = require('../../store/instance');
const { makeSQLiteStore } = require('../../store/sqliteStore');

const lidMappingHandler = require('../../events/lid-mapping.update');
const labelsEditHandler = require('../../events/labels.edit');
const labelsAssocHandler = require('../../events/labels.association');
const messageCappingHandler = require('../../events/message-capping.update');
const newsletterReactionHandler = require('../../events/newsletter.reaction');

/** Install a recording stub store into the singleton. */
function stubStore() {
  const calls = [];
  const rec =
    (name) =>
    (...args) =>
      void calls.push([name, ...args]);
  instance.__resetForTests();
  instance.setStore({
    setLidMapping: rec('setLidMapping'),
    upsertLabel: rec('upsertLabel'),
    deleteLabel: rec('deleteLabel'),
    associateLabel: rec('associateLabel'),
    disassociateLabel: rec('disassociateLabel'),
    recordNewsletterReaction: rec('recordNewsletterReaction'),
    setMessageCapInfo: rec('setMessageCapInfo'),
    getMessageCapInfo: rec('getMessageCapInfo'),
  });
  return calls;
}

test.beforeEach(() => instance.__resetForTests());
test.after(() => instance.__resetForTests());

// ── E2: lid-mapping.update ──────────────────────────────────────────────

test('E2: lid-mapping.update maps {lid, pn} → setLidMapping', async () => {
  const calls = stubStore();
  await lidMappingHandler({ u: [{ lid: '12345@lid', pn: '62812@s.whatsapp.net' }] });
  assert.deepEqual(calls, [['setLidMapping', '12345@lid', '62812@s.whatsapp.net']]);
});

test('E2: lid-mapping.update ignores empty payloads and never uses ev.pn as lid', async () => {
  const calls = stubStore();
  await lidMappingHandler({ u: [null, {}, { pn: '62812@s.whatsapp.net' }] });
  // no lid anywhere → skip; importantly NO setLidMapping(pn, pn) garbage row
  assert.deepEqual(calls, []);
});

// ── E3: labels.edit ─────────────────────────────────────────────────────

test('E3: labels.edit accepts the single-object payload and upserts', async () => {
  const calls = stubStore();
  await labelsEditHandler({ u: { id: 'l1', name: 'work', color: 3 } });
  assert.deepEqual(calls, [['upsertLabel', 'l1', 'work', 3]]);
});

test('E3: labels.edit accepts array payloads and routes deleted → deleteLabel', async () => {
  const calls = stubStore();
  await labelsEditHandler({
    u: [
      { id: 'l1', name: 'work', color: 3 },
      { id: 'l2', name: 'old', deleted: true },
    ],
  });
  assert.deepEqual(calls, [
    ['upsertLabel', 'l1', 'work', 3],
    ['deleteLabel', 'l2'],
  ]);
});

// ── E4: labels.association ──────────────────────────────────────────────

test('E4: label_jid association stores target_type=chat with null message id', async () => {
  const calls = stubStore();
  await labelsAssocHandler({
    u: {
      type: 'add',
      association: {
        type: 'label_jid',
        chatId: '62812@g.us',
        labelId: 'l1',
      },
    },
  });
  assert.deepEqual(calls, [['associateLabel', 'l1', 'chat', '62812@g.us', null]]);
});

test('E4: label_message association stores target_type=message with the message id', async () => {
  const calls = stubStore();
  await labelsAssocHandler({
    u: {
      type: 'remove',
      association: {
        type: 'label_message',
        chatId: '62812@s.whatsapp.net',
        messageId: 'ABCDEF',
        labelId: 'l1',
      },
    },
  });
  assert.deepEqual(calls, [
    ['disassociateLabel', 'l1', 'message', '62812@s.whatsapp.net', 'ABCDEF'],
  ]);
});

test('E4: label_message association without a message id is rejected', async () => {
  const calls = stubStore();
  await labelsAssocHandler({
    u: {
      type: 'add',
      association: { type: 'label_message', chatId: 'x@s.whatsapp.net', labelId: 'l1' },
    },
  });
  assert.deepEqual(calls, []);
});

// ── E6: newsletter.reaction ─────────────────────────────────────────────

test('E6: singular reaction object is applied as +count', async () => {
  const calls = stubStore();
  await newsletterReactionHandler({
    u: { id: '12345@newsletter', server_id: '1', reaction: { code: '👍', count: 1 } },
  });
  assert.deepEqual(calls, [['recordNewsletterReaction', '12345@newsletter', '1', '👍', 1]]);
});

test('E6: removed:true inverts the count (default -1)', async () => {
  const calls = stubStore();
  await newsletterReactionHandler({
    u: { id: '12345@newsletter', server_id: '1', reaction: { code: '👍', removed: true } },
  });
  assert.deepEqual(calls, [['recordNewsletterReaction', '12345@newsletter', '1', '👍', -1]]);
});

test('E6: legacy plural array shape still works', async () => {
  const calls = stubStore();
  await newsletterReactionHandler({
    u: {
      id: '12345@newsletter',
      server_id: '2',
      reactions: [{ code: '🔥', count: 1, removed: false }],
    },
  });
  assert.deepEqual(calls, [['recordNewsletterReaction', '12345@newsletter', '2', '🔥', 1]]);
});

// ── E5: message-capping.update ──────────────────────────────────────────

test('E5: NewChatMessageCapInfo payload is whitelisted and persisted', async () => {
  const calls = stubStore();
  await messageCappingHandler({
    u: {
      total_quota: 600,
      used_quota: 25,
      cycle_start_timestamp: '2026-10-01T00:00:00Z',
      cycle_end_timestamp: '2026-10-15T00:00:00Z',
      server_sent_timestamp: '2026-10-02T10:00:00Z',
      ote_status: 'ACTIVE_IN_CURRENT_CYCLE',
      mv_status: 'NOT_ACTIVE',
      capping_status: 'FIRST_WARNING',
      unexpected_field: 'must not be persisted',
    },
  });
  assert.equal(calls.length, 1);
  const [name, info] = calls[0];
  assert.equal(name, 'setMessageCapInfo');
  assert.deepEqual(Object.keys(info).sort(), [
    'capping_status',
    'cycle_end_timestamp',
    'cycle_start_timestamp',
    'mv_status',
    'ote_status',
    'server_sent_timestamp',
    'total_quota',
    'used_quota',
  ]);
  assert.equal(info.used_quota, 25);
  assert.equal(info.capping_status, 'FIRST_WARNING');
  assert.equal('unexpected_field' in info, false);
});

test('E5: payloads without any quota field are dropped', async () => {
  const calls = stubStore();
  await messageCappingHandler({ u: {} });
  await messageCappingHandler({ u: { something_else: 1 } });
  assert.deepEqual(calls, []);
});

test('E5: sqlite store round-trips the account quota under @account', async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `echofox-capping-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  const stub = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: function () {
      return this;
    },
  };
  const store = makeSQLiteStore({
    dbPath,
    logger: stub,
    groupCache: { get: () => null, set: () => null },
  });
  try {
    const info = {
      total_quota: 600,
      used_quota: 25,
      cycle_start_timestamp: '2026-10-01T00:00:00Z',
      cycle_end_timestamp: '2026-10-15T00:00:00Z',
      server_sent_timestamp: '2026-10-02T10:00:00Z',
      ote_status: 'ACTIVE_IN_CURRENT_CYCLE',
      mv_status: 'NOT_ACTIVE',
      capping_status: 'FIRST_WARNING',
    };
    await store.setMessageCapInfo(info);
    const row = await store.getMessageCapInfo();
    assert.ok(row, 'getMessageCapInfo returned a row');
    assert.equal(row.cap_value, 25, 'cap_value mirrors used_quota');
    assert.ok(row.updated_at > 0);
    assert.deepEqual(row.info, info, 'full info JSON round-trips');

    // upsert keeps a single row
    await store.setMessageCapInfo({ ...info, used_quota: 30, capping_status: 'NONE' });
    const row2 = await store.getMessageCapInfo();
    assert.equal(row2.cap_value, 30);
    assert.equal(row2.info.capping_status, 'NONE');

    // handler + real store end-to-end
    instance.__resetForTests();
    instance.setStore(store);
    await messageCappingHandler({
      u: { total_quota: 600, used_quota: 44, capping_status: 'SECOND_WARNING' },
    });
    const row3 = await store.getMessageCapInfo();
    assert.equal(row3.info.used_quota, 44);
    assert.equal(row3.info.capping_status, 'SECOND_WARNING');
  } finally {
    store.close();
    ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(dbPath + ext, { force: true }));
    instance.__resetForTests();
  }
});
