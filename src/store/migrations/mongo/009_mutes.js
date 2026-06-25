/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 009 — persistent mutes (v1.15.0). Mongo flavour.
 *
 * Indexes mirror the sqlite ones. The "active" partial index uses Mongo's
 * partialFilterExpression to scope to non-unmuted rows.
 */
module.exports = {
  version: 9,
  description: 'persistent mutes log (v1.15.0) — indexes',

  async up({ conn, logger }) {
    const specs = [
      ['mutes', { chat_jid: 1, created_at: -1 }, {}],
      ['mutes', { user_jid: 1, created_at: -1 }, {}],
      [
        'mutes',
        { expires_at: 1 },
        {
          partialFilterExpression: { unmuted_at: null },
        },
      ],
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
      await conn.collection('mutes').drop();
    } catch (_) {
      /* ignore */
    }
  },
};
