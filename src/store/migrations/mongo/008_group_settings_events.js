/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 008 — group settings event log (v1.14.0). Mongo flavour.
 *
 * Creates a compound index on (jid, ts desc) so the per-group history
 * query is fast, and a sparse index on `field` for future field-scoped
 * analytics queries.
 */
module.exports = {
  version: 8,
  description: 'group settings event log (v1.14.0) — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['group_settings_events', { jid: 1, ts: -1 }, {}],
      ['group_settings_events', { field: 1 }, {}],
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
      await conn.collection('group_settings_events').drop();
    } catch (_) {
      /* ignore */
    }
  },
};
