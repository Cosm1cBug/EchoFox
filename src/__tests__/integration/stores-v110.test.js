/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.1.0 store-method coverage (SQLite only — same rationale as stores.test.js).
 *
 * Covers the new methods added in Groups B + C:
 *   • blocklist:    setBlocklist, addToBlocklist, removeFromBlocklist, getBlocklist, isBlocked
 *   • presence:     recordPresence, getPresence, getPresenceInChat, getRecentPresence
 *   • chat state:   updateChat, markChatDeleted, listChats, getChat
 *   • contacts:     bulkUpsertContacts, getContact, listContacts, countContacts
 *   • labels:       upsertLabel, deleteLabel, getLabel, listLabels,
 *                   associateLabel, disassociateLabel, getLabelAssociations,
 *                   getLabelsForTarget
 *   • newsletters:  upsertNewsletter, updateNewsletter, getNewsletter, listNewsletters,
 *                   incrementNewsletterView, getNewsletterViews,
 *                   recordNewsletterReaction, getNewsletterReactions,
 *                   updateNewsletterSettings, getNewsletterSettings
 *   • lid-mapping:  setLidMapping, getLidMapping, getReverseLidMapping
 *   • msg-capping:  setMessageCap, getMessageCap
 *
 *   Run:  node --test src/__tests__/integration/stores-v110.test.js
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const { makeSQLiteStore } = require('../../store/sqliteStore');

function newStore() {
  const dbPath = path.join(os.tmpdir(), `echofox-v110-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`);
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

test('v1.1.0: blocklist round-trips', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.addToBlocklist('a@s.whatsapp.net');
    await store.addToBlocklist('b@s.whatsapp.net');
    assert.equal((await store.getBlocklist()).length, 2);
    assert.equal(await store.isBlocked('a@s.whatsapp.net'), true);
    assert.equal(await store.isBlocked('zzz@s.whatsapp.net'), false);

    await store.removeFromBlocklist('a@s.whatsapp.net');
    assert.equal(await store.isBlocked('a@s.whatsapp.net'), false);

    await store.setBlocklist(['x@x', 'y@x', 'z@x']);
    const bl = await store.getBlocklist();
    assert.equal(bl.length, 3);
    assert.equal(await store.isBlocked('b@s.whatsapp.net'), false); // wiped by setBlocklist
  } finally { cleanup(); }
});

test('v1.1.0: presence persists per-user per-chat', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.recordPresence('u1@x', 'composing', null, 'chat1@g.us');
    await store.recordPresence('u2@x', 'available', 1700000000000, 'chat1@g.us');
    await store.recordPresence('u3@x', 'recording', null, 'chat2@g.us');

    const u1 = await store.getPresence('u1@x');
    assert.equal(u1.last_state, 'composing');
    assert.equal(u1.chat_jid, 'chat1@g.us');

    assert.equal((await store.getPresenceInChat('chat1@g.us')).length, 2);
    assert.equal((await store.getPresenceInChat('chat2@g.us')).length, 1);
    assert.equal((await store.getRecentPresence(10)).length, 3);

    // Update u1 — same row, new state
    await store.recordPresence('u1@x', 'paused', null, 'chat1@g.us');
    assert.equal((await store.getPresence('u1@x')).last_state, 'paused');
  } finally { cleanup(); }
});

test('v1.1.0: chat extended fields update + mark deleted', async () => {
  const { store, cleanup } = newStore();
  try {
    // updateChat only updates existing rows, so seed via the baseline prepared stmt
    store.db.prepare('INSERT INTO chats (jid, name, unread, ts) VALUES (?, ?, ?, ?)').run('chat1@g.us', 'Original', 0, 100);

    await store.updateChat('chat1@g.us', { pinned: true, muted_until: 9999, archived: false });
    const c = await store.getChat('chat1@g.us');
    assert.equal(c.pinned, 1);
    assert.equal(c.muted_until, 9999);
    assert.equal(c.archived, 0);
    assert.equal(c.name, 'Original'); // baseline field preserved

    await store.markChatDeleted('chat1@g.us');
    const c2 = await store.getChat('chat1@g.us');
    assert.ok(c2.deleted_at > 0);

    assert.ok((await store.listChats()).length >= 1);
  } finally { cleanup(); }
});

test('v1.1.0: contacts bulk + extended fields', async () => {
  const { store, cleanup } = newStore();
  try {
    const n = await store.bulkUpsertContacts([
      { id: 'a@x', name: 'Alice', verifiedName: 'Alice Corp' },
      { id: 'b@x', name: 'Bob',   status: 'busy' },
      { id: 'c@x', notify: 'C C', imgUrl: 'http://x/c.jpg' },
    ]);
    assert.equal(n, 3);
    assert.equal(await store.countContacts(), 3);

    const alice = await store.getContact('a@x');
    assert.equal(alice.verified_name, 'Alice Corp');

    // Re-upsert Bob with different status — should COALESCE existing name
    await store.bulkUpsertContacts([{ id: 'b@x', status: 'available' }]);
    const bob = await store.getContact('b@x');
    assert.equal(bob.name, 'Bob');
    assert.equal(bob.status, 'available');

    assert.equal((await store.listContacts({ limit: 10 })).length, 3);
  } finally { cleanup(); }
});

test('v1.1.0: labels CRUD + soft delete', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.upsertLabel('lbl1', 'Important', 5);
    await store.upsertLabel('lbl2', 'Spam', 3);
    assert.equal((await store.listLabels()).length, 2);

    const l1 = await store.getLabel('lbl1');
    assert.equal(l1.name, 'Important');
    assert.equal(l1.color, 5);

    // Rename
    await store.upsertLabel('lbl1', 'Critical', 1);
    const l1b = await store.getLabel('lbl1');
    assert.equal(l1b.name, 'Critical');
    assert.equal(l1b.color, 1);

    // Soft delete
    await store.deleteLabel('lbl2');
    assert.equal((await store.listLabels()).length, 1); // lbl2 hidden
    const l2 = await store.getLabel('lbl2');
    assert.equal(l2.deleted, 1); // but row still queryable directly
  } finally { cleanup(); }
});

test('v1.1.0: label associations (chat + message)', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.upsertLabel('important', 'Important', 5);

    await store.associateLabel('important', 'chat', 'chat1@g.us');
    await store.associateLabel('important', 'message', 'chat1@g.us', 'msg-1');
    await store.associateLabel('important', 'chat', 'chat2@g.us');

    const assocs = await store.getLabelAssociations('important');
    assert.equal(assocs.length, 3);

    const forChat1 = await store.getLabelsForTarget('chat1@g.us');
    // chat1 is targeted twice (chat + message); both join to the same label
    assert.ok(forChat1.length >= 1);
    assert.equal(forChat1[0].name, 'Important');

    await store.disassociateLabel('important', 'chat', 'chat2@g.us');
    assert.equal((await store.getLabelAssociations('important')).length, 2);
  } finally { cleanup(); }
});

test('v1.1.0: newsletter upsert + meta JSON round-trip', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.upsertNewsletter('news1@nl', {
      name: 'Cyber Daily',
      description: 'Daily cybersecurity briefing',
      subscribers: 1500,
      raw: { extra: 'data', tags: ['security', 'news'] },
    });
    const n = await store.getNewsletter('news1@nl');
    assert.equal(n.name, 'Cyber Daily');
    assert.equal(n.subscribers, 1500);
    assert.deepEqual(n.meta, { extra: 'data', tags: ['security', 'news'] });

    // Partial update preserves other fields
    await store.updateNewsletter('news1@nl', { subscribers: 2000 });
    const n2 = await store.getNewsletter('news1@nl');
    assert.equal(n2.subscribers, 2000);
    assert.equal(n2.name, 'Cyber Daily');

    await store.upsertNewsletter('news2@nl', { name: 'Tech Weekly' });
    assert.ok((await store.listNewsletters()).length >= 2);
  } finally { cleanup(); }
});

test('v1.1.0: newsletter views increment + reactions aggregate', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.upsertNewsletter('n1@nl', { name: 'N1' });

    await store.incrementNewsletterView('n1@nl', 'msg-a');
    await store.incrementNewsletterView('n1@nl', 'msg-a');
    await store.incrementNewsletterView('n1@nl', 'msg-a');
    await store.incrementNewsletterView('n1@nl', 'msg-b');

    const views = await store.getNewsletterViews('n1@nl', 'msg-a');
    assert.equal(views[0].view_count, 3);

    const allViews = await store.getNewsletterViews('n1@nl');
    assert.equal(allViews.length, 2);

    await store.recordNewsletterReaction('n1@nl', 'msg-a', 'HEART', 5);
    await store.recordNewsletterReaction('n1@nl', 'msg-a', 'THUMBS_UP', 3);
    await store.recordNewsletterReaction('n1@nl', 'msg-a', 'HEART', 2);
    const rx = await store.getNewsletterReactions('n1@nl', 'msg-a');
    const heart = rx.find((r) => r.emoji === 'HEART');
    const thumbs = rx.find((r) => r.emoji === 'THUMBS_UP');
    assert.equal(heart.total, 7);
    assert.equal(thumbs.total, 3);
  } finally { cleanup(); }
});

test('v1.1.0: newsletter settings round-trip', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.updateNewsletterSettings('n1@nl', { muted: true, customAlert: false });
    const s1 = await store.getNewsletterSettings('n1@nl');
    assert.deepEqual(s1.settings, { muted: true, customAlert: false });

    await store.updateNewsletterSettings('n1@nl', { muted: false });
    const s2 = await store.getNewsletterSettings('n1@nl');
    assert.deepEqual(s2.settings, { muted: false }); // full replace, not merge
  } finally { cleanup(); }
});

test('v1.1.0: lid-mapping bidirectional + upsert', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.setLidMapping('lid-abc', '12345@s.whatsapp.net');
    assert.equal(await store.getLidMapping('lid-abc'), '12345@s.whatsapp.net');
    assert.equal(await store.getReverseLidMapping('12345@s.whatsapp.net'), 'lid-abc');

    // Update mapping (LID stays, JID changes)
    await store.setLidMapping('lid-abc', '67890@s.whatsapp.net');
    assert.equal(await store.getLidMapping('lid-abc'), '67890@s.whatsapp.net');

    assert.equal(await store.getLidMapping('nope'), null);
  } finally { cleanup(); }
});

test('v1.1.0: message-capping per-chat', async () => {
  const { store, cleanup } = newStore();
  try {
    await store.setMessageCap('chat1@g.us', 5000);
    const cap = await store.getMessageCap('chat1@g.us');
    assert.equal(cap.cap_value, 5000);
    assert.ok(cap.updated_at > 0);

    await store.setMessageCap('chat1@g.us', 10000);
    assert.equal((await store.getMessageCap('chat1@g.us')).cap_value, 10000);

    assert.equal(await store.getMessageCap('nonexistent@g.us'), null);
  } finally { cleanup(); }
});