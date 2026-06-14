/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Generic per-service subscriber registry.
 *
 *   service  — string key naming the service (e.g. 'alienvault', 'thehackernews')
 *   jid      — WhatsApp JID of the subscribed user/group
 *   meta     — JSON blob for per-subscription extras
 *               (e.g. { lastSeenPulseTs: 1700000000 })
 *   created_at — when the subscription was created
 *
 *   The pair (service, jid) is unique; re-subscribing is idempotent.
 *
 * Used by:
 *   • AlienVault pulse delivery (.alienvault on/off)
 *   • Future per-service subscriptions (TheHackerNews digest, weather alerts, etc.)
 */

const SQL_DDL = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS subscribers (
      service     TEXT NOT NULL,
      jid         TEXT NOT NULL,
      meta        TEXT,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (service, jid)
    );
    CREATE INDEX IF NOT EXISTS idx_subscribers_service ON subscribers (service);
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS subscribers (
      service     TEXT NOT NULL,
      jid         TEXT NOT NULL,
      meta        JSONB,
      created_at  BIGINT NOT NULL,
      PRIMARY KEY (service, jid)
    );
    CREATE INDEX IF NOT EXISTS idx_subscribers_service ON subscribers (service);
  `,
};

module.exports = { SQL_DDL };
