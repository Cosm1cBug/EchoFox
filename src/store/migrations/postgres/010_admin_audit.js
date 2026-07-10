/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 010 — admin audit log (v1.17.0). Postgres flavour.
 */
module.exports = {
  version: 10,
  description: 'admin audit log (v1.17.0)',

  async up({ pool }) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id          BIGSERIAL PRIMARY KEY,
        ts          BIGINT    NOT NULL,
        actor_jid   TEXT      NOT NULL,
        chat_jid    TEXT,
        cmd_name    TEXT      NOT NULL,
        prefix      TEXT,
        args        TEXT,
        kind        TEXT      NOT NULL,
        outcome     TEXT      NOT NULL,
        latency_ms  BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit (actor_jid, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_cmd ON admin_audit (cmd_name, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_kind ON admin_audit (kind, ts DESC);
    `);
  },

  async down({ pool }) {
    await pool.query(`
      DROP INDEX IF EXISTS idx_admin_audit_kind;
      DROP INDEX IF EXISTS idx_admin_audit_cmd;
      DROP INDEX IF EXISTS idx_admin_audit_actor;
      DROP INDEX IF EXISTS idx_admin_audit_ts;
      DROP TABLE IF EXISTS admin_audit;
    `);
  },
};
