/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Pluggable auth-state backends for Baileys.
 *
 *   useRedisAuth(redisUrl, sessionName)
 *   useSqliteAuth(sqlitePath, sessionName)
 *   usePostgresAuth(pgUrl, sessionName)
 *
 *   Each returns { state, saveCreds, clear } matching the contract that
 *   Baileys' makeWASocket({ auth: { creds, keys } }) expects, plus a
 *   `clear()` we call when the session is invalidated (logged-out, 401).
 *
 *   All three implementations share the same on-the-wire serialisation
 *   (`BufferJSON.replacer/reviver`) and the same key-naming convention
 *   (`<sessionName>:<type>-<id>` or table column equivalents) so a
 *   session can be migrated between backends with a simple data-copy.
 */

const {
  initAuthCreds,
  BufferJSON,
  proto,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');

const fs = require('node:fs');
const path = require('node:path');

const log = require('./logger').child({ mod: 'auth' });
// ─── helpers ─────────────────────────────────────────────────────────────
function serialise(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}
function deserialise(value) {
  return value == null ? null : JSON.parse(value, BufferJSON.reviver);
}

/**
 * Standard `keys` wrapper used by all three backends.
 * Given `read(key) → any`, `write(value, key) → void`, `remove(key) → void`
 * we build the get/set object Baileys expects.
 */
function makeKeysWrapper({ read, write, remove }) {
  return {
    get: async (type, ids) => {
      const data = {};
      await Promise.all(
        ids.map(async (id) => {
          let value = await read(`${type}-${id}`);
          if (type === 'app-state-sync-key' && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          data[id] = value;
        }),
      );
      return data;
    },
    set: async (data) => {
      const ops = [];
      for (const category of Object.keys(data)) {
        for (const id of Object.keys(data[category])) {
          const value = data[category][id];
          const key = `${category}-${id}`;
          ops.push(value ? write(value, key) : remove(key));
        }
      }
      await Promise.all(ops);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// Redis
// ════════════════════════════════════════════════════════════════════════
async function useRedisAuth(redisUrl, sessionName) {
  const Redis = require('ioredis');
  const client = new Redis(redisUrl);
  const prefix = `${sessionName}:`;

  const read = async (key) => deserialise(await client.get(prefix + key));
  const write = async (value, key) => client.set(prefix + key, serialise(value));
  const remove = async (key) => client.del(prefix + key);

  let creds = await read('creds');
  if (!creds) {
    creds = initAuthCreds();
    await write(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(
        makeKeysWrapper({ read, write, remove }),
        log.child({ mod: 'signal-keys' }),
      ),
    },
    saveCreds: () => write(creds, 'creds'),
    clear: async () => {
      const keys = await client.keys(prefix + '*');
      if (keys.length) await client.del(keys);
    },
    close: () => client.quit(),
  };
}

// ════════════════════════════════════════════════════════════════════════
// SQLite
// ════════════════════════════════════════════════════════════════════════
async function useSqliteAuth(sqlitePath, sessionName) {
  const Database = require('better-sqlite3');
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth (
      session TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY (session, key)
    );
  `);

  const stmts = {
    get: db.prepare('SELECT value FROM auth WHERE session = ? AND key = ?'),
    set: db.prepare('INSERT OR REPLACE INTO auth (session, key, value) VALUES (?, ?, ?)'),
    del: db.prepare('DELETE FROM auth WHERE session = ? AND key = ?'),
    delAll: db.prepare('DELETE FROM auth WHERE session = ?'),
  };

  const read = async (key) => {
    const row = stmts.get.get(sessionName, key);
    return row?.value ? deserialise(row.value) : null;
  };
  const write = async (value, key) => {
    stmts.set.run(sessionName, key, serialise(value));
  };
  const remove = async (key) => {
    stmts.del.run(sessionName, key);
  };

  let creds = await read('creds');
  if (!creds) {
    creds = initAuthCreds();
    await write(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(
        makeKeysWrapper({ read, write, remove }),
        log.child({ mod: 'signal-keys' }),
      ),
    },
    saveCreds: () => write(creds, 'creds'),
    clear: async () => {
      stmts.delAll.run(sessionName);
    },
    close: () => db.close(),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Postgres
// ════════════════════════════════════════════════════════════════════════
async function usePostgresAuth(pgUrl, sessionName) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: pgUrl });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth (
      session TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT,
      PRIMARY KEY (session, key)
    );
  `);

  const read = async (key) => {
    const r = await pool.query('SELECT value FROM auth WHERE session = $1 AND key = $2', [
      sessionName,
      key,
    ]);
    return r.rows[0]?.value ? deserialise(r.rows[0].value) : null;
  };
  const write = async (value, key) => {
    await pool.query(
      `INSERT INTO auth (session, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (session, key) DO UPDATE SET value = EXCLUDED.value`,
      [sessionName, key, serialise(value)],
    );
  };
  const remove = async (key) => {
    await pool.query('DELETE FROM auth WHERE session = $1 AND key = $2', [sessionName, key]);
  };

  let creds = await read('creds');
  if (!creds) {
    creds = initAuthCreds();
    await write(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore(
        makeKeysWrapper({ read, write, remove }),
        log.child({ mod: 'signal-keys' }),
      ),
    },
    saveCreds: () => write(creds, 'creds'),
    clear: async () => {
      await pool.query('DELETE FROM auth WHERE session = $1', [sessionName]);
    },
    close: () => pool.end(),
  };
}

module.exports = { useRedisAuth, useSqliteAuth, usePostgresAuth };
