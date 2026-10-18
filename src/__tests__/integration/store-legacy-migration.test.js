/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Legacy-DB schema upgrade regression tests.
 *
 * Reproduces the boot crash "table message_capping has no column named info"
 * (v1.20.0 / E5): a database created before the `message_capping.info` column
 * existed must be upgraded inline at store init. The formal migration
 * (migrations/sqlite/011) runs only AFTER makeSQLiteStore() returns
 * (lifecycle.selectStore), but the messageCappingInfo* statements are
 * prepared eagerly during init — so the column must exist before they
 * prepare or the store dies before its own migration can run.
 *
 *   Run:  node --test src/__tests__/integration/store-legacy-migration.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { makeSQLiteStore } = require('../../store/sqliteStore');

const stub = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: function () {
    return this;
  },
};

function tmpDbPath(tag) {
  return path.join(
    os.tmpdir(),
    `echofox-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
}

function makeStore(dbPath) {
  return makeSQLiteStore({
    dbPath,
    logger: stub,
    groupCache: { get: () => null, set: () => null },
  });
}

function cleanup(dbPath, store) {
  if (store) store.close();
  ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(dbPath + ext, { force: true }));
}

// Pre-v1.20.0 message_capping shape: CREATE TABLE IF NOT EXISTS is a no-op on
// an existing table, so this is exactly what an upgraded install's DB holds.
const LEGACY_DDL = `
  CREATE TABLE message_capping (
    jid         TEXT PRIMARY KEY,
    cap_value   INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL DEFAULT 0
  );
`;

test('legacy pre-E5 DB: message_capping without `info` boots and upgrades', async () => {
  const dbPath = tmpDbPath('legacy-capping');
  {
    const raw = new Database(dbPath);
    raw.exec(LEGACY_DDL);
    raw
      .prepare(`INSERT INTO message_capping (jid, cap_value, updated_at) VALUES (?, ?, ?)`)
      .run('legacy@s.whatsapp.net', 5, 1700000000);
    raw.close();
  }

  let store;
  try {
    // The old crash: makeSQLiteStore threw SqliteError
    // "table message_capping has no column named info" right here.
    store = makeStore(dbPath);

    // legacy rows survive the upgrade untouched
    const legacy = await store.getMessageCap('legacy@s.whatsapp.net');
    assert.ok(legacy, 'legacy row survived');
    assert.equal(legacy.cap_value, 5);

    // the v1.20.0 (E5) info API works against the upgraded table
    const info = {
      total_quota: 600,
      used_quota: 25,
      capping_status: 'FIRST_WARNING',
    };
    await store.setMessageCapInfo(info);
    const row = await store.getMessageCapInfo();
    assert.ok(row, 'account quota row present');
    assert.equal(row.cap_value, 25, 'cap_value mirrors used_quota');
    assert.deepEqual(row.info, info, 'full info JSON round-trips');
  } finally {
    cleanup(dbPath, store);
  }
});

test('upgrade is idempotent: re-opening the DB does not fail or reset data', async () => {
  const dbPath = tmpDbPath('legacy-capping-idem');
  {
    const raw = new Database(dbPath);
    raw.exec(LEGACY_DDL);
    raw.close();
  }

  let store;
  try {
    store = makeStore(dbPath);
    await store.setMessageCapInfo({ total_quota: 100, used_quota: 1, capping_status: 'NONE' });
    store.close();
    store = undefined;

    // second open: the column now exists — no error, no duplicate ALTER, data intact
    store = makeStore(dbPath);
    const row = await store.getMessageCapInfo();
    assert.ok(row, 'row survived re-open');
    assert.equal(row.cap_value, 1);
    assert.equal(row.info.total_quota, 100);
  } finally {
    cleanup(dbPath, store);
  }
});

test('formal migration 011 and the inline ensure are equivalent on a legacy DB', async () => {
  const dbPath = tmpDbPath('legacy-capping-011');
  {
    const raw = new Database(dbPath);
    raw.exec(LEGACY_DDL);
    raw.close();
  }

  let store;
  let raw;
  try {
    store = makeStore(dbPath);
    // The inline ensure already upgraded the table; running migration 011 on
    // top must be a no-op (belt-and-braces for boots where the runner does
    // execute, e.g. lifecycle.selectStore after a successful store create).
    const migration = require('../../store/migrations/sqlite/011_message_capping_info');
    assert.equal(migration.version, 11);
    raw = new Database(dbPath);
    migration.up({ db: raw });
    const cols = raw
      .prepare(`PRAGMA table_info(message_capping)`)
      .all()
      .map((c) => c.name);
    assert.ok(cols.includes('info'), 'info column present');
  } finally {
    if (raw) raw.close();
    cleanup(dbPath, store);
  }
});
