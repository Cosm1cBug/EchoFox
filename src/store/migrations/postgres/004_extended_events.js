/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 004 — extended event persistence (v1.1.0). Postgres flavour.
 *
 * Same logical schema as the sqlite/004 migration; uses Postgres types
 * (BIGINT for ms timestamps, JSONB for the meta + settings columns).
 */
module.exports = {
  version: 4,
  description: 'extended event persistence — blocklist, presence, labels, newsletters, lid-mapping',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocklist (
        jid       TEXT PRIMARY KEY,
        added_at  BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS presence (
        jid           TEXT PRIMARY KEY,
        last_state    TEXT,
        last_seen_ts  BIGINT,
        chat_jid      TEXT,
        updated_at    BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_presence_chat ON presence (chat_jid);
      CREATE INDEX IF NOT EXISTS idx_presence_updated ON presence (updated_at DESC);

      CREATE TABLE IF NOT EXISTS labels (
        label_id   TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        color      INTEGER,
        deleted    BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS label_associations (
        label_id      TEXT NOT NULL,
        target_type   TEXT NOT NULL CHECK (target_type IN ('chat', 'message')),
        target_jid    TEXT NOT NULL,
        target_msg_id TEXT,
        associated_at BIGINT NOT NULL,
        PRIMARY KEY (label_id, target_type, target_jid, target_msg_id)
      );
      CREATE INDEX IF NOT EXISTS idx_la_jid ON label_associations (target_jid);

      CREATE TABLE IF NOT EXISTS newsletters (
        newsletter_id TEXT PRIMARY KEY,
        name          TEXT,
        description   TEXT,
        picture_url   TEXT,
        verification  TEXT,
        subscribers   INTEGER DEFAULT 0,
        meta          JSONB,
        created_at    BIGINT NOT NULL DEFAULT 0,
        updated_at    BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS newsletter_views (
        newsletter_id TEXT NOT NULL,
        message_id    TEXT NOT NULL,
        view_count    INTEGER NOT NULL DEFAULT 0,
        updated_at    BIGINT NOT NULL,
        PRIMARY KEY (newsletter_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS newsletter_reactions (
        id            BIGSERIAL PRIMARY KEY,
        newsletter_id TEXT NOT NULL,
        message_id    TEXT NOT NULL,
        emoji         TEXT,
        count         INTEGER NOT NULL DEFAULT 0,
        recorded_at   BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nr_msg ON newsletter_reactions (newsletter_id, message_id);

      CREATE TABLE IF NOT EXISTS newsletter_settings (
        newsletter_id TEXT PRIMARY KEY,
        settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at    BIGINT NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS lid_mapping (
        lid         TEXT PRIMARY KEY,
        jid         TEXT NOT NULL,
        updated_at  BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lid_jid ON lid_mapping (jid);

      CREATE TABLE IF NOT EXISTS message_capping (
        jid         TEXT PRIMARY KEY,
        cap_value   INTEGER NOT NULL,
        updated_at  BIGINT NOT NULL DEFAULT 0
      );

      -- Extend chats + contacts (Postgres ALTER ... IF NOT EXISTS is 9.6+)
      ALTER TABLE chats    ADD COLUMN IF NOT EXISTS pinned       INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE chats    ADD COLUMN IF NOT EXISTS muted_until  BIGINT;
      ALTER TABLE chats    ADD COLUMN IF NOT EXISTS archived     INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE chats    ADD COLUMN IF NOT EXISTS deleted_at   BIGINT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS status        TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verified_name TEXT;
    `);
  },
};