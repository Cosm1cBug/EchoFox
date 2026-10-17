/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Migration 011 — message-capping info column (v1.20.0, event fix E5).
 *
 * The Baileys `message-capping.update` event delivers an ACCOUNT-LEVEL
 * NewChatMessageCapInfo (total_quota, used_quota, cycle window, ote/mv/
 * capping status) — not a per-chat scalar. This adds an `info` TEXT column
 * to `message_capping` for the full JSON payload; the account row is stored
 * under the reserved jid '@account' and `cap_value` mirrors used_quota so
 * the legacy scalar API stays meaningful.
 *
 * SQLite flavour. Idempotent: column check + guarded ALTER (SQLite does
 * not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
 */
module.exports = {
  version: 11,
  description: 'message_capping.info JSON column (account quota, v1.20.0)',

  up({ db }) {
    const cols = db
      .prepare(`PRAGMA table_info(message_capping)`)
      .all()
      .map((c) => c.name);
    if (!cols.includes('info')) {
      try {
        db.exec(`ALTER TABLE message_capping ADD COLUMN info TEXT`);
      } catch {
        /* column already exists — idempotent */
      }
    }
  },

  down(_ctx) {
    // No-op. Dropping the column would lose quota history for no benefit.
  },
};
