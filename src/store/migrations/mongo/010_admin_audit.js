/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 010 — admin audit log (v1.17.0). Mongo flavour.
 *
 * Schemaless. We only create indexes mirroring sqlite/010.
 */
module.exports = {
  version: 10,
  description: 'admin audit log (v1.17.0) — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['admin_audit', { ts: -1 }, {}],
      ['admin_audit', { actor_jid: 1, ts: -1 }, {}],
      ['admin_audit', { cmd_name: 1, ts: -1 }, {}],
      ['admin_audit', { kind: 1, ts: -1 }, {}],
    ];
    for (const [coll, keys, opts] of specs) {
      try {
        await conn.collection(coll).createIndex(keys, opts);
      } catch (e) {
        if (logger?.warn) logger.warn({ coll, err: e.message }, 'index create failed (continuing)');
      }
    }
  },

  async down({ conn }) {
    try {
      await conn.collection('admin_audit').drop();
    } catch (_) {
      /* ignore */
    }
  },
};
