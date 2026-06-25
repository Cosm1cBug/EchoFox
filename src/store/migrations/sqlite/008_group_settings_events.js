/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 008 — group settings event log (v1.14.0). SQLite flavour.
 *
 * Append-only log of every detected change to a group's tracked
 * settings (subject, description, announce/restrict modes,
 * ephemeral timer, member-add-mode, join-approval-mode).
 *
 * See src/store/schema/groupSettingsEvents.js for the field vocabulary
 * and serialisation conventions.
 *
 * Idempotent.
 */
module.exports = {
  version: 8,
  description: 'group settings event log (v1.14.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_settings_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        jid        TEXT    NOT NULL,
        field      TEXT    NOT NULL,
        old_value  TEXT,
        new_value  TEXT,
        actor      TEXT,
        ts         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gse_jid_ts ON group_settings_events (jid, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_gse_field ON group_settings_events (field);
    `);
  },

  down({ db }) {
    db.exec(`
      DROP INDEX IF EXISTS idx_gse_field;
      DROP INDEX IF EXISTS idx_gse_jid_ts;
      DROP TABLE IF EXISTS group_settings_events;
    `);
  },
};
