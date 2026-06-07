/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Baseline migration for the SQLite store.
 *
 * This migration is *idempotent* — it re-asserts every schema element the
 * sqliteStore needs. Running it against a fully-up-to-date database is a
 * no-op. It exists so:
 *   • brand-new installs get an explicit record in `_migrations`
 *   • upgrades from pre-v0.4.5 stores have something to track against
 *
 * Future migrations (001_, 002_, ...) ADD to this baseline, never alter
 * its DDL — they're independent forward-only deltas.
 */
module.exports = {
  version: 0,
  description: 'baseline schema — re-asserts all sqliteStore tables/indexes',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        jid         TEXT NOT NULL,
        id          TEXT NOT NULL,
        from_me     INTEGER NOT NULL DEFAULT 0,
        participant TEXT,
        msg         BLOB,
        ts          INTEGER NOT NULL,
        PRIMARY KEY (jid, id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
      CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages (jid, ts DESC);

      CREATE TABLE IF NOT EXISTS chats (
        jid    TEXT PRIMARY KEY,
        name   TEXT, unread INTEGER DEFAULT 0, ts INTEGER
      );

      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY,
        name TEXT, notify TEXT, img_url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);

      CREATE TABLE IF NOT EXISTS groups (
        jid TEXT PRIMARY KEY,
        subject TEXT, creation INTEGER, meta BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_groups_subject ON groups (subject COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS stats (
        key   TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS stats_gauges (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS group_participants_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_jid TEXT NOT NULL,
        participant TEXT NOT NULL,
        action TEXT NOT NULL,
        actor TEXT,
        ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gpe_group_ts ON group_participants_events (group_jid, ts);
      CREATE INDEX IF NOT EXISTS idx_gpe_participant ON group_participants_events (participant);

      CREATE TABLE IF NOT EXISTS message_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        editor TEXT, old_body TEXT, new_body TEXT, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edits_msg ON message_edits (jid, message_id, ts);

      CREATE TABLE IF NOT EXISTS message_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        reactor TEXT NOT NULL, emoji TEXT, ts INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions (jid, message_id, ts);

      CREATE TABLE IF NOT EXISTS message_receipts (
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        recipient TEXT NOT NULL, status INTEGER NOT NULL, ts INTEGER NOT NULL,
        PRIMARY KEY (jid, message_id, recipient)
      );

      CREATE TABLE IF NOT EXISTS service_subscribers (
        service            TEXT NOT NULL,
        jid                TEXT NOT NULL,
        last_seen_pulse_ts INTEGER,
        PRIMARY KEY (service, jid)
      );
      CREATE INDEX IF NOT EXISTS idx_service_subscribers_service
        ON service_subscribers (service);

      CREATE TABLE IF NOT EXISTS thehackersnews_sent_articles (
        service     TEXT NOT NULL,
        jid         TEXT NOT NULL,
        article_url TEXT NOT NULL,
        sent_at     INTEGER NOT NULL,
        PRIMARY KEY (service, jid, article_url)
      );
    `);

    // In-place column additions (idempotent — PRAGMA-checked)
    const cols = db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name);
    if (!cols.includes('deleted_at')) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN deleted_at INTEGER`); } catch {}
    }
    if (!cols.includes('status')) {
      try { db.exec(`ALTER TABLE messages ADD COLUMN status INTEGER NOT NULL DEFAULT 0`); } catch {}
    }
  },

  down({ db: _db }) {
    // No-op. We don't drop the schema during rollback; data loss is unacceptable.
  },
};
