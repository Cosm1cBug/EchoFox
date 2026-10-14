#!/usr/bin/env node
/*
 * EchoFox - one-off data repair
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * purge-nonhuman-messages.js — repair historic rows that made dormant groups
 * show as "active" on the dashboard's Groups tab.
 *
 * Background
 * ----------
 * The dashboard derives a group's active/inactive flag from
 *     SELECT MAX(ts) FROM messages WHERE jid = ? AND from_me = 0
 * `from_me = 0` only means "not sent by this bot". Protocol messages, sender-
 * key distributions, reactions, poll votes and keep-in-chat bookkeeping all
 * land in `messages` as ordinary inbound rows and were keeping silent groups
 * pinned to "active".
 *
 * v1.17.x stopped *new* rows like this from being written (see
 * src/lib/messageFilters.js), but it does not touch rows already in the
 * database. This script cleans those up.
 *
 * It decodes the protobuf stored in `messages.msg` (present because
 * privacy.storeMessageBodies defaults to true) and deletes rows whose content
 * is not human conversation. Rows written with storeMessageBodies = false have
 * a NULL msg column and cannot be classified, so they are left alone and
 * reported.
 *
 * Usage
 * -----
 *   # 1. ALWAYS back up first — this mutates your only copy of the data.
 *   cp src/store/runtime/wa.db "src/store/runtime/wa.db.bak.$(date +%s)"
 *
 *   # 2. Dry run (default): report only, changes nothing.
 *   node scripts/purge-nonhuman-messages.js
 *
 *   # 3. Apply.
 *   node scripts/purge-nonhuman-messages.js --apply
 *
 *   # Different DB path:
 *   node scripts/purge-nonhuman-messages.js --db /path/to/wa.db --apply
 *
 * Exit codes: 0 ok · 1 bad usage / missing dependency · 2 database error
 */

const fs = require('node:fs');
const path = require('node:path');

// ─── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const dbFlag = argv.indexOf('--db');
const DB_PATH =
  dbFlag !== -1 && argv[dbFlag + 1]
    ? argv[dbFlag + 1]
    : path.resolve(process.cwd(), 'src', 'store', 'runtime', 'wa.db');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/purge-nonhuman-messages.js [--db <path>] [--apply]',
      '',
      '  (no --apply)  dry run: count what WOULD be removed',
      '  --apply       actually delete the rows',
      '',
      `  default db:   ${DB_PATH}`,
    ].join('\n'),
  );
  process.exit(0);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`✖ database not found: ${DB_PATH}`);
  console.error('  pass --db <path> if your storeDB.sqlitePath differs.');
  process.exit(1);
}

// Resolve dependencies from the CWD first so the script works when invoked
// from anywhere (`node /path/to/purge-nonhuman-messages.js`), then fall back
// to normal resolution when it lives at <repo>/scripts/.
function resolveDep(name) {
  const candidates = [
    name,
    path.join(process.cwd(), 'node_modules', name),
    path.join(__dirname, '..', 'node_modules', name),
  ];
  for (const c of candidates) {
    try {
      return require(c);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

const Database = resolveDep('better-sqlite3');
const baileys = resolveDep('@whiskeysockets/baileys');

if (!Database || !baileys) {
  console.error('✖ could not load better-sqlite3 and/or @whiskeysockets/baileys.');
  console.error('  run this from the EchoFox repo root after `npm install`, or');
  console.error('  copy it to <repo>/scripts/ and run it from there.');
  process.exit(1);
}
const proto = baileys.proto;

// Kept in sync with src/lib/messageFilters.js
const NON_HUMAN_CONTENT = [
  'protocolMessage',
  'senderKeyDistributionMessage',
  'reactionMessage',
  'pollUpdateMessage',
  'keepInChatMessage',
];

// ─── main ────────────────────────────────────────────────────────────────
let db;
try {
  db = new Database(DB_PATH, { readonly: !APPLY });
  // Only touch the journal mode when we intend to write: setting a PRAGMA on a
  // read-only connection throws SQLITE_READONLY.
  if (APPLY) db.pragma('journal_mode = WAL');
} catch (err) {
  console.error(`✖ could not open ${DB_PATH}: ${err.message}`);
  process.exit(2);
}

console.log(`▸ database : ${DB_PATH}`);
console.log(`▸ mode     : ${APPLY ? 'APPLY (rows will be deleted)' : 'dry run (no changes)'}`);
console.log('');

let totals;
try {
  totals = {
    all: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
    inbound: db.prepare('SELECT COUNT(*) n FROM messages WHERE from_me = 0').get().n,
    inboundWithBody: db
      .prepare('SELECT COUNT(*) n FROM messages WHERE from_me = 0 AND msg IS NOT NULL')
      .get().n,
  };
} catch (err) {
  console.error('✖ could not read the messages table:', err.message);
  process.exit(2);
}

console.log(`  messages total          : ${totals.all}`);
console.log(`  inbound (from_me = 0)   : ${totals.inbound}`);
console.log(`  inbound with a body     : ${totals.inboundWithBody}`);
console.log(
  `  inbound without a body  : ${totals.inbound - totals.inboundWithBody} (cannot classify — left alone)`,
);
console.log('');

const select = db.prepare(
  'SELECT jid, id, msg FROM messages WHERE from_me = 0 AND msg IS NOT NULL',
);
const remove = db.prepare('DELETE FROM messages WHERE jid = ? AND id = ?');

const perType = Object.fromEntries(NON_HUMAN_CONTENT.map((k) => [k, 0]));
const affectedJids = new Set();
let scanned = 0;
let undecodable = 0;
let removed = 0;

// Pass 1 — classify. Rows are collected first because better-sqlite3 refuses
// to run a DELETE while a statement on the same connection is still iterating
// ("This database connection is busy executing a query").
const hits = [];
for (const row of select.iterate()) {
  scanned += 1;
  let message;
  try {
    message = proto.Message.decode(row.msg);
  } catch {
    undecodable += 1;
    continue;
  }

  const hit = NON_HUMAN_CONTENT.find((k) => message[k]);
  if (!hit) continue;

  perType[hit] += 1;
  affectedJids.add(row.jid);
  hits.push({ jid: row.jid, id: row.id });
}

// Pass 2 — delete, all-or-nothing.
try {
  const run = db.transaction(() => {
    for (const h of hits) {
      remove.run(h.jid, h.id);
      removed += 1;
    }
  });
  if (APPLY) run();
} catch (err) {
  console.error('✖ failed while scanning/deleting:', err.message);
  db.close();
  process.exit(2);
}

console.log(`  rows classified         : ${scanned}`);
console.log('  non-human rows found by type:');
for (const [type, n] of Object.entries(perType)) {
  if (n > 0) console.log(`    ${type.padEnd(30)} ${n}`);
}
const totalHits = Object.values(perType).reduce((a, b) => a + b, 0);
console.log('');

if (undecodable > 0) {
  console.log(`  ⚠ ${undecodable} row(s) failed to decode as proto.Message — skipped.`);
}

if (totalHits === 0) {
  console.log('✔ nothing to clean — no non-human inbound rows found.');
  db.close();
  process.exit(0);
}

if (APPLY) {
  console.log(`✔ deleted ${removed} row(s) across ${affectedJids.size} chat(s).`);
  console.log('  Restart the bot so the dashboard re-reads the store:');
  console.log('    pm2 restart echofox        (or)  docker compose restart echofox');
} else {
  console.log(`▸ ${totalHits} row(s) across ${affectedJids.size} chat(s) WOULD be deleted.`);
  console.log('  re-run with --apply to perform the deletion (back up first!).');
}

db.close();
process.exit(0);
