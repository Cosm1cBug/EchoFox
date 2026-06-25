/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.14.0 — group settings change history integration tests.
 *
 *   Covers:
 *     • schema helpers: serialise / isChanged / diff / actorForField
 *     • sqliteStore.recordGroupSettingsChange + getGroupSettingsHistory
 *     • end-to-end: diff(oldMeta, newMeta) → recordGroupSettingsChange
 *       → getGroupSettingsHistory returns the expected events
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pino = require('pino');

function freshStore() {
  const tmp = path.join(
    os.tmpdir(),
    `echofox_settings_v1140_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  try {
    fs.rmSync(tmp, { force: true });
  } catch (_) {}
  const { LRUCache } = require('lru-cache');
  const { makeSQLiteStore } = require('../../store/sqliteStore');
  const store = makeSQLiteStore({
    dbPath: tmp,
    logger: pino({ level: 'silent' }),
    groupCache: new LRUCache({ max: 100 }),
  });
  return { store, path: tmp };
}

/* ─── schema helpers ─────────────────────────────────────────────── */

test('schema.serialise — primitive coercion', () => {
  const { serialise } = require('../../store/schema/groupSettingsEvents');
  assert.equal(serialise(null), null);
  assert.equal(serialise(undefined), null);
  assert.equal(serialise(true), 'true');
  assert.equal(serialise(false), 'false');
  assert.equal(serialise(0), '0');
  assert.equal(serialise(42), '42');
  assert.equal(serialise('hello'), 'hello');
});

test('schema.isChanged — equality semantics', () => {
  const { isChanged } = require('../../store/schema/groupSettingsEvents');
  // No change cases
  assert.equal(isChanged(null, null), false);
  assert.equal(isChanged(null, undefined), false, 'null and undefined both serialise to null');
  assert.equal(isChanged(true, true), false);
  assert.equal(isChanged('abc', 'abc'), false);
  assert.equal(isChanged(0, 0), false);
  // Change cases
  assert.equal(isChanged(null, 'x'), true);
  assert.equal(isChanged(true, false), true);
  assert.equal(isChanged('old', 'new'), true);
  assert.equal(isChanged(86400, 604800), true);
  // Cross-type but same serialised form: '0' vs 0 → both serialise to '0' → NOT changed
  assert.equal(isChanged('0', 0), false);
});

test('schema.diff — only tracked fields appear', () => {
  const { diff } = require('../../store/schema/groupSettingsEvents');
  const oldMeta = { subject: 'old', desc: 'd', untracked: 'x' };
  const newMeta = { subject: 'new', desc: 'd', untracked: 'y' };
  const events = diff(oldMeta, newMeta);
  assert.equal(events.length, 1);
  assert.equal(events[0].field, 'subject');
  assert.equal(events[0].oldValue, 'old');
  assert.equal(events[0].newValue, 'new');
});

test('schema.diff — null oldMeta treats every field as initial', () => {
  const { diff } = require('../../store/schema/groupSettingsEvents');
  const newMeta = {
    subject: 'Hello',
    desc: 'world',
    announce: true,
    restrict: false,
    ephemeralDuration: 0, // 0 → null per the diff rule (undefined/null skipped)
  };
  const events = diff(null, newMeta);
  // 4 tracked fields with defined non-null values (ephemeralDuration=0 IS null-ish)
  // Actually the rule says "skip undefined/null only" — 0 should count.
  const fields = events.map((e) => e.field).sort();
  assert.deepEqual(fields, ['announce', 'desc', 'ephemeralDuration', 'restrict', 'subject']);
  for (const e of events) {
    assert.equal(e.oldValue, null);
  }
});

test('schema.diff — multiple field changes simultaneously', () => {
  const { diff } = require('../../store/schema/groupSettingsEvents');
  const oldMeta = { subject: 'a', desc: 'b', announce: false, restrict: false };
  const newMeta = { subject: 'a', desc: 'B!', announce: true, restrict: false };
  const events = diff(oldMeta, newMeta);
  const fields = events.map((e) => e.field).sort();
  assert.deepEqual(fields, ['announce', 'desc']);
});

test('schema.actorForField — only subject + desc get actors', () => {
  const { actorForField } = require('../../store/schema/groupSettingsEvents');
  const meta = {
    subjectOwner: 'admin1@s.whatsapp.net',
    descOwner: 'admin2@s.whatsapp.net',
  };
  assert.equal(actorForField('subject', meta), 'admin1@s.whatsapp.net');
  assert.equal(actorForField('desc', meta), 'admin2@s.whatsapp.net');
  assert.equal(actorForField('announce', meta), null);
  assert.equal(actorForField('restrict', meta), null);
  assert.equal(actorForField('ephemeralDuration', meta), null);
});

/* ─── store: record + read ───────────────────────────────────────── */

test('store.recordGroupSettingsChange + getGroupSettingsHistory: round trip', async () => {
  const { store, path: p } = freshStore();
  try {
    await store.recordGroupSettingsChange(
      'g1@g.us',
      'subject',
      'Old Name',
      'New Name',
      'admin@s.whatsapp.net',
      1700000000,
    );
    const hist = await store.getGroupSettingsHistory('g1@g.us');
    assert.equal(hist.length, 1);
    assert.equal(hist[0].field, 'subject');
    assert.equal(hist[0].old_value, 'Old Name');
    assert.equal(hist[0].new_value, 'New Name');
    assert.equal(hist[0].actor, 'admin@s.whatsapp.net');
    assert.equal(hist[0].ts, 1700000000);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getGroupSettingsHistory: returns newest first', async () => {
  const { store, path: p } = freshStore();
  try {
    // Insert 3 events in non-chronological order; verify desc ts ordering.
    await store.recordGroupSettingsChange('g2@g.us', 'subject', 'a', 'b', null, 1700000000);
    await store.recordGroupSettingsChange('g2@g.us', 'desc', null, 'hi', null, 1700002000);
    await store.recordGroupSettingsChange('g2@g.us', 'announce', 'false', 'true', null, 1700001000);
    const hist = await store.getGroupSettingsHistory('g2@g.us');
    assert.equal(hist.length, 3);
    assert.deepEqual(
      hist.map((h) => h.ts),
      [1700002000, 1700001000, 1700000000],
    );
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getGroupSettingsHistory: scopes to jid + honours limit', async () => {
  const { store, path: p } = freshStore();
  try {
    for (let i = 0; i < 5; i++) {
      await store.recordGroupSettingsChange(
        'groupA@g.us',
        'subject',
        `v${i}`,
        `v${i + 1}`,
        null,
        1700000000 + i,
      );
    }
    await store.recordGroupSettingsChange('groupB@g.us', 'subject', 'x', 'y', null, 1700000000);
    assert.equal((await store.getGroupSettingsHistory('groupA@g.us')).length, 5);
    assert.equal((await store.getGroupSettingsHistory('groupB@g.us')).length, 1);
    assert.equal((await store.getGroupSettingsHistory('groupC@g.us')).length, 0);
    // Limit honoured
    assert.equal((await store.getGroupSettingsHistory('groupA@g.us', 3)).length, 3);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getGroupSettingsHistory: limit clamps to 1..2000', async () => {
  const { store, path: p } = freshStore();
  try {
    await store.recordGroupSettingsChange('g@g.us', 'subject', 'a', 'b', null, 1700000000);
    // Out-of-range limits don't crash; they just clamp.
    assert.equal((await store.getGroupSettingsHistory('g@g.us', 0)).length, 1);
    assert.equal((await store.getGroupSettingsHistory('g@g.us', -5)).length, 1);
    assert.equal((await store.getGroupSettingsHistory('g@g.us', 100000)).length, 1);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── end-to-end: diff() output feeds straight into the store ───── */

test('end-to-end: diff result records correctly', async () => {
  const { store, path: p } = freshStore();
  try {
    const { diff, actorForField, serialise } = require('../../store/schema/groupSettingsEvents');
    const oldMeta = {
      subject: 'Old',
      desc: 'descA',
      announce: false,
    };
    const newMeta = {
      subject: 'New',
      desc: 'descA',
      announce: true,
      subjectOwner: 'admin1@s.whatsapp.net',
    };
    const events = diff(oldMeta, newMeta);
    assert.equal(events.length, 2, 'subject + announce changed');
    const ts = 1700005000;
    for (const ev of events) {
      const actor = actorForField(ev.field, newMeta);
      await store.recordGroupSettingsChange(
        'gx@g.us',
        ev.field,
        serialise(ev.oldValue),
        serialise(ev.newValue),
        actor,
        ts,
      );
    }
    const hist = await store.getGroupSettingsHistory('gx@g.us');
    assert.equal(hist.length, 2);
    const subj = hist.find((h) => h.field === 'subject');
    assert.equal(subj.old_value, 'Old');
    assert.equal(subj.new_value, 'New');
    assert.equal(subj.actor, 'admin1@s.whatsapp.net');
    const ann = hist.find((h) => h.field === 'announce');
    assert.equal(ann.old_value, 'false');
    assert.equal(ann.new_value, 'true');
    assert.equal(ann.actor, null);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});
