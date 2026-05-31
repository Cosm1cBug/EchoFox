/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Baseline migration for the Postgres store.
 * See sqlite/000_baseline.js for design notes.
 */
module.exports = {
  version: 0,
  description: 'baseline schema — re-asserts all postgresStore tables/indexes',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        jid TEXT, id TEXT, from_me BOOLEAN, participant TEXT,
        msg BYTEA, ts BIGINT, PRIMARY KEY (jid, id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
      CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages (jid, ts DESC);

      CREATE TABLE IF NOT EXISTS chats (
        jid TEXT PRIMARY KEY, name TEXT, unread INTEGER DEFAULT 0, ts BIGINT
      );

      CREATE TABLE IF NOT EXISTS contacts (
        jid TEXT PRIMARY KEY, name TEXT, notify TEXT, img_url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);

      CREATE TABLE IF NOT EXISTS groups (
        jid TEXT PRIMARY KEY, subject TEXT, creation BIGINT, meta JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_groups_subject ON groups (subject);

      CREATE TABLE IF NOT EXISTS stats (
        key TEXT PRIMARY KEY, value BIGINT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS stats_gauges (
        key TEXT PRIMARY KEY,
        value DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS group_participants_events (
        id BIGSERIAL PRIMARY KEY,
        group_jid TEXT NOT NULL, participant TEXT NOT NULL,
        action TEXT NOT NULL, actor TEXT, ts BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gpe_group_ts ON group_participants_events (group_jid, ts);
      CREATE INDEX IF NOT EXISTS idx_gpe_participant ON group_participants_events (participant);

      CREATE TABLE IF NOT EXISTS message_edits (
        id BIGSERIAL PRIMARY KEY,
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        editor TEXT, old_body TEXT, new_body TEXT, ts BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edits_msg ON message_edits (jid, message_id, ts);

      CREATE TABLE IF NOT EXISTS message_reactions (
        id BIGSERIAL PRIMARY KEY,
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        reactor TEXT NOT NULL, emoji TEXT, ts BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions (jid, message_id, ts);

      CREATE TABLE IF NOT EXISTS message_receipts (
        jid TEXT NOT NULL, message_id TEXT NOT NULL,
        recipient TEXT NOT NULL, status INTEGER NOT NULL, ts BIGINT NOT NULL,
        PRIMARY KEY (jid, message_id, recipient)
      );

      ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at BIGINT;
      ALTER TABLE messages ADD COLUMN IF NOT EXISTS status INTEGER NOT NULL DEFAULT 0;
    `);
  },
  async down(_ctx) { /* intentionally a no-op */ },
};
