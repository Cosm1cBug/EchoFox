/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

function _parseMeta(raw) {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const Database = require('better-sqlite3');
const path = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');
const { LRUCache } = require('lru-cache');
const { proto, extractMessageContent, getContentType } = require('@whiskeysockets/baileys');
const { isNonHumanContent, normaliseTs } = require('../lib/messageFilters');
const { config } = require('../lib/configLoader');
const { SQL_DDL: PARTICIPANTS_DDL } = require('./schema/participants');
const { SQL_DDL: STATS_DDL } = require('./schema/stats');
const { SQL_DDL: EXTRAS_DDL, applyMessagesMigration_sqlite } = require('./schema/messages-extras');

// Reserved row id for the account-level message-capping quota (v1.20.0, E5).
// Real JIDs are always `something@domain`, so '@account' cannot collide.
const ACCOUNT_CAPPING_JID = '@account';

function makeSQLiteStore({ dbPath, logger, groupCache }) {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');
  db.pragma('cache_size = -64000');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      jid         TEXT NOT NULL,
      id          TEXT NOT NULL,
      from_me     INTEGER NOT NULL DEFAULT 0,
      participant TEXT,
      msg         BLOB,
      ts          INTEGER NOT NULL,
      PRIMARY KEY (jid, id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
    CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages (jid, ts DESC);

    CREATE TABLE IF NOT EXISTS chats (
      jid    TEXT PRIMARY KEY,
      name   TEXT,
      unread INTEGER DEFAULT 0,
      ts     INTEGER
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid     TEXT PRIMARY KEY,
      name    TEXT,
      notify  TEXT,
      img_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);

    CREATE TABLE IF NOT EXISTS groups (
      jid      TEXT PRIMARY KEY,
      subject  TEXT,
      creation INTEGER,
      meta     BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_groups_subject ON groups (subject COLLATE NOCASE);

    ${STATS_DDL.sqlite}
    ${PARTICIPANTS_DDL.sqlite}
    ${EXTRAS_DDL.sqlite}

    CREATE TABLE IF NOT EXISTS service_subscribers (
      service TEXT NOT NULL,
      jid     TEXT NOT NULL,
      last_seen_pulse_ts INTEGER,
      meta    TEXT,
      PRIMARY KEY (service, jid)
    );

    CREATE TABLE IF NOT EXISTS service_sent_items (
      service TEXT NOT NULL,
      jid     TEXT NOT NULL,
      item_url TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      PRIMARY KEY (service, jid, item_url)
    );

    CREATE TABLE IF NOT EXISTS blocklist (
      jid       TEXT PRIMARY KEY,
      added_at  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS presence (
      jid           TEXT PRIMARY KEY,
      last_state    TEXT,
      last_seen_ts  INTEGER,
      chat_jid      TEXT,
      updated_at    INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_presence_chat ON presence (chat_jid);
    CREATE INDEX IF NOT EXISTS idx_presence_updated ON presence (updated_at DESC);

    CREATE TABLE IF NOT EXISTS labels (
      label_id    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       INTEGER,
      deleted     INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS label_associations (
      label_id      TEXT NOT NULL,
      target_type   TEXT NOT NULL CHECK (target_type IN ('chat', 'message')),
      target_jid    TEXT NOT NULL,
      target_msg_id TEXT,
      associated_at INTEGER NOT NULL,
      PRIMARY KEY (label_id, target_type, target_jid, target_msg_id)
    );

    CREATE INDEX IF NOT EXISTS idx_la_jid ON label_associations (target_jid);

    CREATE TABLE IF NOT EXISTS newsletters (
      newsletter_id TEXT PRIMARY KEY,
      name          TEXT,
      description   TEXT,
      picture_url   TEXT,
      verification  TEXT,
      subscribers   INTEGER DEFAULT 0,
      meta          TEXT,
      created_at    INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS newsletter_views (
      newsletter_id TEXT NOT NULL,
      message_id    TEXT NOT NULL,
      view_count    INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (newsletter_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS newsletter_reactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      newsletter_id TEXT NOT NULL,
      message_id    TEXT NOT NULL,
      emoji         TEXT,
      count         INTEGER NOT NULL DEFAULT 0,
      recorded_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_nr_msg ON newsletter_reactions (newsletter_id, message_id);

    CREATE TABLE IF NOT EXISTS newsletter_settings (
      newsletter_id TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lid_mapping (
      lid         TEXT PRIMARY KEY,
      jid         TEXT NOT NULL,
      updated_at  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_lid_jid ON lid_mapping (jid);

    CREATE TABLE IF NOT EXISTS message_capping (
      jid         TEXT PRIMARY KEY,
      cap_value   INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL DEFAULT 0,
      -- v1.20.0 (E5): full JSON of the account-level NewChatMessageCapInfo
      -- (the message-capping.update event). The account row uses the
      -- reserved jid '@account'; cap_value mirrors used_quota.
      info        TEXT
    );

    -- v1.2.0 AI tables ───────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ai_conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid    TEXT    NOT NULL,
      role        TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      tool_name   TEXT,
      tool_args   TEXT,
      tool_id     TEXT,
      model       TEXT,
      provider    TEXT,
      prompt_tokens     INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      ts          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_conv_chat_ts ON ai_conversations (chat_jid, ts);

    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      day               TEXT    NOT NULL,
      provider          TEXT    NOT NULL,
      model             TEXT    NOT NULL,
      prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd          REAL    NOT NULL DEFAULT 0,
      calls             INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, provider, model)
    );

    CREATE TABLE IF NOT EXISTS ai_chat_opt_in (
      chat_jid    TEXT    PRIMARY KEY,
      enabled     INTEGER NOT NULL DEFAULT 0,
      persona     TEXT,
      provider    TEXT,
      model       TEXT,
      updated_at  INTEGER NOT NULL
    );

    -- v1.3.0 AI persistent rate-limit counters ───────────────
    CREATE TABLE IF NOT EXISTS ai_rate_user (
      user_jid    TEXT    NOT NULL,
      hour_bucket INTEGER NOT NULL,
      count       INTEGER NOT NULL DEFAULT 0,
      expires_at  INTEGER NOT NULL,
      PRIMARY KEY (user_jid, hour_bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_rate_user_exp ON ai_rate_user (expires_at);

    CREATE TABLE IF NOT EXISTS ai_rate_chat (
      chat_jid    TEXT    NOT NULL,
      day_bucket  INTEGER NOT NULL,
      count       INTEGER NOT NULL DEFAULT 0,
      expires_at  INTEGER NOT NULL,
      PRIMARY KEY (chat_jid, day_bucket)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_rate_chat_exp ON ai_rate_chat (expires_at);

    -- v1.12.0 user leveling ────────────────────────────────────
    CREATE TABLE IF NOT EXISTS user_levels (
      jid      TEXT    PRIMARY KEY,
      xp       INTEGER NOT NULL DEFAULT 0,
      last_at  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_user_levels_xp ON user_levels (xp);

    -- v1.14.0 group settings event log ─────────────────────────
    CREATE TABLE IF NOT EXISTS group_settings_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      jid        TEXT    NOT NULL,
      field      TEXT    NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      actor      TEXT,
      ts         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gse_jid_ts ON group_settings_events (jid, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_gse_field ON group_settings_events (field);

    -- v1.17.0 admin audit log ─────────────────────────────────
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

    -- v1.15.0 persistent mutes log ─────────────────────────────
    CREATE TABLE IF NOT EXISTS mutes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid    TEXT    NOT NULL,
      user_jid    TEXT    NOT NULL,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      by_jid      TEXT,
      reason      TEXT,
      unmuted_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mutes_chat ON mutes (chat_jid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes (user_jid, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mutes_active ON mutes (expires_at) WHERE unmuted_at IS NULL;

    -- v1.21.0 generic change timeline (dashboard history views) ───────
    CREATE TABLE IF NOT EXISTS timeline_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      domain     TEXT NOT NULL,
      entity_id  TEXT,
      field      TEXT,
      old_value  TEXT,
      new_value  TEXT,
      actor      TEXT,
      source     TEXT,
      ts         INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_domain_ts ON timeline_events (domain, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_timeline_entity_ts ON timeline_events (domain, entity_id, ts DESC);

  `);

  applyMessagesMigration_sqlite(db);

  try {
    const _ssCols = db
      .prepare(`PRAGMA table_info(service_subscribers)`)
      .all()
      .map((c) => c.name);
    if (!_ssCols.includes('meta')) {
      db.exec(`ALTER TABLE service_subscribers ADD COLUMN meta TEXT`);
    }
  } catch (e) {
    logger.warn({ err: e }, 'service_subscribers.meta column ensure failed');
  }

  try {
    const _tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => r.name);
    if (
      _tables.includes('thehackersnews_sent_articles') &&
      !_tables.includes('service_sent_items')
    ) {
      db.exec(`ALTER TABLE thehackersnews_sent_articles RENAME TO service_sent_items`);
      db.exec(`ALTER TABLE service_sent_items RENAME COLUMN article_url TO item_url`);
    }
  } catch (e) {
    logger.warn({ err: e }, 'service_sent_items rename guard failed');
  }

  try {
    const _cCols = db
      .prepare(`PRAGMA table_info(chats)`)
      .all()
      .map((c) => c.name);
    if (!_cCols.includes('pinned'))
      db.exec(`ALTER TABLE chats ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`);
    if (!_cCols.includes('muted_until'))
      db.exec(`ALTER TABLE chats ADD COLUMN muted_until INTEGER`);
    if (!_cCols.includes('archived'))
      db.exec(`ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
    if (!_cCols.includes('deleted_at')) db.exec(`ALTER TABLE chats ADD COLUMN deleted_at INTEGER`);
  } catch (e) {
    logger.warn({ err: e }, 'chats v1.1.0 column upgrade failed');
  }

  try {
    const _ctCols = db
      .prepare(`PRAGMA table_info(contacts)`)
      .all()
      .map((c) => c.name);
    if (!_ctCols.includes('status')) db.exec(`ALTER TABLE contacts ADD COLUMN status TEXT`);
    if (!_ctCols.includes('verified_name'))
      db.exec(`ALTER TABLE contacts ADD COLUMN verified_name TEXT`);
  } catch (e) {
    logger.warn({ err: e }, 'contacts v1.1.0 column upgrade failed');
  }

  try {
    const _mcCols = db
      .prepare(`PRAGMA table_info(message_capping)`)
      .all()
      .map((c) => c.name);
    // v1.20.0 (E5): NewChatMessageCapInfo JSON column. Migration
    // migrations/sqlite/011 does this too, but the migration runner only runs
    // AFTER makeSQLiteStore() returns (lifecycle.selectStore) — while the
    // messageCappingInfo* statements below are prepared eagerly during init.
    // Without this inline ensure, a pre-E5 database crashes right at
    // prepare() ("table message_capping has no column named info") and
    // migration 011 never gets the chance to run.
    if (!_mcCols.includes('info')) db.exec(`ALTER TABLE message_capping ADD COLUMN info TEXT`);
  } catch (e) {
    logger.warn({ err: e }, 'message_capping v1.20.0 column upgrade failed');
  }

  const stmts = {
    msgInsert: db.prepare(
      `INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (@jid,@id,@fromMe,@participant,@msg,@ts)`,
    ),
    msgGet: db.prepare(`SELECT msg FROM messages WHERE jid = ? AND id = ?`),
    msgPrune: db.prepare(`DELETE FROM messages WHERE ts < ?`),

    chatUpsert: db.prepare(
      `INSERT INTO chats (jid,name,unread,ts) VALUES (?,?,?,?) ON CONFLICT(jid) DO UPDATE SET name=excluded.name, unread=excluded.unread, ts=excluded.ts`,
    ),
    contactUpsert: db.prepare(
      `INSERT INTO contacts (jid,name,notify,img_url) VALUES (?,?,?,?) ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,name), notify=COALESCE(excluded.notify,notify), img_url=COALESCE(excluded.img_url,img_url)`,
    ),
    contactExists: db.prepare(`SELECT 1 FROM contacts WHERE jid = ? LIMIT 1`),

    groupUpsert: db.prepare(
      `INSERT OR REPLACE INTO groups (jid,subject,creation,meta) VALUES (?,?,?,?)`,
    ),
    groupGet: db.prepare(`SELECT meta FROM groups WHERE jid = ?`),
    groupCount: db.prepare(`SELECT COUNT(*) AS n FROM groups`),
    groupsList: db.prepare(`SELECT jid, subject, meta FROM groups ORDER BY subject COLLATE NOCASE`),

    statUpsert: db.prepare(
      `INSERT INTO stats (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`,
    ),
    statsAll: db.prepare(`SELECT key, value FROM stats`),

    gaugeUpsert: db.prepare(
      `INSERT INTO stats_gauges (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    ),
    gaugesAll: db.prepare(`SELECT key, value FROM stats_gauges`),

    partInsert: db.prepare(
      `INSERT INTO group_participants_events (group_jid, participant, action, actor, ts) VALUES (?, ?, ?, ?, ?)`,
    ),
    partHistory: db.prepare(
      `SELECT participant, action, actor, ts FROM group_participants_events WHERE group_jid = ? ORDER BY ts DESC LIMIT ?`,
    ),
    partCurrent: db.prepare(
      `SELECT participant, MAX(ts) AS last_ts, (SELECT action FROM group_participants_events e2 WHERE e2.group_jid = e.group_jid AND e2.participant = e.participant ORDER BY ts DESC LIMIT 1) AS last_action FROM group_participants_events e WHERE group_jid = ? GROUP BY participant`,
    ),
    uniqueUsersCount: db.prepare(
      `SELECT COUNT(DISTINCT participant) AS n FROM group_participants_events`,
    ),

    getSubscribers: db.prepare(
      `SELECT jid, last_seen_pulse_ts, meta FROM service_subscribers WHERE service = ?`,
    ),
    addSubscriber: db.prepare(
      `INSERT OR IGNORE INTO service_subscribers (service, jid, last_seen_pulse_ts, meta) VALUES (?, ?, NULL, ?)`,
    ),
    removeSubscriber: db.prepare(`DELETE FROM service_subscribers WHERE service = ? AND jid = ?`),
    updateSubscriberTs: db.prepare(
      `UPDATE service_subscribers SET last_seen_pulse_ts = ? WHERE service = ? AND jid = ?`,
    ),
    isSubscriber: db.prepare(
      `SELECT 1 FROM service_subscribers WHERE service = ? AND jid = ? LIMIT 1`,
    ),
    getSubscriberMeta: db.prepare(
      `SELECT meta FROM service_subscribers WHERE service = ? AND jid = ?`,
    ),
    updateSubscriberMeta: db.prepare(
      `UPDATE service_subscribers SET meta = ? WHERE service = ? AND jid = ?`,
    ),

    hasSentItem: db.prepare(
      `SELECT 1 FROM service_sent_items WHERE service = ? AND jid = ? AND item_url = ?`,
    ),
    recordSentItem: db.prepare(
      `INSERT OR IGNORE INTO service_sent_items (service, jid, item_url, sent_at) VALUES (?, ?, ?, ?)`,
    ),

    editInsert: db.prepare(
      `INSERT INTO message_edits (jid, message_id, editor, old_body, new_body, ts) VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    editsByMsg: db.prepare(
      `SELECT editor, old_body, new_body, ts FROM message_edits WHERE jid = ? AND message_id = ? ORDER BY ts ASC`,
    ),

    reactInsert: db.prepare(
      `INSERT INTO message_reactions (jid, message_id, reactor, emoji, ts) VALUES (?, ?, ?, ?, ?)`,
    ),
    reactionsByMsg: db.prepare(
      `SELECT reactor, emoji, ts FROM message_reactions WHERE jid = ? AND message_id = ? ORDER BY ts ASC`,
    ),

    receiptUpsert: db.prepare(
      `INSERT INTO message_receipts (jid, message_id, recipient, status, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid, message_id, recipient) DO UPDATE SET status = MAX(status, excluded.status), ts = excluded.ts`,
    ),
    receiptsByMsg: db.prepare(
      `SELECT recipient, status, ts FROM message_receipts WHERE jid = ? AND message_id = ? ORDER BY ts ASC`,
    ),

    msgMarkDeletedExtra: db.prepare(
      `UPDATE messages SET deleted_at = ? WHERE jid = ? AND id = ? AND deleted_at IS NULL`,
    ),
    chatMarkAllDeleted: db.prepare(
      `UPDATE messages SET deleted_at = ? WHERE jid = ? AND deleted_at IS NULL`,
    ),
    msgUpdateBody: db.prepare(`UPDATE messages SET msg = ?, ts = ? WHERE jid = ? AND id = ?`),
    msgUpdateStatus: db.prepare(
      `UPDATE messages SET status = MAX(IFNULL(status,0), ?) WHERE jid = ? AND id = ?`,
    ),

    // v1.12.0 — user leveling
    levelGet: db.prepare(`SELECT xp, last_at FROM user_levels WHERE jid = ?`),
    levelUpsertAdd: db.prepare(
      `INSERT INTO user_levels (jid, xp, last_at) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET xp = xp + excluded.xp, last_at = excluded.last_at`,
    ),
    levelGetXp: db.prepare(`SELECT xp FROM user_levels WHERE jid = ?`),

    // v1.16.0 — leveling extensions
    levelTopByXp: db.prepare(
      `SELECT jid, xp, last_at FROM user_levels
       WHERE xp > 0
       ORDER BY xp DESC, jid ASC
       LIMIT ?`,
    ),
    levelActiveSince: db.prepare(
      `SELECT jid, xp, last_at FROM user_levels
       WHERE xp > 0 AND last_at >= ?
       ORDER BY xp DESC, last_at DESC, jid ASC
       LIMIT ?`,
    ),
    levelDecayCandidates: db.prepare(
      `SELECT jid, xp, last_at FROM user_levels
       WHERE xp > 0 AND last_at > 0 AND last_at < ?`,
    ),
    levelSetXp: db.prepare(`UPDATE user_levels SET xp = ? WHERE jid = ?`),

    // v1.16.0 — most-changed-groups card
    gseMostChangedSince: db.prepare(
      `SELECT jid, COUNT(*) AS cnt
       FROM group_settings_events
       WHERE ts >= ?
       GROUP BY jid
       ORDER BY cnt DESC, jid ASC
       LIMIT ?`,
    ),

    // v1.16.0 — field-scoped settings history filter
    gseHistoryByField: db.prepare(
      `SELECT id, field, old_value, new_value, actor, ts
       FROM group_settings_events
       WHERE jid = ? AND field = ?
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    ),

    // v1.17.0 — admin audit log
    auditInsert: db.prepare(
      `INSERT INTO admin_audit (ts, actor_jid, chat_jid, cmd_name, prefix, args, kind, outcome, latency_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    auditList: db.prepare(
      `SELECT id, ts, actor_jid, chat_jid, cmd_name, prefix, args, kind, outcome, latency_ms
       FROM admin_audit
       WHERE ts >= ?
       ORDER BY ts DESC, id DESC
       LIMIT ? OFFSET ?`,
    ),
    auditListByActor: db.prepare(
      `SELECT id, ts, actor_jid, chat_jid, cmd_name, prefix, args, kind, outcome, latency_ms
       FROM admin_audit
       WHERE actor_jid = ? AND ts >= ?
       ORDER BY ts DESC, id DESC LIMIT ?`,
    ),
    auditListByCmd: db.prepare(
      `SELECT id, ts, actor_jid, chat_jid, cmd_name, prefix, args, kind, outcome, latency_ms
       FROM admin_audit
       WHERE cmd_name = ? AND ts >= ?
       ORDER BY ts DESC, id DESC LIMIT ?`,
    ),
    auditPrune: db.prepare(`DELETE FROM admin_audit WHERE ts < ?`),
    auditRowCount: db.prepare(`SELECT COUNT(*) AS n FROM admin_audit`),
    // v1.20.2 (M1): filtered counts so GET /api/audit's `total` honours the
    // same actor/cmd/window filters as the event list (was a global count).
    auditCountWindow: db.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE ts >= ?`),
    auditCountByActor: db.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit WHERE actor_jid = ? AND ts >= ?`,
    ),
    auditCountByCmd: db.prepare(
      `SELECT COUNT(*) AS n FROM admin_audit WHERE cmd_name = ? AND ts >= ?`,
    ),

    // v1.21.0 — generic change timeline (dashboard history views)
    timelineInsert: db.prepare(
      `INSERT INTO timeline_events (domain, entity_id, field, old_value, new_value, actor, source, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),

    // v1.13.0 — last human (non-bot) message timestamp per group
    // ts is normalised to seconds on write (see the messages.upsert bind), so
    // the column can stay bare and idx_messages_jid_ts serves MAX(ts) as an
    // index lookup. Wrapping it in CASE (the previous form) forced a scan of
    // every row for that jid.
    lastHumanMsgTs: db.prepare(`SELECT MAX(ts) AS ts FROM messages WHERE jid = ? AND from_me = 0`),
    // One round trip for every chat at once — used by the dashboard's
    // /api/groups, which previously fired one synchronous query per group
    // every 15 s and blocked the event loop.
    lastHumanMsgTsAll: db.prepare(
      `SELECT jid, MAX(ts) AS ts FROM messages WHERE from_me = 0 GROUP BY jid`,
    ),
    // v1.14.0 — group settings event log
    gseInsert: db.prepare(
      `INSERT INTO group_settings_events (jid, field, old_value, new_value, actor, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    gseHistory: db.prepare(
      `SELECT id, field, old_value, new_value, actor, ts
       FROM group_settings_events
       WHERE jid = ?
       ORDER BY ts DESC, id DESC
       LIMIT ?`,
    ),

    // v1.15.0 — persistent mutes
    muteInsert: db.prepare(
      `INSERT INTO mutes (chat_jid, user_jid, created_at, expires_at, by_jid, reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    muteMarkUnmuted: db.prepare(
      `UPDATE mutes SET unmuted_at = ?
       WHERE chat_jid = ? AND user_jid = ? AND unmuted_at IS NULL AND expires_at > ?`,
    ),
    muteActiveAll: db.prepare(
      `SELECT id, chat_jid, user_jid, created_at, expires_at, by_jid, reason
       FROM mutes
       WHERE unmuted_at IS NULL AND expires_at > ?`,
    ),
    muteHistoryByChat: db.prepare(
      `SELECT id, chat_jid, user_jid, created_at, expires_at, by_jid, reason, unmuted_at
       FROM mutes WHERE chat_jid = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ),
    muteHistoryByUser: db.prepare(
      `SELECT id, chat_jid, user_jid, created_at, expires_at, by_jid, reason, unmuted_at
       FROM mutes WHERE user_jid = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ),
    deletedInGroup: db.prepare(
      `SELECT id, participant, deleted_at FROM messages WHERE jid = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`,
    ),

    blocklistInsert: db.prepare(`INSERT OR IGNORE INTO blocklist (jid, added_at) VALUES (?, ?)`),
    blocklistRemove: db.prepare(`DELETE FROM blocklist WHERE jid = ?`),
    blocklistAll: db.prepare(`SELECT jid, added_at FROM blocklist ORDER BY added_at DESC`),
    blocklistClear: db.prepare(`DELETE FROM blocklist`),
    blocklistHas: db.prepare(`SELECT 1 FROM blocklist WHERE jid = ? LIMIT 1`),

    presenceUpsert: db.prepare(
      `INSERT INTO presence (jid, last_state, last_seen_ts, chat_jid, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET last_state=excluded.last_state, last_seen_ts=COALESCE(excluded.last_seen_ts, last_seen_ts), chat_jid=excluded.chat_jid, updated_at=excluded.updated_at`,
    ),
    presenceGet: db.prepare(
      `SELECT jid, last_state, last_seen_ts, chat_jid, updated_at FROM presence WHERE jid = ?`,
    ),
    presenceInChat: db.prepare(
      `SELECT jid, last_state, last_seen_ts, updated_at FROM presence WHERE chat_jid = ? ORDER BY updated_at DESC`,
    ),
    presenceRecent: db.prepare(
      `SELECT jid, last_state, last_seen_ts, chat_jid, updated_at FROM presence ORDER BY updated_at DESC LIMIT ?`,
    ),

    chatUpdatePartial: db.prepare(
      `UPDATE chats SET name = COALESCE(?, name), unread = COALESCE(?, unread), ts = COALESCE(?, ts), pinned = COALESCE(?, pinned), muted_until = COALESCE(?, muted_until), archived = COALESCE(?, archived) WHERE jid = ?`,
    ),
    chatMarkDeleted: db.prepare(`UPDATE chats SET deleted_at = ? WHERE jid = ?`),
    chatListAll: db.prepare(
      `SELECT jid, name, unread, ts, pinned, muted_until, archived, deleted_at FROM chats ORDER BY ts DESC`,
    ),
    chatGet: db.prepare(
      `SELECT jid, name, unread, ts, pinned, muted_until, archived, deleted_at FROM chats WHERE jid = ?`,
    ),

    contactUpsertExt: db.prepare(
      `INSERT INTO contacts (jid, name, notify, img_url, status, verified_name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,name), notify=COALESCE(excluded.notify,notify), img_url=COALESCE(excluded.img_url,img_url), status=COALESCE(excluded.status,status), verified_name=COALESCE(excluded.verified_name,verified_name)`,
    ),
    contactGet: db.prepare(
      `SELECT jid, name, notify, img_url, status, verified_name FROM contacts WHERE jid = ?`,
    ),
    contactList: db.prepare(
      `SELECT jid, name, notify, img_url, status, verified_name FROM contacts ORDER BY COALESCE(name, notify, jid) COLLATE NOCASE LIMIT ? OFFSET ?`,
    ),
    contactCount: db.prepare(`SELECT COUNT(*) AS n FROM contacts`),

    labelUpsert: db.prepare(
      `INSERT INTO labels (label_id, name, color, deleted, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(label_id) DO UPDATE SET name=excluded.name, color=excluded.color, deleted=0, updated_at=excluded.updated_at`,
    ),
    labelSoftDelete: db.prepare(`UPDATE labels SET deleted = 1, updated_at = ? WHERE label_id = ?`),
    labelGet: db.prepare(
      `SELECT label_id, name, color, deleted, updated_at FROM labels WHERE label_id = ?`,
    ),
    labelList: db.prepare(
      `SELECT label_id, name, color, deleted, updated_at FROM labels WHERE deleted = 0 ORDER BY name COLLATE NOCASE`,
    ),
    labelAssocInsert: db.prepare(
      `INSERT OR IGNORE INTO label_associations (label_id, target_type, target_jid, target_msg_id, associated_at) VALUES (?, ?, ?, ?, ?)`,
    ),
    labelAssocRemove: db.prepare(
      `DELETE FROM label_associations WHERE label_id = ? AND target_type = ? AND target_jid = ? AND IFNULL(target_msg_id, '') = IFNULL(?, '')`,
    ),
    labelAssocByLabel: db.prepare(
      `SELECT label_id, target_type, target_jid, target_msg_id, associated_at FROM label_associations WHERE label_id = ?`,
    ),
    labelAssocByTarget: db.prepare(
      `SELECT la.label_id, l.name, l.color FROM label_associations la JOIN labels l ON la.label_id = l.label_id WHERE la.target_jid = ? AND l.deleted = 0`,
    ),

    newsletterUpsert: db.prepare(
      `INSERT INTO newsletters (newsletter_id, name, description, picture_url, verification, subscribers, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(newsletter_id) DO UPDATE SET name=COALESCE(excluded.name, name), description=COALESCE(excluded.description, description), picture_url=COALESCE(excluded.picture_url, picture_url), verification=COALESCE(excluded.verification, verification), subscribers=COALESCE(excluded.subscribers, subscribers), meta=COALESCE(excluded.meta, meta), updated_at=excluded.updated_at`,
    ),
    newsletterGet: db.prepare(
      `SELECT newsletter_id, name, description, picture_url, verification, subscribers, meta, created_at, updated_at FROM newsletters WHERE newsletter_id = ?`,
    ),
    newsletterList: db.prepare(
      `SELECT newsletter_id, name, description, picture_url, verification, subscribers, created_at, updated_at FROM newsletters ORDER BY updated_at DESC`,
    ),
    newsletterViewInc: db.prepare(
      `INSERT INTO newsletter_views (newsletter_id, message_id, view_count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(newsletter_id, message_id) DO UPDATE SET view_count = view_count + 1, updated_at = excluded.updated_at`,
    ),
    // v1.20.2 (E8): set-with-max — the server's view counter value replaces
    // the tally, monotonically (idempotent under dup/out-of-order notices).
    newsletterViewSet: db.prepare(
      `INSERT INTO newsletter_views (newsletter_id, message_id, view_count, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(newsletter_id, message_id) DO UPDATE SET view_count = MAX(view_count, excluded.view_count), updated_at = excluded.updated_at`,
    ),
    newsletterViewGet: db.prepare(
      `SELECT message_id, view_count, updated_at FROM newsletter_views WHERE newsletter_id = ? AND message_id = ?`,
    ),
    newsletterViewList: db.prepare(
      `SELECT message_id, view_count, updated_at FROM newsletter_views WHERE newsletter_id = ? ORDER BY updated_at DESC LIMIT ?`,
    ),
    newsletterReactInsert: db.prepare(
      `INSERT INTO newsletter_reactions (newsletter_id, message_id, emoji, count, recorded_at) VALUES (?, ?, ?, ?, ?)`,
    ),
    newsletterReactByMsg: db.prepare(
      `SELECT emoji, SUM(count) AS total, MAX(recorded_at) AS last_seen FROM newsletter_reactions WHERE newsletter_id = ? AND message_id = ? GROUP BY emoji ORDER BY total DESC`,
    ),
    newsletterSettingsUpsert: db.prepare(
      `INSERT INTO newsletter_settings (newsletter_id, settings_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(newsletter_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at`,
    ),
    newsletterSettingsGet: db.prepare(
      `SELECT settings_json, updated_at FROM newsletter_settings WHERE newsletter_id = ?`,
    ),

    lidMappingUpsert: db.prepare(
      `INSERT INTO lid_mapping (lid, jid, updated_at) VALUES (?, ?, ?) ON CONFLICT(lid) DO UPDATE SET jid=excluded.jid, updated_at=excluded.updated_at`,
    ),
    // ─── Merged chat/contact view (dashboard Chats tab) ──────────────────
    // One round trip joining: saved name + push name (contacts), chat state
    // (chats), BOTH addressing forms (lid_mapping, looked up in either
    // direction), first/last inbound message (messages) and live presence
    // (presence). Replaces the N+1 the Chats page would otherwise need.
    //
    // `base` is the UNION of contacts and chats because either can exist
    // without the other: a contact may have no chat row yet, and a chat may
    // exist for someone we have no contact entry for.
    chatEnriched: db.prepare(`
      SELECT
        base.jid                                  AS jid,
        c.name                                    AS savedName,
        c.notify                                  AS pushName,
        c.img_url                                 AS imgUrl,
        c.verified_name                           AS verifiedName,
        ch.name                                   AS chatName,
        ch.unread                                 AS unread,
        ch.pinned                                 AS pinned,
        ch.archived                               AS archived,
        pn.jid                                    AS phoneJid,
        ld.lid                                    AS lid,
        m.first_ts                                AS firstSeenTs,
        m.last_ts                                 AS lastSeenTs,
        m.msg_count                               AS messageCount,
        p.last_state                              AS presenceState,
        p.last_seen_ts                            AS presenceLastSeenTs,
        p.updated_at                              AS presenceUpdatedAt
      FROM (
        SELECT jid FROM contacts
        UNION
        SELECT jid FROM chats
      ) AS base
      LEFT JOIN contacts    c  ON c.jid  = base.jid
      LEFT JOIN chats       ch ON ch.jid = base.jid
      LEFT JOIN lid_mapping pn ON pn.lid = base.jid
      LEFT JOIN lid_mapping ld ON ld.jid = base.jid
      LEFT JOIN (
        SELECT jid, MIN(ts) AS first_ts, MAX(ts) AS last_ts, COUNT(*) AS msg_count
        FROM messages
        WHERE from_me = 0
        GROUP BY jid
      ) m ON m.jid = base.jid
      LEFT JOIN presence    p  ON p.jid  = base.jid
      ORDER BY COALESCE(m.last_ts, ch.ts, 0) DESC
      LIMIT ? OFFSET ?
    `),
    chatEnrichedCount: db.prepare(`
      SELECT COUNT(*) AS n FROM (SELECT jid FROM contacts UNION SELECT jid FROM chats)
    `),

    // ─── Conversation history (dashboard Chat tab) ───────────────────────
    // Newest-first then re-reversed by the caller so pagination stays cheap
    // (the (jid, ts DESC) index serves both the filter and the ORDER BY).
    messageHistory: db.prepare(`
      SELECT id, from_me, participant, ts, msg
      FROM messages
      WHERE jid = ?
      ORDER BY ts DESC
      LIMIT ?
    `),
    messageHistoryBefore: db.prepare(`
      SELECT id, from_me, participant, ts, msg
      FROM messages
      WHERE jid = ? AND ts < ?
      ORDER BY ts DESC
      LIMIT ?
    `),

    // ─── Status / Stories ────────────────────────────────────────────────
    // Statuses are ordinary rows in `messages` with jid = 'status@broadcast'
    // (messages.upsert is not filtered for status when features.readStatus is
    // on, and the store's bind has no status exclusion). Views arrive as
    // message-receipt.update with key.remoteJid='status@broadcast' and land in
    // `message_receipts` via the existing handler — verified against
    // baileys/lib/Socket/messages-recv.js:1186, which emits that event for
    // isJidStatusBroadcast(remoteJid).
    //
    // So no new tables or capture paths are required; these are read-only
    // projections over data already being collected.
    statusList: db.prepare(`
      SELECT id, from_me, participant, ts, msg
      FROM messages
      WHERE jid = 'status@broadcast' AND ts >= ?
      ORDER BY ts DESC
      LIMIT ?
    `),
    statusListByAuthor: db.prepare(`
      SELECT id, from_me, participant, ts, msg
      FROM messages
      WHERE jid = 'status@broadcast' AND ts >= ? AND participant = ?
      ORDER BY ts DESC
      LIMIT ?
    `),
    statusViewCounts: db.prepare(`
      SELECT message_id, COUNT(*) AS n, MAX(ts) AS last_ts
      FROM message_receipts
      WHERE jid = 'status@broadcast'
      GROUP BY message_id
    `),
    statusViewers: db.prepare(`
      SELECT recipient, status, ts
      FROM message_receipts
      WHERE jid = 'status@broadcast' AND message_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `),

    lidMappingGet: db.prepare(`SELECT jid FROM lid_mapping WHERE lid = ?`),
    lidMappingRev: db.prepare(`SELECT lid FROM lid_mapping WHERE jid = ?`),

    messageCappingUpsert: db.prepare(
      `INSERT INTO message_capping (jid, cap_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET cap_value=excluded.cap_value, updated_at=excluded.updated_at`,
    ),
    messageCappingGet: db.prepare(
      `SELECT cap_value, updated_at FROM message_capping WHERE jid = ?`,
    ),
    messageCappingInfoUpsert: db.prepare(
      `INSERT INTO message_capping (jid, cap_value, updated_at, info) VALUES (?, ?, ?, ?) ON CONFLICT(jid) DO UPDATE SET cap_value=excluded.cap_value, updated_at=excluded.updated_at, info=excluded.info`,
    ),
    messageCappingInfoGet: db.prepare(
      `SELECT cap_value, updated_at, info FROM message_capping WHERE jid = ?`,
    ),

    // v1.2.0 AI ──────────────────────────────────────────────
    aiConvInsert: db.prepare(
      `INSERT INTO ai_conversations (chat_jid, role, content, tool_name, tool_args, tool_id, model, provider, prompt_tokens, completion_tokens, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    aiConvRecent: db.prepare(
      `SELECT role, content, tool_name, tool_args, tool_id, model, provider, prompt_tokens, completion_tokens, ts FROM ai_conversations WHERE chat_jid = ? ORDER BY id DESC LIMIT ?`,
    ),
    aiConvClear: db.prepare(`DELETE FROM ai_conversations WHERE chat_jid = ?`),

    aiUsageUpsert: db.prepare(
      `INSERT INTO ai_usage_daily (day, provider, model, prompt_tokens, completion_tokens, cost_usd, calls) VALUES (?, ?, ?, ?, ?, ?, 1) ON CONFLICT(day, provider, model) DO UPDATE SET prompt_tokens = prompt_tokens + excluded.prompt_tokens, completion_tokens = completion_tokens + excluded.completion_tokens, cost_usd = cost_usd + excluded.cost_usd, calls = calls + 1`,
    ),
    aiUsageDayTotal: db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage_daily WHERE day = ?`,
    ),
    aiUsageRecent: db.prepare(
      `SELECT day, provider, model, prompt_tokens, completion_tokens, cost_usd, calls FROM ai_usage_daily WHERE day >= ? ORDER BY day DESC, cost_usd DESC`,
    ),
    aiUsageAllDays: db.prepare(
      `SELECT day, SUM(cost_usd) AS cost_usd, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens, SUM(calls) AS calls FROM ai_usage_daily GROUP BY day ORDER BY day DESC LIMIT ?`,
    ),

    aiOptInUpsert: db.prepare(
      `INSERT INTO ai_chat_opt_in (chat_jid, enabled, persona, provider, model, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_jid) DO UPDATE SET enabled=excluded.enabled, persona=excluded.persona, provider=excluded.provider, model=excluded.model, updated_at=excluded.updated_at`,
    ),
    aiOptInGet: db.prepare(
      `SELECT enabled, persona, provider, model, updated_at FROM ai_chat_opt_in WHERE chat_jid = ?`,
    ),
    aiOptInAll: db.prepare(
      `SELECT chat_jid, enabled, persona, provider, model, updated_at FROM ai_chat_opt_in ORDER BY updated_at DESC LIMIT ?`,
    ),

    // v1.3.0 — AI persistent rate-limit counters
    aiRateUserUpsert: db.prepare(
      `INSERT INTO ai_rate_user (user_jid, hour_bucket, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_jid, hour_bucket) DO UPDATE SET count = count + 1`,
    ),
    aiRateUserGet: db.prepare(
      `SELECT count FROM ai_rate_user WHERE user_jid = ? AND hour_bucket = ?`,
    ),
    aiRateUserPrune: db.prepare(`DELETE FROM ai_rate_user WHERE expires_at < ?`),
    aiRateChatUpsert: db.prepare(
      `INSERT INTO ai_rate_chat (chat_jid, day_bucket, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(chat_jid, day_bucket) DO UPDATE SET count = count + 1`,
    ),
    aiRateChatGet: db.prepare(
      `SELECT count FROM ai_rate_chat WHERE chat_jid = ? AND day_bucket = ?`,
    ),
    aiRateChatPrune: db.prepare(`DELETE FROM ai_rate_chat WHERE expires_at < ?`),
  };

  const msgHot = new LRUCache({ max: 5_000, ttl: 1000 * 60 * 30 });

  const writeMessages = db.transaction((rows) => {
    for (const r of rows) stmts.msgInsert.run(r);
  });

  setInterval(
    () => {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch (e) {
        logger.warn({ err: e }, 'store: wal_checkpoint failed');
      }
    },
    60 * 60 * 1000,
  ).unref();

  setTimeout(() => {
    try {
      db.exec('VACUUM');
      logger.info('store: weekly VACUUM ok');
    } catch (e) {
      logger.warn({ err: e }, 'store: VACUUM failed');
    }
    setInterval(
      () => {
        try {
          db.exec('VACUUM');
        } catch (e) {
          logger.warn({ err: e }, 'store: VACUUM failed');
        }
      },
      7 * 24 * 60 * 60 * 1000,
    ).unref();
  }, 30_000).unref();

  setInterval(
    () => {
      try {
        const days = config.privacy?.messageBodyRetentionDays || 0;
        if (days <= 0) {
          const cutoff = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
          const r = stmts.msgPrune.run(cutoff);
          if (r.changes) logger.debug({ removed: r.changes }, 'store: pruned old messages');
          return;
        }
        const cutoff = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * days;
        const r = stmts.msgPrune.run(cutoff);
        if (r.changes)
          logger.debug({ removed: r.changes, days }, 'store: pruned old messages (privacy)');
      } catch (e) {
        logger.warn({ err: e }, 'store: prune failed');
      }
    },
    60 * 60 * 1000,
  ).unref();

  return {
    db,

    async hasContact(jid) {
      try {
        const row = stmts.contactExists?.get(jid);
        return !!row;
      } catch (e) {
        logger.warn({ err: e, jid }, 'hasContact failed');
        return false;
      }
    },

    async getMessage(key) {
      const k = `${key.remoteJid}|${key.id}`;
      const hot = msgHot.get(k);
      if (hot) return hot;
      const row = stmts.msgGet.get(key.remoteJid, key.id);
      if (!row?.msg) return undefined;
      const decoded = proto.Message.decode(row.msg);
      msgHot.set(k, decoded);
      return decoded;
    },

    async getGroupMetadata(jid) {
      const mem = groupCache.get(jid);
      if (mem) return mem;
      const row = stmts.groupGet.get(jid);
      if (!row?.meta) return undefined;
      const parsed = JSON.parse(row.meta.toString('utf8'));
      groupCache.set(jid, parsed);
      return parsed;
    },

    saveGroupMetadata(jid, meta) {
      groupCache.set(jid, meta);
      stmts.groupUpsert.run(
        jid,
        meta.subject ?? null,
        meta.creation ?? null,
        Buffer.from(JSON.stringify(meta), 'utf8'),
      );
    },

    recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        stmts.partInsert.run(
          groupJid,
          participant,
          action,
          actor || null,
          ts ?? Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e }, 'participant event insert failed');
      }
    },

    getParticipantHistory(groupJid, limit = 500) {
      return new Promise((resolve) => {
        setImmediate(() => {
          try {
            const result = stmts.partHistory.all(groupJid, limit);
            resolve(result);
          } catch (e) {
            logger.warn({ err: e }, 'participant history query failed');
            resolve([]);
          }
        });
      });
    },

    getCurrentParticipants(groupJid) {
      return new Promise((resolve) => {
        setImmediate(() => {
          try {
            const result = stmts.partCurrent
              .all(groupJid)
              .filter(
                (r) =>
                  r.last_action !== 'leave' &&
                  r.last_action !== 'kick' &&
                  r.last_action !== 'reject',
              );
            resolve(result);
          } catch (e) {
            logger.warn({ err: e }, 'current participants query failed');
            resolve([]);
          }
        });
      });
    },

    // labels ─────────────────────────────────────────
    async upsertLabel(labelId, name, color) {
      try {
        if (!labelId || !name) return;
        stmts.labelUpsert.run(labelId, name, color ?? null, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, labelId }, 'upsertLabel failed');
      }
    },
    async deleteLabel(labelId) {
      try {
        stmts.labelSoftDelete.run(Math.floor(Date.now() / 1000), labelId);
      } catch (e) {
        logger.warn({ err: e, labelId }, 'deleteLabel failed');
      }
    },
    async getLabel(labelId) {
      try {
        return stmts.labelGet.get(labelId) || null;
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabel failed');
        return null;
      }
    },
    async listLabels() {
      try {
        return stmts.labelList.all();
      } catch (e) {
        logger.warn({ err: e }, 'listLabels failed');
        return [];
      }
    },
    async associateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        stmts.labelAssocInsert.run(
          labelId,
          targetType,
          targetJid,
          targetMsgId || null,
          Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'associateLabel failed');
      }
    },
    async disassociateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        stmts.labelAssocRemove.run(labelId, targetType, targetJid, targetMsgId || null);
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'disassociateLabel failed');
      }
    },
    async getLabelAssociations(labelId) {
      try {
        return stmts.labelAssocByLabel.all(labelId);
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabelAssociations failed');
        return [];
      }
    },
    async getLabelsForTarget(targetJid) {
      try {
        return stmts.labelAssocByTarget.all(targetJid);
      } catch (e) {
        logger.warn({ err: e, targetJid }, 'getLabelsForTarget failed');
        return [];
      }
    },

    // newsletters ────────────────────────────────────
    async upsertNewsletter(newsletterId, meta = {}) {
      try {
        if (!newsletterId) return;
        const ts = Math.floor(Date.now() / 1000);
        const m = meta || {};
        stmts.newsletterUpsert.run(
          newsletterId,
          m.name ?? null,
          m.description ?? null,
          m.picture_url ?? m.pictureUrl ?? null,
          m.verification ?? null,
          m.subscribers ?? null,
          m.raw ? JSON.stringify(m.raw) : null,
          m.created_at ?? ts,
          ts,
        );
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'upsertNewsletter failed');
      }
    },
    async updateNewsletter(newsletterId, partial = {}) {
      return this.upsertNewsletter(newsletterId, partial);
    },
    async getNewsletter(newsletterId) {
      try {
        const r = stmts.newsletterGet.get(newsletterId);
        if (!r) return null;
        if (r.meta) {
          try {
            r.meta = JSON.parse(r.meta);
          } catch {
            /* keep raw */
          }
        }
        return r;
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletter failed');
        return null;
      }
    },
    async listNewsletters() {
      try {
        return stmts.newsletterList.all();
      } catch (e) {
        logger.warn({ err: e }, 'listNewsletters failed');
        return [];
      }
    },
    async incrementNewsletterView(newsletterId, messageId) {
      try {
        stmts.newsletterViewInc.run(newsletterId, messageId, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'incrementNewsletterView failed');
      }
    },
    // v1.20.2 (E8): record the server's absolute view-counter value with a
    // monotonic guard (see stmts.newsletterViewSet).
    async setNewsletterViewCount(newsletterId, messageId, count) {
      try {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        stmts.newsletterViewSet.run(newsletterId, messageId, n, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'setNewsletterViewCount failed');
      }
    },
    async getNewsletterViews(newsletterId, messageId, limit = 100) {
      try {
        if (messageId) {
          const r = stmts.newsletterViewGet.get(newsletterId, messageId);
          return r ? [r] : [];
        }
        return stmts.newsletterViewList.all(newsletterId, limit);
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletterViews failed');
        return [];
      }
    },
    async recordNewsletterReaction(newsletterId, messageId, emoji, count = 1) {
      try {
        stmts.newsletterReactInsert.run(
          newsletterId,
          messageId,
          emoji || null,
          count || 1,
          Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'recordNewsletterReaction failed');
      }
    },
    async getNewsletterReactions(newsletterId, messageId) {
      try {
        return stmts.newsletterReactByMsg.all(newsletterId, messageId);
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'getNewsletterReactions failed');
        return [];
      }
    },
    async updateNewsletterSettings(newsletterId, settings = {}) {
      try {
        const json = JSON.stringify(settings || {});
        stmts.newsletterSettingsUpsert.run(newsletterId, json, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'updateNewsletterSettings failed');
      }
    },
    async getNewsletterSettings(newsletterId) {
      try {
        const r = stmts.newsletterSettingsGet.get(newsletterId);
        if (!r) return null;
        try {
          return { settings: JSON.parse(r.settings_json), updated_at: r.updated_at };
        } catch {
          return { settings: {}, updated_at: r.updated_at };
        }
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletterSettings failed');
        return null;
      }
    },

    // lid-mapping ────────────────────────────────────
    async setLidMapping(lid, jid) {
      try {
        if (!lid || !jid) return;
        stmts.lidMappingUpsert.run(lid, jid, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, lid, jid }, 'setLidMapping failed');
      }
    },
    async getLidMapping(lid) {
      try {
        return stmts.lidMappingGet.get(lid)?.jid || null;
      } catch (e) {
        logger.warn({ err: e, lid }, 'getLidMapping failed');
        return null;
      }
    },
    async getReverseLidMapping(jid) {
      try {
        return stmts.lidMappingRev.get(jid)?.lid || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getReverseLidMapping failed');
        return null;
      }
    },

    // message-capping ────────────────────────────────
    async setMessageCap(jid, capValue) {
      try {
        if (!jid || capValue == null) return;
        stmts.messageCappingUpsert.run(jid, Number(capValue), Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, jid }, 'setMessageCap failed');
      }
    },
    async getMessageCap(jid) {
      try {
        const r = stmts.messageCappingGet.get(jid);
        return r ? { cap_value: r.cap_value, updated_at: r.updated_at } : null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getMessageCap failed');
        return null;
      }
    },

    /**
     * Account-level "new chat" message quota (Baileys `message-capping.update`
     * → NewChatMessageCapInfo). Stored under the reserved jid '@account' —
     * real JIDs are always `something@domain`, so this cannot collide.
     * `cap_value` mirrors used_quota so the legacy scalar getter stays
     * meaningful; `info` holds the full field set.
     */
    async setMessageCapInfo(info) {
      try {
        if (!info) return;
        const used = Number(info.used_quota) || 0;
        stmts.messageCappingInfoUpsert.run(
          ACCOUNT_CAPPING_JID,
          used,
          Math.floor(Date.now() / 1000),
          JSON.stringify(info),
        );
      } catch (e) {
        logger.warn({ err: e }, 'setMessageCapInfo failed');
      }
    },
    async getMessageCapInfo() {
      try {
        const r = stmts.messageCappingInfoGet.get(ACCOUNT_CAPPING_JID);
        if (!r) return null;
        let info = null;
        try {
          info = r.info ? JSON.parse(r.info) : null;
        } catch {
          info = null;
        }
        return { cap_value: r.cap_value, updated_at: r.updated_at, info };
      } catch (e) {
        logger.warn({ err: e }, 'getMessageCapInfo failed');
        return null;
      }
    },

    // blocklist ───────────────────────────────────────────────
    async setBlocklist(jids) {
      try {
        if (!Array.isArray(jids)) return;
        const txn = db.transaction((list) => {
          stmts.blocklistClear.run();
          const ts = Math.floor(Date.now() / 1000);
          for (const j of list) if (j) stmts.blocklistInsert.run(j, ts);
        });
        txn(jids);
      } catch (e) {
        logger.warn({ err: e }, 'setBlocklist failed');
      }
    },
    async addToBlocklist(jid) {
      try {
        stmts.blocklistInsert.run(jid, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, jid }, 'addToBlocklist failed');
      }
    },
    async removeFromBlocklist(jid) {
      try {
        stmts.blocklistRemove.run(jid);
      } catch (e) {
        logger.warn({ err: e, jid }, 'removeFromBlocklist failed');
      }
    },
    async getBlocklist() {
      try {
        return stmts.blocklistAll.all();
      } catch (e) {
        logger.warn({ err: e }, 'getBlocklist failed');
        return [];
      }
    },
    async isBlocked(jid) {
      try {
        return !!stmts.blocklistHas.get(jid);
      } catch (e) {
        logger.warn({ err: e, jid }, 'isBlocked failed');
        return false;
      }
    },

    // presence ────────────────────────────────────────────────
    async recordPresence(jid, state, lastSeenTs, chatJid) {
      try {
        stmts.presenceUpsert.run(
          jid,
          state || null,
          lastSeenTs || null,
          chatJid || null,
          Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e, jid }, 'recordPresence failed');
      }
    },
    async getPresence(jid) {
      try {
        return stmts.presenceGet.get(jid) || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getPresence failed');
        return null;
      }
    },
    async getPresenceInChat(chatJid) {
      try {
        return stmts.presenceInChat.all(chatJid);
      } catch (e) {
        logger.warn({ err: e }, 'getPresenceInChat failed');
        return [];
      }
    },
    async getRecentPresence(limit = 50) {
      try {
        return stmts.presenceRecent.all(limit);
      } catch (e) {
        logger.warn({ err: e }, 'getRecentPresence failed');
        return [];
      }
    },

    // chat state ──────────────────────────────────────────────
    async updateChat(jid, partial) {
      try {
        if (!jid) return;
        const { name, unread, ts, pinned, muted_until, archived } = partial || {};
        stmts.chatUpdatePartial.run(
          name ?? null,
          unread ?? null,
          ts ?? null,
          pinned == null ? null : pinned ? 1 : 0,
          muted_until ?? null,
          archived == null ? null : archived ? 1 : 0,
          jid,
        );
      } catch (e) {
        logger.warn({ err: e, jid }, 'updateChat failed');
      }
    },
    async markChatDeleted(jid) {
      try {
        stmts.chatMarkDeleted.run(Math.floor(Date.now() / 1000), jid);
      } catch (e) {
        logger.warn({ err: e, jid }, 'markChatDeleted failed');
      }
    },
    async listChats() {
      try {
        return stmts.chatListAll.all();
      } catch (e) {
        logger.warn({ err: e }, 'listChats failed');
        return [];
      }
    },
    /**
     * Merged chat/contact view for the dashboard's Chats tab.
     *
     * Each row carries: jid, savedName (address-book name), pushName (their
     * own display name), phoneJid + lid (both addressing forms when known),
     * firstSeenTs/lastSeenTs (inbound messages), and presence state.
     *
     * @param {{limit?: number, offset?: number}} [opts]
     */
    listChatsEnriched({ limit = 200, offset = 0 } = {}) {
      try {
        const rows = stmts.chatEnriched.all(limit, offset);
        return { items: rows, total: stmts.chatEnrichedCount.get()?.n || 0, limit, offset };
      } catch (e) {
        logger.warn({ err: e }, 'listChatsEnriched failed');
        return { items: [], total: 0, limit, offset };
      }
    },

    /**
     * Conversation history for one chat, oldest-first.
     *
     * Decoded the same way as listStatuses: wrappers (ephemeral / viewOnce /
     * deviceSent) are unwrapped with extractMessageContent first, then the
     * concrete type is read with getContentType. Bodies may be null when
     * privacy.storeMessageBodies is false — those rows come back as
     * `type: 'unavailable'` rather than being dropped, so the UI can still
     * show that a message happened.
     *
     * @param {string} jid
     * @param {{limit?: number, before?: number}} [opts] `before` is a ts cursor
     */
    listMessages(jid, { limit = 100, before = null } = {}) {
      try {
        if (!jid) return [];
        const capped = Math.max(1, Math.min(Number(limit) || 100, 500));
        const rows = before
          ? stmts.messageHistoryBefore.all(jid, Number(before), capped)
          : stmts.messageHistory.all(jid, capped);

        const out = rows.map((r) => {
          let type = 'unavailable';
          let text = null;
          let mimetype = null;
          let media = null;

          if (r.msg) {
            type = 'unknown';
            try {
              const decoded = proto.Message.decode(r.msg);
              const inner = extractMessageContent(decoded) || decoded;
              const ct = getContentType(inner) || '';
              if (ct === 'conversation') {
                type = 'text';
                text = inner.conversation || null;
              } else if (ct === 'extendedTextMessage') {
                type = 'text';
                text = inner.extendedTextMessage?.text || null;
              } else if (ct === 'imageMessage') {
                type = 'image';
                text = inner.imageMessage?.caption || null;
                mimetype = inner.imageMessage?.mimetype || null;
                media = {
                  id: r.id,
                  width: inner.imageMessage?.width,
                  height: inner.imageMessage?.height,
                };
              } else if (ct === 'videoMessage') {
                type = 'video';
                text = inner.videoMessage?.caption || null;
                mimetype = inner.videoMessage?.mimetype || null;
                media = { id: r.id, seconds: inner.videoMessage?.seconds };
              } else if (ct === 'audioMessage') {
                type = 'audio';
                mimetype = inner.audioMessage?.mimetype || null;
                media = { id: r.id, seconds: inner.audioMessage?.seconds };
              } else if (ct === 'documentMessage') {
                type = 'document';
                text = inner.documentMessage?.fileName || null;
                mimetype = inner.documentMessage?.mimetype || null;
              } else if (ct === 'stickerMessage') {
                type = 'sticker';
                mimetype = inner.stickerMessage?.mimetype || null;
                media = { id: r.id };
              } else if (ct === 'protocolMessage') {
                type = 'system';
              } else if (ct) {
                type = ct.replace(/Message$/, '').toLowerCase();
              }
            } catch (e) {
              logger.debug({ err: e, id: r.id }, 'message decode failed');
            }
          }

          return {
            id: r.id,
            fromMe: !!r.from_me,
            participant: r.participant || null,
            ts: r.ts,
            type,
            text,
            mimetype,
            media,
          };
        });

        return out.reverse(); // oldest-first for rendering
      } catch (e) {
        logger.warn({ err: e, jid }, 'listMessages failed');
        return [];
      }
    },

    /**
     * Status/Story rows in reverse-chronological order.
     *
     * Each item carries a decoded `type` ('text' | 'image' | 'video' |
     * 'audio' | 'unknown'), the caption/text when present, and a `viewCount`
     * from message_receipts. View counts are only meaningful for our OWN
     * statuses (fromMe === true) — WhatsApp sends read receipts for those
     * only; for someone else's status we simply have no view data.
     *
     * @param {{since?: number, participant?: string, limit?: number}} [opts]
     */
    listStatuses({ since = 0, participant = null, limit = 500 } = {}) {
      try {
        const rows = participant
          ? stmts.statusListByAuthor.all(since, participant, limit)
          : stmts.statusList.all(since, limit);

        const counts = new Map();
        for (const c of stmts.statusViewCounts.all()) counts.set(c.message_id, c.n);

        return rows.map((r) => {
          let type = 'unknown';
          let text = null;
          let mimetype = null;

          if (r.msg) {
            try {
              const decoded = proto.Message.decode(r.msg);
              const inner = extractMessageContent(decoded) || decoded;
              const ct = getContentType(inner) || '';
              if (ct === 'conversation') {
                type = 'text';
                text = inner.conversation || null;
              } else if (ct === 'extendedTextMessage') {
                type = 'text';
                text = inner.extendedTextMessage?.text || null;
              } else if (ct === 'imageMessage') {
                type = 'image';
                text = inner.imageMessage?.caption || null;
                mimetype = inner.imageMessage?.mimetype || null;
              } else if (ct === 'videoMessage') {
                type = 'video';
                text = inner.videoMessage?.caption || null;
                mimetype = inner.videoMessage?.mimetype || null;
              } else if (ct === 'audioMessage') {
                type = 'audio';
                mimetype = inner.audioMessage?.mimetype || null;
              } else if (ct) {
                type = ct.replace(/Message$/, '').toLowerCase();
              }
            } catch (e) {
              logger.debug({ err: e, id: r.id }, 'status decode failed');
            }
          }

          return {
            id: r.id,
            fromMe: !!r.from_me,
            participant: r.participant || null,
            ts: r.ts,
            type,
            text,
            mimetype,
            viewCount: counts.get(r.id) || 0,
          };
        });
      } catch (e) {
        logger.warn({ err: e }, 'listStatuses failed');
        return [];
      }
    },

    /** Who viewed a specific status (only ever populated for our own). */
    getStatusViewers(statusId, limit = 500) {
      try {
        return stmts.statusViewers.all(statusId, limit);
      } catch (e) {
        logger.warn({ err: e, statusId }, 'getStatusViewers failed');
        return [];
      }
    },

    async getChat(jid) {
      try {
        return stmts.chatGet.get(jid) || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getChat failed');
        return null;
      }
    },

    // contacts (bulk + extended) ─────────────────────────────
    async bulkUpsertContacts(contacts) {
      try {
        if (!Array.isArray(contacts) || !contacts.length) return 0;
        const txn = db.transaction((list) => {
          let n = 0;
          for (const c of list) {
            if (!c?.id) continue;
            stmts.contactUpsertExt.run(
              c.id,
              c.name ?? null,
              c.notify ?? null,
              c.imgUrl ?? null,
              c.status ?? null,
              c.verifiedName ?? null,
            );
            n++;
          }
          return n;
        });
        return txn(contacts);
      } catch (e) {
        logger.warn({ err: e }, 'bulkUpsertContacts failed');
        return 0;
      }
    },
    async getContact(jid) {
      try {
        return stmts.contactGet.get(jid) || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getContact failed');
        return null;
      }
    },
    async listContacts({ limit = 100, offset = 0 } = {}) {
      try {
        return stmts.contactList.all(limit, offset);
      } catch (e) {
        logger.warn({ err: e }, 'listContacts failed');
        return [];
      }
    },
    async countContacts() {
      try {
        return stmts.contactCount.get()?.n || 0;
      } catch (e) {
        logger.warn({ err: e }, 'countContacts failed');
        return 0;
      }
    },

    // v1.2.0 AI ──────────────────────────────────────────────
    async appendAiTurn(chatJid, turn) {
      try {
        stmts.aiConvInsert.run(
          chatJid,
          String(turn.role || ''),
          String(turn.content == null ? '' : turn.content),
          turn.toolName || null,
          turn.toolArgs
            ? typeof turn.toolArgs === 'string'
              ? turn.toolArgs
              : JSON.stringify(turn.toolArgs)
            : null,
          turn.toolId || null,
          turn.model || null,
          turn.provider || null,
          Number(turn.promptTokens || 0),
          Number(turn.completionTokens || 0),
          Number(turn.ts || Date.now()),
        );
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'appendAiTurn failed');
        return false;
      }
    },
    async getRecentAiTurns(chatJid, limit = 20) {
      try {
        const rows = stmts.aiConvRecent.all(chatJid, Number(limit));
        return rows.reverse().map((r) => ({
          role: r.role,
          content: r.content,
          toolName: r.tool_name || undefined,
          toolArgs: r.tool_args || undefined,
          toolId: r.tool_id || undefined,
          model: r.model || undefined,
          provider: r.provider || undefined,
          promptTokens: r.prompt_tokens || 0,
          completionTokens: r.completion_tokens || 0,
          ts: r.ts,
        }));
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getRecentAiTurns failed');
        return [];
      }
    },
    async clearAiTurns(chatJid) {
      try {
        stmts.aiConvClear.run(chatJid);
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'clearAiTurns failed');
        return false;
      }
    },

    async recordAiUsage({
      day,
      provider,
      model,
      promptTokens = 0,
      completionTokens = 0,
      costUsd = 0,
    }) {
      try {
        stmts.aiUsageUpsert.run(
          String(day),
          String(provider || ''),
          String(model || ''),
          Number(promptTokens) || 0,
          Number(completionTokens) || 0,
          Number(costUsd) || 0,
        );
        return true;
      } catch (e) {
        logger.warn({ err: e }, 'recordAiUsage failed');
        return false;
      }
    },
    async getAiUsageDayTotal(day) {
      try {
        return Number(stmts.aiUsageDayTotal.get(String(day))?.total || 0);
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageDayTotal failed');
        return 0;
      }
    },
    async getAiUsageSince(day) {
      try {
        return stmts.aiUsageRecent.all(String(day)) || [];
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageSince failed');
        return [];
      }
    },
    async getAiUsageByDay(limit = 30) {
      try {
        return stmts.aiUsageAllDays.all(Number(limit)) || [];
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageByDay failed');
        return [];
      }
    },

    async setAiChatOptIn(
      chatJid,
      { enabled = false, persona = null, provider = null, model = null } = {},
    ) {
      try {
        stmts.aiOptInUpsert.run(chatJid, enabled ? 1 : 0, persona, provider, model, Date.now());
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'setAiChatOptIn failed');
        return false;
      }
    },
    async getAiChatOptIn(chatJid) {
      try {
        const r = stmts.aiOptInGet.get(chatJid);
        if (!r) return null;
        return {
          enabled: !!r.enabled,
          persona: r.persona,
          provider: r.provider,
          model: r.model,
          updatedAt: r.updated_at,
        };
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiChatOptIn failed');
        return null;
      }
    },
    async listAiOptedInChats(limit = 100) {
      try {
        return (stmts.aiOptInAll.all(Number(limit)) || []).map((r) => ({
          chatJid: r.chat_jid,
          enabled: !!r.enabled,
          persona: r.persona,
          provider: r.provider,
          model: r.model,
          updatedAt: r.updated_at,
        }));
      } catch (e) {
        logger.warn({ err: e }, 'listAiOptedInChats failed');
        return [];
      }
    },

    // v1.3.0 AI persistent rate-limit ────────────────────────
    async incrAiRateUser(userJid, hourBucket) {
      try {
        const exp = (Number(hourBucket) + 2) * 60 * 60 * 1000;
        stmts.aiRateUserUpsert.run(String(userJid), Number(hourBucket), exp);
        const r = stmts.aiRateUserGet.get(String(userJid), Number(hourBucket));
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'incrAiRateUser failed');
        return 0;
      }
    },
    async getAiRateUser(userJid, hourBucket) {
      try {
        const r = stmts.aiRateUserGet.get(String(userJid), Number(hourBucket));
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'getAiRateUser failed');
        return 0;
      }
    },
    async incrAiRateChat(chatJid, dayBucket) {
      try {
        const exp = (Number(dayBucket) + 2) * 24 * 60 * 60 * 1000;
        stmts.aiRateChatUpsert.run(String(chatJid), Number(dayBucket), exp);
        const r = stmts.aiRateChatGet.get(String(chatJid), Number(dayBucket));
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'incrAiRateChat failed');
        return 0;
      }
    },
    async getAiRateChat(chatJid, dayBucket) {
      try {
        const r = stmts.aiRateChatGet.get(String(chatJid), Number(dayBucket));
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiRateChat failed');
        return 0;
      }
    },
    async pruneAiRate(now = Date.now()) {
      try {
        const a = stmts.aiRateUserPrune.run(Number(now));
        const b = stmts.aiRateChatPrune.run(Number(now));
        return { users: a.changes, chats: b.changes };
      } catch (e) {
        logger.warn({ err: e }, 'pruneAiRate failed');
        return { users: 0, chats: 0 };
      }
    },

    recordStat(key, inc = 1) {
      try {
        stmts.statUpsert.run(key, inc);
      } catch (e) {
        logger.warn({ err: e, key }, 'recordStat failed');
      }
    },

    getStats() {
      try {
        return stmts.statsAll
          .all()
          .reduce((acc, row) => ((acc[row.key] = Number(row.value)), acc), {});
      } catch {
        return {};
      }
    },

    setGauge(key, value) {
      try {
        stmts.gaugeUpsert.run(key, value, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e, key }, 'setGauge failed');
      }
    },

    getGauges() {
      try {
        return stmts.gaugesAll
          .all()
          .reduce((acc, row) => ((acc[row.key] = Number(row.value)), acc), {});
      } catch {
        return {};
      }
    },

    async hasSentItem(service, jid, itemUrl) {
      try {
        return !!stmts.hasSentItem.get(service, jid, itemUrl);
      } catch (e) {
        logger.warn({ err: e }, 'hasSentItem failed');
        return false;
      }
    },
    async recordSentItem(service, jid, itemUrl) {
      try {
        stmts.recordSentItem.run(service, jid, itemUrl, Math.floor(Date.now() / 1000));
      } catch (e) {
        logger.warn({ err: e }, 'recordSentItem failed');
      }
    },

    async hasSentArticle(service, jid, articleUrl) {
      return this.hasSentItem(service, jid, articleUrl);
    },
    async recordSentArticle(service, jid, articleUrl) {
      return this.recordSentItem(service, jid, articleUrl);
    },

    countGroups() {
      try {
        return stmts.groupCount.get().n;
      } catch {
        return 0;
      }
    },
    countUniqueUsers() {
      try {
        return stmts.uniqueUsersCount.get().n;
      } catch {
        return 0;
      }
    },

    listGroups() {
      return new Promise((resolve) => {
        setImmediate(() => {
          try {
            const result = stmts.groupsList.all().map((r) => {
              let meta = null;
              try {
                meta = r.meta ? JSON.parse(r.meta.toString('utf8')) : null;
              } catch {}
              return {
                jid: r.jid,
                subject: r.subject || meta?.subject || '(unnamed)',
                participantCount: meta?.participants?.length || 0,
              };
            });
            resolve(result);
          } catch {
            resolve([]);
          }
        });
      });
    },

    /**
     * Persist raw WAMessage[] — the SINGLE write path for message bodies.
     * Used by the live `messages.upsert` bind listener AND by
     * `messaging-history.set` (history sync backfill), so both channels get
     * identical filtering: privacy exclusions, `storeMessageBodies=false`,
     * and non-human content (protocol / key-distribution / reactions /
     * poll votes / keep-in-chat — see src/lib/messageFilters.js).
     *
     * @param {Array} messages  raw WAMessage[] from Baileys
     * @returns {Promise<number>} rows written
     */
    async saveMessages(messages) {
      if (!Array.isArray(messages) || !messages.length) return 0;
      const storeBodies = config.privacy?.storeMessageBodies !== false;
      const excluded = new Set(config.privacy?.excludeFromStore || []);
      const rows = [];
      for (const m of messages) {
        if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
        if (excluded.has(m.key.remoteJid)) continue;
        // Ignore protocol messages, key distributions, reactions, poll
        // votes and keep-in-chat bookkeeping. None of these are human
        // conversation, and they were flipping dormant groups to "active"
        // on the dashboard (see src/lib/messageFilters.js).
        if (isNonHumanContent(m.message)) continue;

        const ts = normaliseTs(m.messageTimestamp);

        rows.push({
          jid: m.key.remoteJid,
          id: m.key.id,
          fromMe: m.key.fromMe ? 1 : 0,
          participant: m.key.participant ?? null,
          msg: storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null,
          ts,
        });

        if (storeBodies) msgHot.set(`${m.key.remoteJid}|${m.key.id}`, m.message);
      }
      if (rows.length) {
        try {
          writeMessages(rows);
        } catch (e) {
          logger.warn({ err: e }, 'store: msg write failed');
          return 0;
        }
      }
      return rows.length;
    },

    /**
     * Persist a Chat object (proto.IConversation shape — from `chats.upsert`
     * or `messaging-history.set`). name/unread/ts are written authoritatively
     * (insert-or-replace); pinned/mute/archived are merged only when the
     * payload defines them. Note: updateChat is COALESCE-based, so an
     * explicit un-mute cannot clear `muted_until` — same limitation as the
     * live chats.upsert path.
     *
     * @returns {Promise<boolean>} true when a row was written
     */
    async saveChat(chat) {
      if (!chat?.id) return false;
      try {
        stmts.chatUpsert.run(
          chat.id,
          chat.name ?? null,
          Number(chat.unreadCount) || 0,
          Number(chat.conversationTimestamp) || Math.floor(Date.now() / 1000),
        );
        const ext = {};
        if (chat.pinned !== undefined) ext.pinned = chat.pinned;
        if (chat.mute !== undefined) ext.muted_until = chat.mute ?? null;
        if (chat.archived !== undefined) ext.archived = chat.archived;
        if (Object.keys(ext).length) await this.updateChat(chat.id, ext);
        return true;
      } catch (e) {
        logger.warn({ err: e, jid: chat.id }, 'store: saveChat failed');
        return false;
      }
    },

    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        this.saveMessages(messages).catch((e) =>
          logger.warn({ err: e }, 'store: saveMessages failed'),
        );
      });

      ev.on('chats.upsert', (chats) => {
        const tx = db.transaction(() => {
          for (const c of chats)
            stmts.chatUpsert.run(
              c.id,
              c.name ?? null,
              Number(c.unreadCount) || 0,
              Number(c.conversationTimestamp) || Math.floor(Date.now() / 1000),
            );
        });
        try {
          tx();
        } catch (e) {
          logger.warn({ err: e }, 'store: chats.upsert');
        }
      });

      ev.on('contacts.upsert', (contacts) => {
        const tx = db.transaction(() => {
          for (const c of contacts)
            stmts.contactUpsert.run(c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null);
        });
        try {
          tx();
        } catch (e) {
          logger.warn({ err: e }, 'store: contacts.upsert');
        }
      });

      ev.on('contacts.update', (updates) => {
        const tx = db.transaction(() => {
          for (const c of updates)
            stmts.contactUpsert.run(c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null);
        });
        try {
          tx();
        } catch (e) {
          logger.warn({ err: e }, 'store: contacts.update');
        }
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    recordMessageEdit(jid, messageId, editor, oldBody, newBody, ts) {
      try {
        stmts.editInsert.run(
          jid,
          messageId,
          editor || null,
          oldBody || '',
          newBody || '',
          ts ?? Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e }, 'editInsert failed');
      }
    },
    getMessageEdits(jid, messageId) {
      try {
        return stmts.editsByMsg.all(jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'editsByMsg failed');
        return [];
      }
    },

    updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        stmts.msgUpdateBody.run(buf, ts ?? Math.floor(Date.now() / 1000), jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'msgUpdateBody failed');
      }
    },

    recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      try {
        stmts.reactInsert.run(
          jid,
          messageId,
          reactor || '',
          emoji || null,
          ts ?? Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e }, 'reactInsert failed');
      }
    },
    getMessageReactions(jid, messageId) {
      try {
        return stmts.reactionsByMsg.all(jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'reactionsByMsg failed');
        return [];
      }
    },

    recordReceipt(jid, messageId, recipient, status, ts) {
      try {
        stmts.receiptUpsert.run(
          jid,
          messageId,
          recipient,
          status,
          ts ?? Math.floor(Date.now() / 1000),
        );
      } catch (e) {
        logger.warn({ err: e }, 'receiptUpsert failed');
      }
    },
    getMessageReceipts(jid, messageId) {
      try {
        return stmts.receiptsByMsg.all(jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'receiptsByMsg failed');
        return [];
      }
    },

    markMessageDeleted(jid, messageId, _by, ts) {
      try {
        stmts.msgMarkDeletedExtra.run(ts ?? Math.floor(Date.now() / 1000), jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'markMessageDeleted failed');
      }
    },
    markChatMessagesDeleted(jid, ts) {
      try {
        stmts.chatMarkAllDeleted.run(ts ?? Math.floor(Date.now() / 1000), jid);
      } catch (e) {
        logger.warn({ err: e }, 'markChatMessagesDeleted failed');
      }
    },
    getDeletedInGroup(jid, limit = 100) {
      try {
        return stmts.deletedInGroup.all(jid, limit);
      } catch (e) {
        logger.warn({ err: e }, 'deletedInGroup failed');
        return [];
      }
    },

    updateMessageStatus(jid, messageId, status, _ts) {
      try {
        stmts.msgUpdateStatus.run(Number(status), jid, messageId);
      } catch (e) {
        logger.warn({ err: e }, 'msgUpdateStatus failed');
      }
    },

    async getSubscribers(service) {
      try {
        return stmts.getSubscribers.all(service).map((row) => ({
          jid: row.jid,
          last_seen_pulse_ts:
            row.last_seen_pulse_ts == null ? null : Number(row.last_seen_pulse_ts),
          meta: _parseMeta(row.meta),
        }));
      } catch {
        return [];
      }
    },
    async addSubscriber(service, jid, meta) {
      try {
        stmts.addSubscriber.run(service, jid, meta == null ? null : JSON.stringify(meta));
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'addSubscriber failed');
      }
    },
    async removeSubscriber(service, jid) {
      try {
        stmts.removeSubscriber.run(service, jid);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'removeSubscriber failed');
      }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try {
        stmts.updateSubscriberTs.run(ts, service, jid);
      } catch (e) {
        logger.warn({ err: e }, 'updateSubscriberTimestamp failed');
      }
    },
    async isSubscriber(service, jid) {
      try {
        return !!stmts.isSubscriber.get(service, jid);
      } catch {
        return false;
      }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const row = stmts.getSubscriberMeta.get(service, jid);
        if (!row) return null;
        return _parseMeta(row.meta);
      } catch {
        return null;
      }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        stmts.updateSubscriberMeta.run(meta == null ? null : JSON.stringify(meta), service, jid);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed');
      }
    },

    // ─── v1.12.0 — user leveling ──────────────────────────────────
    async getUserLevel(jid) {
      try {
        const row = stmts.levelGet.get(jid);
        return row ? { jid, xp: Number(row.xp) || 0, last_at: Number(row.last_at) || 0 } : null;
      } catch (e) {
        logger.debug({ err: e, jid }, 'getUserLevel failed');
        return null;
      }
    },
    async addUserXp(jid, amount) {
      const xp = Math.max(0, Math.floor(Number(amount) || 0));
      if (xp === 0) {
        const row = stmts.levelGetXp.get(jid);
        return row ? Number(row.xp) : 0;
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        stmts.levelUpsertAdd.run(jid, xp, now);
        const row = stmts.levelGetXp.get(jid);
        return row ? Number(row.xp) : xp;
      } catch (e) {
        logger.debug({ err: e, jid, amount }, 'addUserXp failed');
        return 0;
      }
    },

    // v1.16.0 — leaderboard: top N users by XP across all chats
    async getTopUsersByXp(limit = 10) {
      try {
        const cap = Math.max(1, Math.min(100, Number(limit) || 10));
        return stmts.levelTopByXp.all(cap).map((r) => ({
          jid: r.jid,
          xp: Number(r.xp) || 0,
          last_at: Number(r.last_at) || 0,
        }));
      } catch (e) {
        logger.debug({ err: e }, 'getTopUsersByXp failed');
        return [];
      }
    },
    async getActiveUsersSince(sinceSec, limit = 10) {
      try {
        const since = Math.floor(Number(sinceSec) || 0);
        const cap = Math.max(1, Math.min(100, Number(limit) || 10));
        return stmts.levelActiveSince.all(since, cap).map((r) => ({
          jid: r.jid,
          xp: Number(r.xp) || 0,
          last_at: Number(r.last_at) || 0,
        }));
      } catch (e) {
        logger.debug({ err: e, sinceSec }, 'getActiveUsersSince failed');
        return [];
      }
    },
    /**
     * Decay XP for users whose last_at is older than (now - graceSec).
     *
     *   weeksOver = (now - last_at - graceSec) / WEEK_SEC
     *   newXp    = floor(xp * (1 - ratePerWeek) ^ weeksOver)
     *
     * Returns number of rows actually changed.
     * Does NOT touch last_at (user is still inactive — visiting them
     * with a sweep doesn't make them active).
     */
    async applyXpDecay(graceSec, ratePerWeek) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const grace = Math.max(0, Math.floor(Number(graceSec) || 0));
        const rate = Math.max(0, Math.min(0.999, Number(ratePerWeek) || 0));
        const cutoff = now - grace;
        if (rate === 0) return 0;
        const candidates = stmts.levelDecayCandidates.all(cutoff);
        let affected = 0;
        const txn = db.transaction((rows) => {
          for (const r of rows) {
            const xp = Number(r.xp) || 0;
            const lastAt = Number(r.last_at) || 0;
            if (xp <= 0 || lastAt <= 0) continue;
            const weeksOver = (now - lastAt - grace) / (7 * 86400);
            if (weeksOver <= 0) continue;
            const factor = Math.pow(1 - rate, weeksOver);
            const newXp = Math.max(0, Math.floor(xp * factor));
            if (newXp < xp) {
              stmts.levelSetXp.run(newXp, r.jid);
              affected += 1;
            }
          }
        });
        txn(candidates);
        return affected;
      } catch (e) {
        logger.debug({ err: e, graceSec, ratePerWeek }, 'applyXpDecay failed');
        return 0;
      }
    },

    // v1.16.0 — most-changed-groups card on Overview
    async getMostChangedGroupsSince(sinceSec, limit = 5) {
      try {
        const since = Math.floor(Number(sinceSec) || 0);
        const cap = Math.max(1, Math.min(50, Number(limit) || 5));
        return stmts.gseMostChangedSince.all(since, cap).map((r) => ({
          jid: r.jid,
          count: Number(r.cnt) || 0,
        }));
      } catch (e) {
        logger.debug({ err: e, sinceSec }, 'getMostChangedGroupsSince failed');
        return [];
      }
    },

    // v1.16.0 — field-scoped settings history filter
    async getGroupSettingsHistoryByField(jid, field, limit = 200) {
      try {
        const cap = Math.max(1, Math.min(2000, Number(limit) || 200));
        return stmts.gseHistoryByField.all(jid, String(field), cap).map((r) => ({
          id: Number(r.id),
          field: r.field,
          old_value: r.old_value,
          new_value: r.new_value,
          actor: r.actor,
          ts: Number(r.ts),
        }));
      } catch (e) {
        logger.debug({ err: e, jid, field }, 'getGroupSettingsHistoryByField failed');
        return [];
      }
    },

    // v1.17.0 — admin audit log
    async recordAdminAudit(entry) {
      try {
        const ts = Math.floor(Number(entry?.ts) || Date.now() / 1000);
        const args = entry?.args == null ? null : String(entry.args).slice(0, 500);
        const result = stmts.auditInsert.run(
          ts,
          String(entry?.actor_jid || ''),
          entry?.chat_jid ? String(entry.chat_jid) : null,
          String(entry?.cmd_name || ''),
          entry?.prefix ? String(entry.prefix).slice(0, 8) : null,
          args,
          String(entry?.kind || 'admin'),
          String(entry?.outcome || 'success'),
          entry?.latency_ms == null ? null : Math.max(0, Math.floor(Number(entry.latency_ms) || 0)),
        );
        return Number(result.lastInsertRowid);
      } catch (e) {
        logger.debug({ err: e, entry }, 'recordAdminAudit failed');
        return null;
      }
    },
    async listAdminAudit(opts = {}) {
      try {
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
        const offset = Math.max(0, Math.min(100000, Number(opts.offset) || 0));
        const rows = stmts.auditList.all(sinceSec, limit, offset);
        return rows.map((r) => ({
          id: Number(r.id),
          ts: Number(r.ts),
          actor_jid: r.actor_jid,
          chat_jid: r.chat_jid,
          cmd_name: r.cmd_name,
          prefix: r.prefix,
          args: r.args,
          kind: r.kind,
          outcome: r.outcome,
          latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
        }));
      } catch (e) {
        logger.debug({ err: e, opts }, 'listAdminAudit failed');
        return [];
      }
    },
    async listAdminAuditByActor(actorJid, opts = {}) {
      try {
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
        return stmts.auditListByActor.all(actorJid, sinceSec, limit).map((r) => ({
          id: Number(r.id),
          ts: Number(r.ts),
          actor_jid: r.actor_jid,
          chat_jid: r.chat_jid,
          cmd_name: r.cmd_name,
          prefix: r.prefix,
          args: r.args,
          kind: r.kind,
          outcome: r.outcome,
          latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
        }));
      } catch (e) {
        logger.debug({ err: e, actorJid }, 'listAdminAuditByActor failed');
        return [];
      }
    },
    async listAdminAuditByCmd(cmdName, opts = {}) {
      try {
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
        return stmts.auditListByCmd.all(cmdName, sinceSec, limit).map((r) => ({
          id: Number(r.id),
          ts: Number(r.ts),
          actor_jid: r.actor_jid,
          chat_jid: r.chat_jid,
          cmd_name: r.cmd_name,
          prefix: r.prefix,
          args: r.args,
          kind: r.kind,
          outcome: r.outcome,
          latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
        }));
      } catch (e) {
        logger.debug({ err: e, cmdName }, 'listAdminAuditByCmd failed');
        return [];
      }
    },
    async pruneAdminAuditOlderThan(sinceSec) {
      try {
        const cutoff = Math.max(0, Math.floor(Number(sinceSec) || 0));
        const r = stmts.auditPrune.run(cutoff);
        return Number(r.changes) || 0;
      } catch (e) {
        logger.debug({ err: e, sinceSec }, 'pruneAdminAuditOlderThan failed');
        return 0;
      }
    },
    // v1.20.2 (M1): accepts the same filters as the list queries
    // ({sinceSec, actor, cmd}); no args = global count (back-compat).
    async countAdminAudit(opts = {}) {
      try {
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const actor = opts.actor ? String(opts.actor) : null;
        const cmd = opts.cmd ? String(opts.cmd) : null;
        let r;
        if (actor) r = stmts.auditCountByActor.get(actor, sinceSec);
        else if (cmd) r = stmts.auditCountByCmd.get(cmd, sinceSec);
        else if (sinceSec > 0) r = stmts.auditCountWindow.get(sinceSec);
        else r = stmts.auditRowCount.get();
        return r ? Number(r.n) || 0 : 0;
      } catch (e) {
        logger.debug({ err: e }, 'countAdminAudit failed');
        return 0;
      }
    },

    // ─── v1.21.0 generic change timeline (dashboard history views) ────
    /**
     * Append one change/event row to the timeline. `domain` is required
     * (presence, contact, chat, blocklist, label, newsletter, subscription,
     * ai, alert, xp, metric, connection, call, status, …); everything else
     * is optional. Returns the new row id or null.
     */
    async recordTimelineEvent(ev) {
      try {
        const domain = String(ev?.domain || '').trim();
        if (!domain) return null;
        const ts = Math.floor(Number(ev?.ts) || Date.now() / 1000);
        const s = (v, max) => (v == null ? null : String(v).slice(0, max));
        const result = stmts.timelineInsert.run(
          domain,
          s(ev?.entityId ?? ev?.entity_id, 255),
          s(ev?.field, 100),
          s(ev?.oldValue ?? ev?.old_value, 1000),
          s(ev?.newValue ?? ev?.new_value, 1000),
          s(ev?.actor, 255),
          s(ev?.source, 100),
          ts,
        );
        return Number(result.lastInsertRowid);
      } catch (e) {
        logger.debug({ err: e }, 'recordTimelineEvent failed');
        return null;
      }
    },
    /** Newest-first page of timeline rows. Filters: {domain, entityId, sinceSec, limit, offset}. */
    async getTimelineEvents(opts = {}) {
      try {
        const domain = String(opts.domain || '').trim();
        if (!domain) return [];
        const entityId = opts.entityId ?? opts.entity_id ?? null;
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const limit = Math.min(Math.max(1, Math.floor(Number(opts.limit) || 100)), 1000);
        const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
        const where = ['domain = ?'];
        const params = [domain];
        if (entityId) {
          where.push('entity_id = ?');
          params.push(String(entityId));
        }
        if (sinceSec > 0) {
          where.push('ts >= ?');
          params.push(sinceSec);
        }
        return db
          .prepare(
            `SELECT id, domain, entity_id, field, old_value, new_value, actor, source, ts
             FROM timeline_events WHERE ${where.join(' AND ')}
             ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`,
          )
          .all(...params, limit, offset);
      } catch (e) {
        logger.debug({ err: e }, 'getTimelineEvents failed');
        return [];
      }
    },
    // Filter-aware count (same filters as getTimelineEvents) — keeps
    // pagination math honest, the M1 lesson from /api/audit.
    async countTimelineEvents(opts = {}) {
      try {
        const domain = String(opts.domain || '').trim();
        if (!domain) return 0;
        const entityId = opts.entityId ?? opts.entity_id ?? null;
        const sinceSec = Math.max(0, Math.floor(Number(opts.sinceSec) || 0));
        const where = ['domain = ?'];
        const params = [domain];
        if (entityId) {
          where.push('entity_id = ?');
          params.push(String(entityId));
        }
        if (sinceSec > 0) {
          where.push('ts >= ?');
          params.push(sinceSec);
        }
        const r = db
          .prepare(`SELECT COUNT(*) AS n FROM timeline_events WHERE ${where.join(' AND ')}`)
          .get(...params);
        return r ? Number(r.n) || 0 : 0;
      } catch (e) {
        logger.debug({ err: e }, 'countTimelineEvents failed');
        return 0;
      }
    },

    // v1.13.0 — groups dashboard helper
    /**
     * Same data as getLastHumanMessageTs but for every chat in one query.
     * Returns a Map<jid, tsSeconds>. Used by GET /api/groups.
     */
    getLastHumanMessageTsMap() {
      try {
        const out = new Map();
        for (const r of stmts.lastHumanMsgTsAll.all()) {
          if (typeof r.ts === 'number') out.set(r.jid, r.ts);
        }
        return out;
      } catch (e) {
        logger.debug({ err: e }, 'getLastHumanMessageTsMap failed');
        return new Map();
      }
    },

    async getLastHumanMessageTs(jid) {
      try {
        const row = stmts.lastHumanMsgTs.get(jid);
        return row && typeof row.ts === 'number' ? row.ts : null;
      } catch (e) {
        logger.debug({ err: e, jid }, 'getLastHumanMessageTs failed');
        return null;
      }
    },

    // v1.14.0 — group settings event log
    async recordGroupSettingsChange(jid, field, oldValue, newValue, actor, ts) {
      try {
        stmts.gseInsert.run(
          jid,
          field,
          oldValue == null ? null : String(oldValue),
          newValue == null ? null : String(newValue),
          actor || null,
          Math.floor(Number(ts) || Date.now() / 1000),
        );
      } catch (e) {
        logger.debug({ err: e, jid, field }, 'recordGroupSettingsChange failed');
      }
    },
    async getGroupSettingsHistory(jid, limit = 200) {
      try {
        const cap = Math.max(1, Math.min(2000, Number(limit) || 200));
        return stmts.gseHistory.all(jid, cap).map((r) => ({
          id: Number(r.id),
          field: r.field,
          old_value: r.old_value,
          new_value: r.new_value,
          actor: r.actor,
          ts: Number(r.ts),
        }));
      } catch (e) {
        logger.debug({ err: e, jid }, 'getGroupSettingsHistory failed');
        return [];
      }
    },

    // v1.15.0 — persistent mutes
    async recordMute(chatJid, userJid, opts = {}) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const expires = Math.floor(Number(opts.expiresAt) || 0);
        const r = stmts.muteInsert.run(
          chatJid,
          userJid,
          now,
          expires,
          opts.byJid || null,
          opts.reason ? String(opts.reason).slice(0, 200) : null,
        );
        return Number(r.lastInsertRowid);
      } catch (e) {
        logger.debug({ err: e, chatJid, userJid }, 'recordMute failed');
        return null;
      }
    },
    async markMuteUnmuted(chatJid, userJid) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const r = stmts.muteMarkUnmuted.run(now, chatJid, userJid, now);
        return r.changes > 0;
      } catch (e) {
        logger.debug({ err: e, chatJid, userJid }, 'markMuteUnmuted failed');
        return false;
      }
    },
    async getActiveMutes() {
      try {
        const now = Math.floor(Date.now() / 1000);
        return stmts.muteActiveAll.all(now).map((r) => ({
          id: Number(r.id),
          chat_jid: r.chat_jid,
          user_jid: r.user_jid,
          created_at: Number(r.created_at),
          expires_at: Number(r.expires_at),
          by_jid: r.by_jid,
          reason: r.reason,
        }));
      } catch (e) {
        logger.debug({ err: e }, 'getActiveMutes failed');
        return [];
      }
    },
    async getMuteHistoryByChat(chatJid, limit = 100) {
      try {
        const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
        return stmts.muteHistoryByChat.all(chatJid, cap).map((r) => ({
          id: Number(r.id),
          chat_jid: r.chat_jid,
          user_jid: r.user_jid,
          created_at: Number(r.created_at),
          expires_at: Number(r.expires_at),
          by_jid: r.by_jid,
          reason: r.reason,
          unmuted_at: r.unmuted_at == null ? null : Number(r.unmuted_at),
        }));
      } catch (e) {
        logger.debug({ err: e, chatJid }, 'getMuteHistoryByChat failed');
        return [];
      }
    },
    async getMuteHistoryByUser(userJid, limit = 100) {
      try {
        const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
        return stmts.muteHistoryByUser.all(userJid, cap).map((r) => ({
          id: Number(r.id),
          chat_jid: r.chat_jid,
          user_jid: r.user_jid,
          created_at: Number(r.created_at),
          expires_at: Number(r.expires_at),
          by_jid: r.by_jid,
          reason: r.reason,
          unmuted_at: r.unmuted_at == null ? null : Number(r.unmuted_at),
        }));
      } catch (e) {
        logger.debug({ err: e, userJid }, 'getMuteHistoryByUser failed');
        return [];
      }
    },

    close() {
      db.close();
    },
  };
}

module.exports = { makeSQLiteStore };
