/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.13.0 — groups dashboard 2.0 integration tests.
 *
 *   Verifies:
 *     • config schema honours `dashboard.inactiveAfterDays` (default 14)
 *     • sqliteStore.getLastHumanMessageTs returns the latest non-bot ts
 *       and ignores bot-sent messages
 *     • returns null when there are no human messages at all
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
    `echofox_groups_v1130_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  try {
    fs.rmSync(tmp, { force: true });
  } catch (_) {}
  const { makeSQLiteStore } = require('../../store/sqliteStore');
  const { LRUCache } = require('lru-cache');
  const store = makeSQLiteStore({
    dbPath: tmp,
    logger: pino({ level: 'silent' }),
    groupCache: new LRUCache({ max: 100 }),
  });
  return { store, path: tmp };
}

test('config: dashboard.inactiveAfterDays default = 14', () => {
  const { schema } = require('../../lib/configSchema');
  const parsed = schema.parse({});
  assert.equal(parsed.dashboard.inactiveAfterDays, 14);
});

test('config: dashboard.inactiveAfterDays override accepted', () => {
  const { schema } = require('../../lib/configSchema');
  const parsed = schema.parse({ dashboard: { inactiveAfterDays: 7 } });
  assert.equal(parsed.dashboard.inactiveAfterDays, 7);
});

test('config: dashboard.inactiveAfterDays rejects out-of-range', () => {
  const { schema } = require('../../lib/configSchema');
  assert.throws(() => schema.parse({ dashboard: { inactiveAfterDays: 0 } }));
  assert.throws(() => schema.parse({ dashboard: { inactiveAfterDays: 366 } }));
});

test('config: dashboard.inactiveAfterDays coerces string numbers', () => {
  // Useful when reading from env vars / CLI args.
  const { schema } = require('../../lib/configSchema');
  const parsed = schema.parse({ dashboard: { inactiveAfterDays: '21' } });
  assert.equal(parsed.dashboard.inactiveAfterDays, 21);
});

test('store.getLastHumanMessageTs: returns null for unknown group', async () => {
  const { store, path: p } = freshStore();
  try {
    const ts = await store.getLastHumanMessageTs('nope@g.us');
    assert.equal(ts, null);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getLastHumanMessageTs: returns null when only bot messages exist', async () => {
  const { store, path: p } = freshStore();
  try {
    // Insert a bot message directly via raw SQL (avoids needing to simulate
    // a full Baileys messages.upsert event which is much heavier).
    const Database = require('better-sqlite3');
    const db = new Database(p);
    db.prepare(
      `INSERT INTO messages (jid, id, from_me, participant, msg, ts) VALUES (?, ?, ?, ?, NULL, ?)`,
    ).run('g1@g.us', 'msg-bot-1', 1, null, 1700000000);
    db.close();
    const ts = await store.getLastHumanMessageTs('g1@g.us');
    assert.equal(ts, null);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getLastHumanMessageTs: returns most recent human ts', async () => {
  const { store, path: p } = freshStore();
  try {
    const Database = require('better-sqlite3');
    const db = new Database(p);
    const ins = db.prepare(
      `INSERT INTO messages (jid, id, from_me, participant, msg, ts) VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    ins.run('g2@g.us', 'm1', 0, 'u1@s.whatsapp.net', 1700000000); // human, old
    ins.run('g2@g.us', 'm2', 1, null, 1700001000); // bot, newer than human
    ins.run('g2@g.us', 'm3', 0, 'u2@s.whatsapp.net', 1700000500); // human, between
    db.close();
    // Expected: MAX of from_me=0 entries = 1700000500
    const ts = await store.getLastHumanMessageTs('g2@g.us');
    assert.equal(ts, 1700000500);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.getLastHumanMessageTs: scopes to the requested group', async () => {
  const { store, path: p } = freshStore();
  try {
    const Database = require('better-sqlite3');
    const db = new Database(p);
    const ins = db.prepare(
      `INSERT INTO messages (jid, id, from_me, participant, msg, ts) VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    ins.run('groupA@g.us', 'a1', 0, 'u@s.whatsapp.net', 1700001000);
    ins.run('groupB@g.us', 'b1', 0, 'u@s.whatsapp.net', 1700002000);
    db.close();
    assert.equal(await store.getLastHumanMessageTs('groupA@g.us'), 1700001000);
    assert.equal(await store.getLastHumanMessageTs('groupB@g.us'), 1700002000);
    assert.equal(await store.getLastHumanMessageTs('groupC@g.us'), null);
  } finally {
    store.close();
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});
