/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * userDirectory – formerly src/lib/Functions/userDataSaver.js
 * Records first-seen metadata about a user (country, device, name).
 * Single SQLite table + LRU dedupe so we touch disk only for *new* users.
 */
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const { LRUCache } = require('lru-cache');
const { getDevice } = require('@whiskeysockets/baileys');
const parsePhoneNumber = require('libphonenumber-js').default;
const countries = require('iso-3166-1-alpha-2');

const logger = require('../core/logger').child({ mod: 'users' });

// ─── Lazy SQLite singleton ──────────────────────────────────────────────
// This module used to open users.db at require() time, i.e. during module
// graph evaluation — BEFORE lifecycle.selectStore() runs. Consequences:
//   • a `require('../services/userDirectory')` anywhere threw if the
//     datasource was unavailable, taking the whole boot down;
//   • it was one of four connections open for the entire process lifetime
//     whether or not a single user was ever recorded;
//   • it was a second victim of the missing-native-binding bug (C-01),
//     because the failure happened at import rather than at first use.
// Opening on first use keeps behaviour identical and removes all three.
let _db = null;
let _stmts = null;

function _ensureDb() {
  if (_db) return _db;

  const dir = path.join(__dirname, '..', 'store', 'runtime');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(path.join(dir, 'users.db'));
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      jid          TEXT PRIMARY KEY,
      name         TEXT,
      device       TEXT,
      contact      TEXT,
      country_code TEXT,
      country      TEXT,
      joined       INTEGER
    );
  `);

  _stmts = {
    insert: db.prepare(`
      INSERT OR IGNORE INTO users (jid,name,device,contact,country_code,country,joined)
      VALUES (?,?,?,?,?,?,?)`),
    exists: db.prepare(`SELECT 1 FROM users WHERE jid = ?`),
  };
  _db = db;
  return _db;
}

/** Test/shutdown hook — closes the handle if it was ever opened. */
function close() {
  if (!_db) return;
  try {
    _db.close();
  } catch {
    /* already closed */
  }
  _db = null;
  _stmts = null;
}

const seen = new LRUCache({ max: 50_000 }); // hot dedupe – no disk hit

async function rememberUser(ctx, _sock) {
  const jid = ctx.sender;
  if (!jid || seen.has(jid)) return;
  seen.set(jid, 1);

  let stmts;
  try {
    _ensureDb();
    stmts = _stmts;
  } catch (e) {
    logger.warn({ err: e }, 'users.db unavailable — skipping user record');
    return;
  }
  if (stmts.exists.get(jid)) return;

  let device = 'unknown';
  try {
    device = await getDevice(ctx.id);
  } catch {}

  let countryCode = null,
    country = null,
    intl = null;
  try {
    const num = parsePhoneNumber('+' + jid.split('@')[0]);
    if (num) {
      countryCode = num.country;
      country = countryCode ? countries.getCountry(countryCode) : null;
      intl = num.formatInternational();
    }
  } catch {}

  try {
    stmts.insert.run(jid, ctx.pushName, device, intl, countryCode, country, ctx.timestamp);
  } catch (e) {
    logger.warn({ err: e }, 'insert user failed');
  }
}

module.exports = { rememberUser, close };
