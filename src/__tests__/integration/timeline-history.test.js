/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.21.0 — generic change timeline tests (dashboard history views).
 *
 *   • store: recordTimelineEvent / getTimelineEvents / countTimelineEvents
 *     round-trips + filter-aware totals (the M1 lesson)
 *   • instance hooks: addSubscriber/removeSubscriber/recordSentItem/
 *     setAiChatOptIn land timeline rows for every backend automatically
 *   • handlers: blocklist + settings + presence-transition timeline writes
 *
 *   Run:  node --test src/__tests__/integration/timeline-history.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pino = require('pino');

const { makeSQLiteStore } = require('../../store/sqliteStore');

function freshStore() {
  const tmp = path.join(
    os.tmpdir(),
    `echofox_timeline_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  const store = makeSQLiteStore({
    dbPath: tmp,
    logger: pino({ level: 'silent' }),
    groupCache: { get: () => null, set: () => null },
  });
  return {
    store,
    cleanup() {
      store.close();
      ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(tmp + ext, { force: true }));
    },
  };
}

test('timeline: round-trip + newest-first + filter-aware totals', async () => {
  const { store, cleanup } = freshStore();
  try {
    const id1 = await store.recordTimelineEvent({
      domain: 'presence',
      entityId: 'alice@s.whatsapp.net',
      field: 'state',
      oldValue: null,
      newValue: 'available',
      source: 'presence.update',
      ts: 1000,
    });
    const id2 = await store.recordTimelineEvent({
      domain: 'presence',
      entityId: 'alice@s.whatsapp.net',
      field: 'state',
      oldValue: 'available',
      newValue: 'unavailable',
      source: 'presence.update',
      ts: 2000,
    });
    await store.recordTimelineEvent({
      domain: 'presence',
      entityId: 'bob@s.whatsapp.net',
      field: 'state',
      newValue: 'available',
      ts: 1500,
    });
    await store.recordTimelineEvent({
      domain: 'blocklist',
      entityId: 'x@s.whatsapp.net',
      ts: 3000,
    });
    assert.ok(id1 && id2, 'row ids returned');

    // newest-first, all rows for the domain
    const all = await store.getTimelineEvents({ domain: 'presence' });
    assert.equal(all.length, 3);
    assert.equal(all[0].ts, 2000, 'newest first');
    assert.equal(all[0].old_value, 'available');
    assert.equal(all[0].new_value, 'unavailable');

    // entity filter
    const alice = await store.getTimelineEvents({
      domain: 'presence',
      entityId: 'alice@s.whatsapp.net',
    });
    assert.equal(alice.length, 2);

    // sinceSec filter (only ts=2000 qualifies out of 1000/1500/2000)
    const recent = await store.getTimelineEvents({ domain: 'presence', sinceSec: 1600 });
    assert.equal(recent.length, 1);

    // M1 lesson: totals honour the SAME filters as the list
    assert.equal(await store.countTimelineEvents({ domain: 'presence' }), 3);
    assert.equal(
      await store.countTimelineEvents({ domain: 'presence', entityId: 'alice@s.whatsapp.net' }),
      2,
    );
    assert.equal(await store.countTimelineEvents({ domain: 'presence', sinceSec: 1600 }), 1);
    assert.equal(await store.countTimelineEvents({ domain: 'blocklist' }), 1);
    assert.equal(await store.countTimelineEvents({ domain: 'nope' }), 0);
  } finally {
    cleanup();
  }
});

test('timeline: unknown domain rejected, values bounded and normalised', async () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(await store.recordTimelineEvent({}), null);
    assert.equal(await store.recordTimelineEvent({ domain: '   ' }), null);
    const id = await store.recordTimelineEvent({
      domain: 'contact',
      entityId: 'c@s.whatsapp.net',
      field: 'name',
      newValue: 'x'.repeat(5000),
    });
    assert.ok(id);
    const rows = await store.getTimelineEvents({ domain: 'contact' });
    assert.equal(rows[0].new_value.length, 1000, 'new_value capped at 1000');
    assert.ok(rows[0].ts > 0, 'ts defaults to now');
  } finally {
    cleanup();
  }
});

test('instance hooks: subscription + ai config mutations write timeline rows', async () => {
  const { store, cleanup } = freshStore();
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
  try {
    await store.addSubscriber('alienvault', 'u1@s.whatsapp.net');
    await store.recordSentItem('github', 'u1@s.whatsapp.net', 'https://example.com/a');
    await store.removeSubscriber('alienvault', 'u1@s.whatsapp.net');
    await store.setAiChatOptIn('g@g.us', { enabled: true, persona: 'fox' });

    const subs = await store.getTimelineEvents({ domain: 'subscription' });
    assert.equal(subs.length, 3, 'subscribe + sent + unsubscribe rows');
    const fields = subs.map((r) => r.field).sort();
    assert.deepEqual(fields, ['sent:github', 'subscribe', 'unsubscribe']);

    const ai = await store.getTimelineEvents({ domain: 'ai' });
    assert.equal(ai.length, 1);
    assert.equal(ai[0].entity_id, 'g@g.us');
    assert.ok(ai[0].new_value.includes('fox'));
  } finally {
    inst.__resetForTests();
    cleanup();
  }
});

test('handlers: blocklist.update writes add/remove rows', async () => {
  const { store, cleanup } = freshStore();
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
  const handler = require('../../events/blocklist.update');
  try {
    await handler({ u: { type: 'add', blocklist: ['bad@s.whatsapp.net'] } });
    await handler({ u: { type: 'remove', blocklist: ['bad@s.whatsapp.net'] } });
    const rows = await store.getTimelineEvents({ domain: 'blocklist' });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].new_value, 'false', 'remove row is newest');
    assert.equal(rows[1].new_value, 'true');
  } finally {
    inst.__resetForTests();
    cleanup();
  }
});

test('handlers: settings.update records account setting rows', async () => {
  const { store, cleanup } = freshStore();
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
  const handler = require('../../events/settings.update');
  try {
    await handler({ u: { setting: 'unarchiveChats', value: true } });
    await handler({
      u: { setting: 'privacySettingRelayAllCalls', value: { one: 1, two: 2 } },
    });
    const rows = await store.getTimelineEvents({ domain: 'settings' });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].entity_id, 'unarchiveChats');
    assert.equal(rows[1].new_value, 'true');
    // object values collapse to a compact key summary
    assert.equal(rows[0].new_value, 'one,two');
  } finally {
    inst.__resetForTests();
    cleanup();
  }
});

test('handlers: presence transition logs one row, repeated heartbeats do not', async () => {
  const { store, cleanup } = freshStore();
  const inst = require('../../store/instance');
  inst.__resetForTests();
  inst.setStore(store);
  const handler = require('../../events/presence.update');
  const jid = `p-${Date.now()}@s.whatsapp.net`;
  const ev = (state) => ({
    u: [{ id: 'chat@s.whatsapp.net', presences: { [jid]: { lastKnownPresence: state } } }],
  });
  try {
    await handler(ev('available'));
    await handler(ev('available')); // heartbeat — must NOT add a row
    await handler(ev('unavailable'));
    await handler(ev('available'));
    const rows = await store.getTimelineEvents({ domain: 'presence', entityId: jid });
    assert.equal(rows.length, 3, 'three transitions');
    assert.deepEqual(rows.map((r) => r.new_value).reverse(), [
      'available',
      'unavailable',
      'available',
    ]);
    assert.equal(rows[0].old_value, 'unavailable', 'old value carried');
  } finally {
    inst.__resetForTests();
    cleanup();
  }
});
