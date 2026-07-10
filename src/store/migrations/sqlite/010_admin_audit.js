/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 010 — admin_audit log (v1.17.0). SQLite flavour.
 *
 *   Records every privileged command invocation:
 *     • $-prefix admin commands ($ai, $leveling, $purge, etc.)
 *     • commands with `admin: true` exported
 *     • commands with `groupAdminOnly: true` (group admin acting in their group)
 *
 *   Append-only. Periodically pruned by adminAuditService (default 90d).
 *
 *   Columns:
 *     id          surrogate key
 *     ts          unix seconds
 *     actor_jid   who invoked (full JID)
 *     chat_jid    where invoked (group jid or self JID for DM)
 *     cmd_name    command name (without prefix)
 *     prefix      the prefix used ('$' / '.' / etc) — distinguishes admin vs user prefix
 *     args        joined args string, truncated to 500 chars
 *     kind        'admin' | 'group_admin' (which auth path triggered the log)
 *     outcome     'success' | 'failure' | 'timeout' | 'denied'
 *     latency_ms  command duration (null if pre-execution outcome like 'denied')
 */
module.exports = {
  version: 10,
  description: 'admin audit log (v1.17.0)',

  up({ db }) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          INTEGER NOT NULL,
        actor_jid   TEXT    NOT NULL,
        chat_jid    TEXT,
        cmd_name    TEXT    NOT NULL,
        prefix      TEXT,
        args        TEXT,
        kind        TEXT    NOT NULL,
        outcome     TEXT    NOT NULL,
        latency_ms  INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit (ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit (actor_jid, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_cmd ON admin_audit (cmd_name, ts DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_kind ON admin_audit (kind, ts DESC);
    `);
  },

  down({ db }) {
    db.exec(`
      DROP INDEX IF EXISTS idx_admin_audit_kind;
      DROP INDEX IF EXISTS idx_admin_audit_cmd;
      DROP INDEX IF EXISTS idx_admin_audit_actor;
      DROP INDEX IF EXISTS idx_admin_audit_ts;
      DROP TABLE IF EXISTS admin_audit;
    `);
  },
};
