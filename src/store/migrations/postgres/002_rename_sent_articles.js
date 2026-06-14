/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v0.4.7 — rename thehackersnews_sent_articles → service_sent_items (pg).
 *
 *   Same intent as sqlite/002. Postgres' ALTER TABLE ... RENAME is
 *   transactional + idempotent via to_regclass() guards.
 */
module.exports = {
  version: 2,
  description: 'rename thehackersnews_sent_articles → service_sent_items',

  async up({ pool }) {
    await pool.query(`
      DO $$
      BEGIN
        IF to_regclass('public.service_sent_items') IS NULL
           AND to_regclass('public.thehackersnews_sent_articles') IS NOT NULL THEN
          ALTER TABLE thehackersnews_sent_articles RENAME TO service_sent_items;
          ALTER TABLE service_sent_items RENAME COLUMN article_url TO item_url;
        END IF;
      END
      $$;

      -- Fresh-install fallback in case neither table exists yet
      CREATE TABLE IF NOT EXISTS service_sent_items (
        service     TEXT NOT NULL,
        jid         TEXT NOT NULL,
        item_url    TEXT NOT NULL,
        sent_at     BIGINT NOT NULL,
        PRIMARY KEY (service, jid, item_url)
      );
    `);
  },

  async down(_ctx) {
    /* intentionally a no-op */
  },
};
