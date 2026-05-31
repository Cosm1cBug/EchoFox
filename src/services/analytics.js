/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * Analytics – formerly src/lib/Functions/sqliteDB.js (sqlite3, async, leaky)
 * Now: better-sqlite3 + write-coalescing + WAL.
 *
 * Public API:
 *   recordMessage(ctx)        – increments per-user/per-day counters
 *   trackCommandUsage(jid, c) – ++command_usage
 *   getLeaderboard(days=7)    – top 10 chatters (7-day rolling)
 *   close()
 */
const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');
const logger = require('../core/logger').child({ mod: 'analytics' });

const DB_DIR = path.join(__dirname, '..', 'store', 'runtime');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const db = new Database(path.join(DB_DIR, 'analytics.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS msg_counts (
    jid       TEXT NOT NULL,
    day       TEXT NOT NULL,        -- YYYY-MM-DD
    mtype     TEXT NOT NULL,
    n         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (jid, day, mtype)
  );
  CREATE INDEX IF NOT EXISTS idx_msg_counts_day ON msg_counts (day);

  CREATE TABLE IF NOT EXISTS command_usage (
    jid       TEXT NOT NULL,
    cmd       TEXT NOT NULL,
    n         INTEGER NOT NULL DEFAULT 0,
    last_used INTEGER NOT NULL,
    PRIMARY KEY (jid, cmd)
  );
`);

const stmts = {
  upsertMsg: db.prepare(`
    INSERT INTO msg_counts (jid,day,mtype,n) VALUES (?,?,?,?)
    ON CONFLICT(jid,day,mtype) DO UPDATE SET n = n + excluded.n`),
  upsertCmd: db.prepare(`
    INSERT INTO command_usage (jid,cmd,n,last_used) VALUES (?,?,1,?)
    ON CONFLICT(jid,cmd) DO UPDATE SET n = n + 1, last_used = excluded.last_used`),
  leaderboard: db.prepare(`
    SELECT jid, SUM(n) AS total
    FROM msg_counts
    WHERE day >= date('now', ?) GROUP BY jid ORDER BY total DESC LIMIT 10`),
};

// ─── Coalesce many tiny writes into one tx per 250 ms ────────────────────
const buffer = [];
let flushTimer = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 250).unref();
}
function flush() {
  flushTimer = null;
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    db.transaction((rows) => {
      for (const r of rows) stmts.upsertMsg.run(r.jid, r.day, r.mtype, r.n);
    })(batch);
  } catch (e) { logger.warn({ err: e }, 'analytics flush failed'); }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function recordMessage(ctx) {
  buffer.push({ jid: ctx.sender, day: today(), mtype: ctx.mtype || 'unknown', n: 1 });
  scheduleFlush();
}

async function trackCommandUsage(jid, cmd) {
  try { stmts.upsertCmd.run(jid, cmd, Math.floor(Date.now() / 1000)); }
  catch (e) { logger.warn({ err: e }, 'cmd usage upsert failed'); }
}

function getLeaderboard(days = 7) {
  return stmts.leaderboard.all(`-${days} days`);
}

function close() {
  flush();
  try { db.close(); } catch {}
}

module.exports = { recordMessage, trackCommandUsage, getLeaderboard, close };
