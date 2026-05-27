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
const DB_DIR = path.join(__dirname, '..', 'store', 'runtime');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'users.db'));
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

const insert = db.prepare(`
  INSERT OR IGNORE INTO users (jid,name,device,contact,country_code,country,joined)
  VALUES (?,?,?,?,?,?,?)`);
const exists = db.prepare(`SELECT 1 FROM users WHERE jid = ?`);

const seen = new LRUCache({ max: 50_000 });   // hot dedupe – no disk hit

async function rememberUser(ctx, _sock) {
  const jid = ctx.sender;
  if (!jid || seen.has(jid)) return;
  seen.set(jid, 1);
  if (exists.get(jid)) return;

  let device = 'unknown';
  try { device = await getDevice(ctx.id); } catch {}

  let countryCode = null, country = null, intl = null;
  try {
    const num = parsePhoneNumber('+' + jid.split('@')[0]);
    if (num) {
      countryCode = num.country;
      country     = countryCode ? countries.getCountry(countryCode) : null;
      intl        = num.formatInternational();
    }
  } catch {}

  try {
    insert.run(jid, ctx.pushName, device, intl, countryCode, country, ctx.timestamp);
  } catch (e) {
    logger.warn({ err: e }, 'insert user failed');
  }
}

module.exports = { rememberUser };
