/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Schema additions for full message history & timeline.
 *
 *   • message_edits      — every edit of a message body, append-only
 *   • message_reactions  — every reaction add/remove on any message
 *   • message_receipts   — delivery / read / played receipts
 *   • messages.deleted_at, messages.status (added in-place on existing table)
 *
 * Why append-only edits + reactions?
 *   Same reasoning as participant events: we want a full timeline.
 *   "Alice edited her message 4 times" is more useful than "this is the
 *   latest version." Reactions toggle on/off — we want both events.
 *
 * Receipts overwrite in place because they only go forward
 *   (sent → delivered → read → played) — older receipts are uninteresting.
 */

// Receipt status codes (per Baileys 7.x)
const RECEIPT_STATUS = Object.freeze({
  SENT:      1,
  DELIVERED: 2,
  READ:      3,
  PLAYED:    4,
});

const RECEIPT_NAMES = Object.freeze({
  1: 'sent', 2: 'delivered', 3: 'read', 4: 'played',
});

const SQL_DDL = {
  sqlite: `
    -- Append-only edit log
    CREATE TABLE IF NOT EXISTS message_edits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      jid         TEXT    NOT NULL,
      message_id  TEXT    NOT NULL,
      editor      TEXT,                       -- who edited (usually the sender)
      old_body    TEXT,                       -- text BEFORE the edit
      new_body    TEXT,                       -- text AFTER  the edit
      ts          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edits_msg ON message_edits (jid, message_id, ts);

    -- Append-only reaction log
    CREATE TABLE IF NOT EXISTS message_reactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      jid         TEXT    NOT NULL,           -- chat the original message is in
      message_id  TEXT    NOT NULL,           -- original message id
      reactor     TEXT    NOT NULL,           -- who reacted
      emoji       TEXT,                       -- null = un-react (removal)
      ts          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions (jid, message_id, ts);

    -- Receipts: status code per (message_id, recipient). Overwrites on progression.
    CREATE TABLE IF NOT EXISTS message_receipts (
      jid         TEXT    NOT NULL,
      message_id  TEXT    NOT NULL,
      recipient   TEXT    NOT NULL,
      status      INTEGER NOT NULL,           -- 1=sent 2=delivered 3=read 4=played
      ts          INTEGER NOT NULL,
      PRIMARY KEY (jid, message_id, recipient)
    );
  `,

  postgres: `
    CREATE TABLE IF NOT EXISTS message_edits (
      id          BIGSERIAL PRIMARY KEY,
      jid         TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      editor      TEXT,
      old_body    TEXT,
      new_body    TEXT,
      ts          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edits_msg ON message_edits (jid, message_id, ts);

    CREATE TABLE IF NOT EXISTS message_reactions (
      id          BIGSERIAL PRIMARY KEY,
      jid         TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      reactor     TEXT NOT NULL,
      emoji       TEXT,
      ts          BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions (jid, message_id, ts);

    CREATE TABLE IF NOT EXISTS message_receipts (
      jid         TEXT NOT NULL,
      message_id  TEXT NOT NULL,
      recipient   TEXT NOT NULL,
      status      INTEGER NOT NULL,
      ts          BIGINT NOT NULL,
      PRIMARY KEY (jid, message_id, recipient)
    );
  `,
};

/**
 * Migration for the existing `messages` table — add deleted_at + status
 * columns idempotently. Each store calls applyMessagesMigration() at boot.
 */
function applyMessagesMigration_sqlite(db) {
  const cols = db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name);
  if (!cols.includes('deleted_at')) {
    try { db.exec(`ALTER TABLE messages ADD COLUMN deleted_at INTEGER`); } catch {}
  }
  if (!cols.includes('status')) {
    try { db.exec(`ALTER TABLE messages ADD COLUMN status INTEGER NOT NULL DEFAULT 0`); } catch {}
  }
}

async function applyMessagesMigration_postgres(pool) {
  try {
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at BIGINT`);
    await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 0`);
  } catch (e) { /* already there or perms missing — non-fatal */ }
}

module.exports = {
  RECEIPT_STATUS,
  RECEIPT_NAMES,
  SQL_DDL,
  applyMessagesMigration_sqlite,
  applyMessagesMigration_postgres,
};
