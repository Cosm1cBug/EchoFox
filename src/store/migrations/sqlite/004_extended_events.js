/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 004 — extended event persistence (v1.1.0).
 *
 * Adds tables for the previously-stub event handlers:
 *   • blocklist                — WhatsApp blocklist (per-bot, single column set)
 *   • presence                 — last-known presence per JID
 *   • labels                   — WhatsApp Business labels metadata
 *   • label_associations       — label ↔ chat/message links
 *   • newsletters              — newsletter metadata
 *   • newsletter_views         — view counter per newsletter message
 *   • newsletter_reactions     — append-only reaction log per newsletter message
 *   • newsletter_settings      — per-newsletter user settings (mute, etc.)
 *   • lid_mapping              — LID ↔ JID mapping for Baileys 7.x LID system
 *   • message_capping          — per-chat message-cap settings
 *
 * Also extends existing tables (non-destructive ALTER):
 *   • chats:    pinned INTEGER, muted_until INTEGER, archived INTEGER, deleted_at INTEGER
 *   • contacts: status TEXT, verified_name TEXT
 */
module.exports = {
  version: 4,
  description: 'extended event persistence — blocklist, presence, labels, newsletters, lid-mapping',

  up({ db }) {
    db.exec(`
      -- ─── Blocklist (Baileys: blocklist.set / blocklist.update) ───
      CREATE TABLE IF NOT EXISTS blocklist (
        jid        TEXT PRIMARY KEY,
        added_at   INTEGER NOT NULL DEFAULT 0
      );

      -- ─── Presence (Baileys: presence.update) ───
      CREATE TABLE IF NOT EXISTS presence (
        jid           TEXT PRIMARY KEY,
        last_state    TEXT,
        last_seen_ts  INTEGER,
        chat_jid      TEXT,
        updated_at    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_presence_chat ON presence (chat_jid);
      CREATE INDEX IF NOT EXISTS idx_presence_updated ON presence (updated_at DESC);

      -- ─── WhatsApp Business Labels (Baileys: labels.edit / labels.association) ───
      CREATE TABLE IF NOT EXISTS labels (
        label_id    TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        color       INTEGER,
        deleted     INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS label_associations (
        label_id      TEXT NOT NULL,
        target_type   TEXT NOT NULL CHECK (target_type IN ('chat', 'message')),
        target_jid    TEXT NOT NULL,
        target_msg_id TEXT,
        associated_at INTEGER NOT NULL,
        PRIMARY KEY (label_id, target_type, target_jid, target_msg_id)
      );
      CREATE INDEX IF NOT EXISTS idx_la_jid ON label_associations (target_jid);

      -- ─── Newsletters (Baileys: newsletter.upsert / newsletter.update) ───
      CREATE TABLE IF NOT EXISTS newsletters (
        newsletter_id TEXT PRIMARY KEY,
        name          TEXT,
        description   TEXT,
        picture_url   TEXT,
        verification  TEXT,
        subscribers   INTEGER DEFAULT 0,
        meta          TEXT,
        created_at    INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS newsletter_views (
        newsletter_id TEXT NOT NULL,
        message_id    TEXT NOT NULL,
        view_count    INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL,
        PRIMARY KEY (newsletter_id, message_id)
      );

      CREATE TABLE IF NOT EXISTS newsletter_reactions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        newsletter_id TEXT NOT NULL,
        message_id    TEXT NOT NULL,
        emoji         TEXT,
        count         INTEGER NOT NULL DEFAULT 0,
        recorded_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nr_msg ON newsletter_reactions (newsletter_id, message_id);

      CREATE TABLE IF NOT EXISTS newsletter_settings (
        newsletter_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL DEFAULT '{}',
        updated_at    INTEGER NOT NULL DEFAULT 0
      );

      -- ─── LID Mapping (Baileys 7.x: lid-mapping.update) ───
      CREATE TABLE IF NOT EXISTS lid_mapping (
        lid         TEXT PRIMARY KEY,
        jid         TEXT NOT NULL,
        updated_at  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lid_jid ON lid_mapping (jid);

      -- ─── Message Capping (Baileys: message-capping.update) ───
      CREATE TABLE IF NOT EXISTS message_capping (
        jid         TEXT PRIMARY KEY,
        cap_value   INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Extend chats + contacts via ALTER (idempotent — try/catch each column)
    const safeAlter = (sql) => {
      try { db.exec(sql); } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    };

    safeAlter(`ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE chats ADD COLUMN muted_until INTEGER`);
    safeAlter(`ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    safeAlter(`ALTER TABLE chats ADD COLUMN deleted_at INTEGER`);

    safeAlter(`ALTER TABLE contacts ADD COLUMN status TEXT`);
    safeAlter(`ALTER TABLE contacts ADD COLUMN verified_name TEXT`);
  },
};