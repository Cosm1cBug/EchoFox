/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 010 — admin audit log (v1.17.0). Redis flavour.
 *
 * Schemaless. Key layout (created lazily by redisStore.js v1.17.0+):
 *
 *   admin_audit:log         LIST of JSON entries (capped at 10 000 newest)
 *                            — for the dashboard "Audit log" tab
 *   admin_audit:by:<jid>    LIST of JSON entries per actor (capped at 1000)
 *                            — for per-user drill-down
 *   admin_audit:cmd:<name>  LIST of JSON entries per command (capped at 1000)
 *                            — for per-command drill-down
 *
 * Pruning trims the LIST by age in the writer path (LTRIM after each push).
 * 90-day prune is best-effort — old rows beyond the cap drop off the tail.
 */
module.exports = {
  version: 10,
  description: 'admin audit log (v1.17.0) — Redis schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
