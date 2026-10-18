/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 012 — generic change timeline (v1.21.0, dashboard history views).
 * Mongo flavour: schemaless, indexes only (same as mongo/010).
 */
module.exports = {
  version: 12,
  description: 'timeline_events generic change log — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['timeline_events', { domain: 1, ts: -1 }, {}],
      ['timeline_events', { domain: 1, entity_id: 1, ts: -1 }, {}],
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
      await conn.collection('timeline_events').drop();
    } catch (_) {
      /* ignore */
    }
  },
};
