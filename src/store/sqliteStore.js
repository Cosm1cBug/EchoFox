/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

function _parseMeta(raw) {
  if (raw == null || raw === '') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

const Database = require('better-sqlite3');
const path     = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');
const { LRUCache } = require('lru-cache');
const { proto }    = require('@whiskeysockets/baileys');
const { config } = require('../lib/configLoader');
const { SQL_DDL: PARTICIPANTS_DDL } = require('./schema/participants');
const { SQL_DDL: STATS_DDL }        = require('./schema/stats');
const {
  SQL_DDL: EXTRAS_DDL,
  applyMessagesMigration_sqlite,
} = require('./schema/messages-extras');

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
  `);

  applyMessagesMigration_sqlite(db);

  try {
    const _ssCols = db.prepare(`PRAGMA table_info(service_subscribers)`).all().map((c) => c.name);
    if (!_ssCols.includes('meta')) {
      db.exec(`ALTER TABLE service_subscribers ADD COLUMN meta TEXT`);
    }
  } catch (e) { logger.warn({ err: e }, 'service_subscribers.meta column ensure failed'); }

  try {
    const _tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name);
    if (_tables.includes('thehackersnews_sent_articles') && !_tables.includes('service_sent_items')) {
      db.exec(`ALTER TABLE thehackersnews_sent_articles RENAME TO service_sent_items`);
      db.exec(`ALTER TABLE service_sent_items RENAME COLUMN article_url TO item_url`);
    }
  } catch (e) { logger.warn({ err: e }, 'service_sent_items rename guard failed'); }

  const stmts = {
    msgInsert: db.prepare(`INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts) VALUES (@jid,@id,@fromMe,@participant,@msg,@ts)`),
    msgGet:    db.prepare(`SELECT msg FROM messages WHERE jid = ? AND id = ?`),
    msgPrune:  db.prepare(`DELETE FROM messages WHERE ts < ?`),

    chatUpsert: db.prepare(`INSERT INTO chats (jid,name,unread,ts) VALUES (?,?,?,?) ON CONFLICT(jid) DO UPDATE SET name=excluded.name, unread=excluded.unread, ts=excluded.ts`),
    contactUpsert: db.prepare(`INSERT INTO contacts (jid,name,notify,img_url) VALUES (?,?,?,?) ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,name), notify=COALESCE(excluded.notify,notify), img_url=COALESCE(excluded.img_url,img_url)`),

    groupUpsert: db.prepare(`INSERT OR REPLACE INTO groups (jid,subject,creation,meta) VALUES (?,?,?,?)`),
    groupGet:   db.prepare(`SELECT meta FROM groups WHERE jid = ?`),
    groupCount: db.prepare(`SELECT COUNT(*) AS n FROM groups`),
    groupsList: db.prepare(`SELECT jid, subject, meta FROM groups ORDER BY subject COLLATE NOCASE`),

    statUpsert: db.prepare(`INSERT INTO stats (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`),
    statsAll:   db.prepare(`SELECT key, value FROM stats`),

    gaugeUpsert: db.prepare(`INSERT INTO stats_gauges (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
    gaugesAll:   db.prepare(`SELECT key, value FROM stats_gauges`),

    partInsert: db.prepare(`INSERT INTO group_participants_events (group_jid, participant, action, actor, ts) VALUES (?, ?, ?, ?, ?)`),
    partHistory: db.prepare(`SELECT participant, action, actor, ts FROM group_participants_events WHERE group_jid = ? ORDER BY ts DESC LIMIT ?`),
    partCurrent: db.prepare(`SELECT participant, MAX(ts) AS last_ts, (SELECT action FROM group_participants_events e2 WHERE e2.group_jid = e.group_jid AND e2.participant = e.participant ORDER BY ts DESC LIMIT 1) AS last_action FROM group_participants_events e WHERE group_jid = ? GROUP BY participant`),
    uniqueUsersCount: db.prepare(`SELECT COUNT(DISTINCT participant) AS n FROM group_participants_events`),

    getSubscribers: db.prepare(`SELECT jid, last_seen_pulse_ts, meta FROM service_subscribers WHERE service = ?`),
    addSubscriber: db.prepare(`INSERT OR IGNORE INTO service_subscribers (service, jid, last_seen_pulse_ts, meta) VALUES (?, ?, NULL, ?)`),
    removeSubscriber: db.prepare(`DELETE FROM service_subscribers WHERE service = ? AND jid = ?`),
    updateSubscriberTs: db.prepare(`UPDATE service_subscribers SET last_seen_pulse_ts = ? WHERE service = ? AND jid = ?`),
    isSubscriber: db.prepare(`SELECT 1 FROM service_subscribers WHERE service = ? AND jid = ? LIMIT 1`),
    getSubscriberMeta: db.prepare(`SELECT meta FROM service_subscribers WHERE service = ? AND jid = ?`),
    updateSubscriberMeta: db.prepare(`UPDATE service_subscribers SET meta = ? WHERE service = ? AND jid = ?`),

    hasSentItem: db.prepare(`SELECT 1 FROM service_sent_items WHERE service = ? AND jid = ? AND item_url = ?`),
    recordSentItem: db.prepare(`INSERT OR IGNORE INTO service_sent_items (service, jid, item_url, sent_at) VALUES (?, ?, ?, ?)`),

    editInsert: db.prepare(`INSERT INTO message_edits (jid, message_id, editor, old_body, new_body, ts) VALUES (?, ?, ?, ?, ?, ?)`),
    editsByMsg: db.prepare(`SELECT editor, old_body, new_body, ts FROM message_edits WHERE jid = ? AND message_id = ? ORDER BY ts ASC`),

    reactInsert: db.prepare(`INSERT INTO message_reactions (jid, message_id, reactor, emoji, ts) VALUES (?, ?, ?, ?, ?)`),
    reactionsByMsg: db.prepare(`SELECT reactor, emoji, ts FROM message_reactions WHERE jid = ? AND message_id = ? ORDER BY ts ASC`),

    receiptUpsert: db.prepare(`INSERT INTO message_receipts (jid, message_id, recipient, status, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jid, message_id, recipient) DO UPDATE SET status = MAX(status, excluded.status), ts = excluded.ts`),
    receiptsByMsg: db.prepare(`SELECT recipient, status, ts FROM message_receipts WHERE jid = ? AND message_id = ? ORDER BY ts ASC`),

    msgMarkDeletedExtra: db.prepare(`UPDATE messages SET deleted_at = ? WHERE jid = ? AND id = ? AND deleted_at IS NULL`),
    chatMarkAllDeleted: db.prepare(`UPDATE messages SET deleted_at = ? WHERE jid = ? AND deleted_at IS NULL`),
    msgUpdateBody: db.prepare(`UPDATE messages SET msg = ?, ts = ? WHERE jid = ? AND id = ?`),
    msgUpdateStatus: db.prepare(`UPDATE messages SET status = MAX(IFNULL(status,0), ?) WHERE jid = ? AND id = ?`),
    deletedInGroup: db.prepare(`SELECT id, participant, deleted_at FROM messages WHERE jid = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`),
  };

  const msgHot = new LRUCache({ max: 5_000, ttl: 1000 * 60 * 30 });

  const writeMessages = db.transaction((rows) => {
    for (const r of rows) stmts.msgInsert.run(r);
  });

  setInterval(() => {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); }
    catch (e) { logger.warn({ err: e }, 'store: wal_checkpoint failed'); }
  }, 60 * 60 * 1000).unref();

  setTimeout(() => {
    try { db.exec('VACUUM'); logger.info('store: weekly VACUUM ok'); }
    catch (e) { logger.warn({ err: e }, 'store: VACUUM failed'); }
    setInterval(() => {
      try { db.exec('VACUUM'); }
      catch (e) { logger.warn({ err: e }, 'store: VACUUM failed'); }
    }, 7 * 24 * 60 * 60 * 1000).unref();
  }, 30_000).unref();

  setInterval(() => {
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
      if (r.changes) logger.debug({ removed: r.changes, days }, 'store: pruned old messages (privacy)');
    } catch (e) { logger.warn({ err: e }, 'store: prune failed'); }
  }, 60 * 60 * 1000).unref();

  return {
    db,

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
      stmts.groupUpsert.run(jid, meta.subject ?? null, meta.creation ?? null, Buffer.from(JSON.stringify(meta), 'utf8'));
    },

    recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        stmts.partInsert.run(groupJid, participant, action, actor || null, ts ?? Math.floor(Date.now() / 1000));
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
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
            const result = stmts.partCurrent.all(groupJid).filter(
              (r) => r.last_action !== 'leave' && r.last_action !== 'kick' && r.last_action !== 'reject',
            );
            resolve(result);
          } catch (e) {
            logger.warn({ err: e }, 'current participants query failed');
            resolve([]);
          }
        });
      });
    },

    recordStat(key, inc = 1) {
      try { stmts.statUpsert.run(key, inc); }
      catch (e) { logger.warn({ err: e, key }, 'recordStat failed'); }
    },

    getStats() {
      try {
        return stmts.statsAll.all().reduce((acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    setGauge(key, value) {
      try {
        stmts.gaugeUpsert.run(key, value, Math.floor(Date.now() / 1000));
      } catch (e) { logger.warn({ err: e, key }, 'setGauge failed'); }
    },

    getGauges() {
      try {
        return stmts.gaugesAll.all().reduce((acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    async hasSentItem(service, jid, itemUrl) {
      try { return !!stmts.hasSentItem.get(service, jid, itemUrl); }
      catch (e) { logger.warn({ err: e }, 'hasSentItem failed'); return false; }
    },
    async recordSentItem(service, jid, itemUrl) {
      try {
        stmts.recordSentItem.run(service, jid, itemUrl, Math.floor(Date.now() / 1000));
      } catch (e) { logger.warn({ err: e }, 'recordSentItem failed'); }
    },

    async hasSentArticle(service, jid, articleUrl) { return this.hasSentItem(service, jid, articleUrl); },
    async recordSentArticle(service, jid, articleUrl) { return this.recordSentItem(service, jid, articleUrl); },

    countGroups() { 
      try { 
        return stmts.groupCount.get().n; 
      }       catch { return 0; } },
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
              try { meta = r.meta ? JSON.parse(r.meta.toString('utf8')) : null; } catch {}
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

    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded    = new Set(config.privacy?.excludeFromStore || []);
        const rows = [];
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          rows.push({
            jid: m.key.remoteJid,
            id:  m.key.id,
            fromMe: m.key.fromMe ? 1 : 0,
            participant: m.key.participant ?? null,
            msg: storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null,
            ts:  Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
          });
          if (storeBodies) msgHot.set(`${m.key.remoteJid}|${m.key.id}`, m.message);
        }
        if (rows.length) {
          try { writeMessages(rows); } catch (e) { logger.warn({ err: e }, 'store: msg write failed'); }
        }
      });

      ev.on('chats.upsert', (chats) => {
        const tx = db.transaction(() => {
          for (const c of chats) stmts.chatUpsert.run(c.id, c.name ?? null, Number(c.unreadCount) || 0, Number(c.conversationTimestamp) || Math.floor(Date.now() / 1000));
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: chats.upsert'); }
      });

      ev.on('contacts.upsert', (contacts) => {
        const tx = db.transaction(() => {
          for (const c of contacts) stmts.contactUpsert.run(c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null);
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: contacts.upsert'); }
      });

      ev.on('contacts.update', (updates) => {
        const tx = db.transaction(() => {
          for (const c of updates) stmts.contactUpsert.run(c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null);
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: contacts.update'); }
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    recordMessageEdit(jid, messageId, editor, oldBody, newBody, ts) {
      try {
        stmts.editInsert.run(jid, messageId, editor || null, oldBody || '', newBody || '', ts ?? Math.floor(Date.now()/1000));
      } catch (e) { logger.warn({err:e}, 'editInsert failed'); }
    },
    getMessageEdits(jid, messageId) {
      try { return stmts.editsByMsg.all(jid, messageId); }
      catch (e) { logger.warn({err:e}, 'editsByMsg failed'); return []; }
    },

    updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        stmts.msgUpdateBody.run(buf, ts ?? Math.floor(Date.now()/1000), jid, messageId);
      } catch (e) { logger.warn({err:e}, 'msgUpdateBody failed'); }
    },

    recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      try {
        stmts.reactInsert.run(jid, messageId, reactor || '', emoji || null, ts ?? Math.floor(Date.now()/1000));
      } catch (e) { logger.warn({err:e}, 'reactInsert failed'); }
    },
    getMessageReactions(jid, messageId) {
      try { return stmts.reactionsByMsg.all(jid, messageId); }
      catch (e) { logger.warn({err:e}, 'reactionsByMsg failed'); return []; }
    },

    recordReceipt(jid, messageId, recipient, status, ts) {
      try {
        stmts.receiptUpsert.run(jid, messageId, recipient, status, ts ?? Math.floor(Date.now()/1000));
      } catch (e) { logger.warn({err:e}, 'receiptUpsert failed'); }
    },
    getMessageReceipts(jid, messageId) {
      try { return stmts.receiptsByMsg.all(jid, messageId); }
      catch (e) { logger.warn({err:e}, 'receiptsByMsg failed'); return []; }
    },

    markMessageDeleted(jid, messageId, _by, ts) {
      try {
        stmts.msgMarkDeletedExtra.run(ts ?? Math.floor(Date.now()/1000), jid, messageId);
      } catch (e) { logger.warn({err:e}, 'markMessageDeleted failed'); }
    },
    markChatMessagesDeleted(jid, ts) {
      try {
        stmts.chatMarkAllDeleted.run(ts ?? Math.floor(Date.now()/1000), jid);
      } catch (e) { logger.warn({err:e}, 'markChatMessagesDeleted failed'); }
    },
    getDeletedInGroup(jid, limit = 100) {
      try { return stmts.deletedInGroup.all(jid, limit); }
      catch (e) { logger.warn({err:e}, 'deletedInGroup failed'); return []; }
    },

    updateMessageStatus(jid, messageId, status, _ts) {
      try { stmts.msgUpdateStatus.run(Number(status), jid, messageId); }
      catch (e) { logger.warn({err:e}, 'msgUpdateStatus failed'); }
    },

    async getSubscribers(service) {
      try {
        return stmts.getSubscribers.all(service).map((row) => ({
          jid: row.jid,
          last_seen_pulse_ts: row.last_seen_pulse_ts == null ? null : Number(row.last_seen_pulse_ts),
          meta: _parseMeta(row.meta),
        }));
      } catch { return []; }
    },
    async addSubscriber(service, jid, meta) {
      try {
        stmts.addSubscriber.run(service, jid, meta == null ? null : JSON.stringify(meta));
      } catch (e) { logger.warn({ err: e, service, jid }, 'addSubscriber failed'); }
    },
    async removeSubscriber(service, jid) {
      try { stmts.removeSubscriber.run(service, jid); }
      catch (e) { logger.warn({ err: e, service, jid }, 'removeSubscriber failed'); }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try { stmts.updateSubscriberTs.run(ts, service, jid); }
      catch (e) { logger.warn({ err: e }, 'updateSubscriberTimestamp failed'); }
    },
    async isSubscriber(service, jid) {
      try { return !!stmts.isSubscriber.get(service, jid); }
      catch { return false; }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const row = stmts.getSubscriberMeta.get(service, jid);
        if (!row) return null;
        return _parseMeta(row.meta);
      } catch { return null; }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        stmts.updateSubscriberMeta.run(meta == null ? null : JSON.stringify(meta), service, jid);
      } catch (e) { logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed'); }
    },

    close() { db.close(); },
  };
}

module.exports = { makeSQLiteStore };