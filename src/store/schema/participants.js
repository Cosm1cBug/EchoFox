/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Participant event-stream schema.
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  We never delete participant records. Every change becomes an    │
 *   │  append-only event in `group_participants_events`.               │
 *   │                                                                  │
 *   │  Action vocabulary (lowercase, snake_case):                      │
 *   │    add           — added by an admin                             │
 *   │    join          — joined via group link                         │
 *   │    leave         — voluntary leave (author === participant)      │
 *   │    kick          — removed by an admin (author !== participant)  │
 *   │    promote       — given admin                                   │
 *   │    demote        — admin revoked                                 │
 *   │    request       — pending join-request submitted                │
 *   │    approve       — pending join-request approved                 │
 *   │    reject        — pending join-request rejected                 │
 *   │                                                                  │
 *   │  Classification (LEFT vs KICKED):                                │
 *   │    Baileys reports raw action='remove' + author. We split:       │
 *   │      action='remove' && author === participant → 'leave'         │
 *   │      action='remove' && author !== participant → 'kick'          │
 *   │    The classification happens in                                 │
 *   │    src/events/group-participants.update.js BEFORE recording.     │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * This module defines the canonical action enum + helpers used by every
 * store backend (SQLite, Postgres, MongoDB, Redis). Each backend's
 * schema-creation code lives in its own store file and imports from here.
 */

const ACTIONS = Object.freeze({
  ADD: 'add',
  JOIN: 'join',
  LEAVE: 'leave',
  KICK: 'kick',
  PROMOTE: 'promote',
  DEMOTE: 'demote',
  REQUEST: 'request',
  APPROVE: 'approve',
  REJECT: 'reject',
});

const VALID_ACTIONS = new Set(Object.values(ACTIONS));

/**
 * Classify a raw Baileys group-participants.update action into our richer
 * vocabulary. Pass in the raw `action` ('add' | 'remove' | 'promote' |
 * 'demote'), the actor (`author`), and the participant being affected.
 * Returns one of ACTIONS.
 */
function classifyAction(rawAction, actor, participant) {
  switch (rawAction) {
    case 'remove':
      // Baileys doesn't tell us "left" vs "kicked"; we derive it.
      return actor && actor === participant ? ACTIONS.LEAVE : ACTIONS.KICK;
    case 'add':
      return ACTIONS.ADD;
    case 'promote':
      return ACTIONS.PROMOTE;
    case 'demote':
      return ACTIONS.DEMOTE;
    case 'approve':
      return ACTIONS.APPROVE;
    case 'reject':
      return ACTIONS.REJECT;
    case 'request':
      return ACTIONS.REQUEST;
    default:
      return rawAction; // unknown — record raw
  }
}

/**
 * SQL DDL for SQLite / Postgres (mostly compatible; per-store adapters
 * tweak placeholders as needed). MongoDB defines its own schema in
 * mongoStore.js using mongoose. Redis is schemaless (key prefixes only).
 */
const SQL_DDL = {
  sqlite: `
    CREATE TABLE IF NOT EXISTS group_participants_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_jid   TEXT    NOT NULL,
      participant TEXT    NOT NULL,
      action      TEXT    NOT NULL,
      actor       TEXT,
      ts          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gpe_group_ts
      ON group_participants_events (group_jid, ts);
    CREATE INDEX IF NOT EXISTS idx_gpe_participant
      ON group_participants_events (participant);
  `,
  postgres: `
    CREATE TABLE IF NOT EXISTS group_participants_events (
      id          BIGSERIAL PRIMARY KEY,
      group_jid   TEXT      NOT NULL,
      participant TEXT      NOT NULL,
      action      TEXT      NOT NULL,
      actor       TEXT,
      ts          BIGINT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gpe_group_ts
      ON group_participants_events (group_jid, ts);
    CREATE INDEX IF NOT EXISTS idx_gpe_participant
      ON group_participants_events (participant);
  `,
};

module.exports = {
  ACTIONS,
  VALID_ACTIONS,
  classifyAction,
  SQL_DDL,
};
