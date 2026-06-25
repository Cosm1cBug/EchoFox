/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 008 — group settings event log (v1.14.0). Postgres flavour.
 *
 * Same logical schema as sqlite/008.
 */
module.exports = {
  version: 8,
  description: 'group settings event log (v1.14.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_settings_events (
        id         BIGSERIAL PRIMARY KEY,
        jid        TEXT      NOT NULL,
        field      TEXT      NOT NULL,
        old_value  TEXT,
        new_value  TEXT,
        actor      TEXT,
        ts         BIGINT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gse_jid_ts ON group_settings_events (jid, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_gse_field ON group_settings_events (field);
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP INDEX IF EXISTS idx_gse_field;
      DROP INDEX IF EXISTS idx_gse_jid_ts;
      DROP TABLE IF EXISTS group_settings_events;
    `);
  },
};
