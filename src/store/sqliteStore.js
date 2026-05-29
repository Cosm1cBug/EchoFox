/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * SQLite-backed Baileys store.
 *
 *   Tables:
 *     messages, chats, contacts, groups       — Baileys event mirror
 *     stats                                   — fixed counters (typed via metrics svc)
 *     stats_gauges                            — fixed gauges
 *     group_participants_events               — append-only participant log
 *
 *   Uniform store interface (also implemented by postgres/mongo/redis):
 *     getMessage(key)                         → proto.IMessage | undefined
 *     getGroupMetadata(jid)                   → GroupMetadata
 *     saveGroupMetadata(jid, meta)            → void
 *     recordParticipantEvent(group, p, action, actor, ts)
 *     getParticipantHistory(group, limit?)    → [{participant, action, actor, ts}]
 *     getCurrentParticipants(group)           → derived from latest events
 *     recordStat(key, inc=1)                  → counter (freeform escape hatch)
 *     setGauge(key, value)                    → gauge
 *     getStats()                              → { key: number, … }
 *     getGauges()                             → { key: number, … }
 *     bind(ev)                                — wire to baileys events
 *     close()
 */

const Database = require('better-sqlite3');
const path     = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');
const { LRUCache } = require('lru-cache');
const { proto }    = require('@whiskeysockets/baileys');

const { SQL_DDL: PARTICIPANTS_DDL } = require('./schema/participants');
const { SQL_DDL: STATS_DDL }        = require('./schema/stats');

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

    CREATE TABLE IF NOT EXISTS groups (
      jid      TEXT PRIMARY KEY,
      subject  TEXT,
      creation INTEGER,
      meta     BLOB
    );

    ${STATS_DDL.sqlite}
    ${PARTICIPANTS_DDL.sqlite}
  `);

  // ── Prepared statements ────────────────────────────────────────────────
  const stmts = {
    msgInsert: db.prepare(`
      INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts)
      VALUES (@jid,@id,@fromMe,@participant,@msg,@ts)`),
    msgGet:    db.prepare(`SELECT msg FROM messages WHERE jid = ? AND id = ?`),
    msgPrune:  db.prepare(`DELETE FROM messages WHERE ts < ?`),

    chatUpsert: db.prepare(`
      INSERT INTO chats (jid,name,unread,ts) VALUES (?,?,?,?)
      ON CONFLICT(jid) DO UPDATE SET name=excluded.name,
        unread=excluded.unread, ts=excluded.ts`),

    contactUpsert: db.prepare(`
      INSERT INTO contacts (jid,name,notify,img_url) VALUES (?,?,?,?)
      ON CONFLICT(jid) DO UPDATE SET name=COALESCE(excluded.name,name),
        notify=COALESCE(excluded.notify,notify),
        img_url=COALESCE(excluded.img_url,img_url)`),

    groupUpsert: db.prepare(`
      INSERT OR REPLACE INTO groups (jid,subject,creation,meta) VALUES (?,?,?,?)`),
    groupGet:   db.prepare(`SELECT meta FROM groups WHERE jid = ?`),
    groupCount: db.prepare(`SELECT COUNT(*) AS n FROM groups`),

    // Counters (stats table)
    statUpsert: db.prepare(`
      INSERT INTO stats (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`),
    statsAll:   db.prepare(`SELECT key, value FROM stats`),

    // Gauges (stats_gauges table)
    gaugeUpsert: db.prepare(`
      INSERT INTO stats_gauges (key,value,updated_at) VALUES (?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
    gaugesAll:   db.prepare(`SELECT key, value FROM stats_gauges`),

    // Participants
    partInsert: db.prepare(`
      INSERT INTO group_participants_events (group_jid, participant, action, actor, ts)
      VALUES (?, ?, ?, ?, ?)`),
    partHistory: db.prepare(`
      SELECT participant, action, actor, ts FROM group_participants_events
      WHERE group_jid = ? ORDER BY ts DESC LIMIT ?`),
    partCurrent: db.prepare(`
      SELECT participant,
             MAX(ts)  AS last_ts,
             (SELECT action FROM group_participants_events e2
              WHERE e2.group_jid = e.group_jid AND e2.participant = e.participant
              ORDER BY ts DESC LIMIT 1) AS last_action
      FROM group_participants_events e
      WHERE group_jid = ?
      GROUP BY participant`),
    uniqueUsersCount: db.prepare(`
      SELECT COUNT(DISTINCT participant) AS n FROM group_participants_events`),
  };

  const msgHot = new LRUCache({ max: 5_000, ttl: 1000 * 60 * 30 });

  const writeMessages = db.transaction((rows) => {
    for (const r of rows) stmts.msgInsert.run(r);
  });

  // Periodic prune (last 7 days)
  setInterval(() => {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
      const r = stmts.msgPrune.run(cutoff);
      if (r.changes) logger.debug({ removed: r.changes }, 'store: pruned old messages');
    } catch (e) { logger.warn({ err: e }, 'store: prune failed'); }
  }, 60 * 60 * 1000).unref();

  return {
    db,

    // ── Retry-decryption hook (Baileys getMessage) ──────────────────────
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

    // ── Group metadata cache ────────────────────────────────────────────
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
        jid, meta.subject ?? null, meta.creation ?? null,
        Buffer.from(JSON.stringify(meta), 'utf8'),
      );
    },

    // ── Participant event log ───────────────────────────────────────────
    recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        stmts.partInsert.run(
          groupJid, participant, action, actor || null,
          ts ?? Math.floor(Date.now() / 1000),
        );
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
    },

    getParticipantHistory(groupJid, limit = 500) {
      try { return stmts.partHistory.all(groupJid, limit); }
      catch (e) { logger.warn({ err: e }, 'participant history query failed'); return []; }
    },

    getCurrentParticipants(groupJid) {
      // "Current" = those whose latest event is not LEAVE or KICK
      try {
        return stmts.partCurrent.all(groupJid).filter(
          (r) => r.last_action !== 'leave' && r.last_action !== 'kick' && r.last_action !== 'reject',
        );
      } catch (e) {
        logger.warn({ err: e }, 'current participants query failed');
        return [];
      }
    },

    // ── Stats: counters (freeform escape hatch, used by typed metrics) ─
    recordStat(key, inc = 1) {
      try { stmts.statUpsert.run(key, inc); } catch (e) { logger.warn({ err: e, key }, 'recordStat failed'); }
    },

    getStats() {
      try {
        return stmts.statsAll.all().reduce(
          (acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    // ── Stats: gauges ───────────────────────────────────────────────────
    setGauge(key, value) {
      try {
        stmts.gaugeUpsert.run(key, value, Math.floor(Date.now() / 1000));
      } catch (e) { logger.warn({ err: e, key }, 'setGauge failed'); }
    },

    getGauges() {
      try {
        return stmts.gaugesAll.all().reduce(
          (acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    // ── Derived counts (used by metrics.refreshDerivedGauges) ───────────
    countGroups()       { try { return stmts.groupCount.get().n; }       catch { return 0; } },
    countUniqueUsers()  { try { return stmts.uniqueUsersCount.get().n; } catch { return 0; } },

    // ── Bind to Baileys events ──────────────────────────────────────────
    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        const rows = [];
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          rows.push({
            jid: m.key.remoteJid,
            id:  m.key.id,
            fromMe: m.key.fromMe ? 1 : 0,
            participant: m.key.participant ?? null,
            msg: Buffer.from(proto.Message.encode(m.message).finish()),
            ts:  Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
          });
          msgHot.set(`${m.key.remoteJid}|${m.key.id}`, m.message);
        }
        if (rows.length) {
          try { writeMessages(rows); } catch (e) { logger.warn({ err: e }, 'store: msg write failed'); }
        }
      });

      ev.on('chats.upsert', (chats) => {
        const tx = db.transaction(() => {
          for (const c of chats) stmts.chatUpsert.run(
            c.id, c.name ?? null,
            Number(c.unreadCount) || 0,
            Number(c.conversationTimestamp) || Math.floor(Date.now() / 1000),
          );
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: chats.upsert'); }
      });

      ev.on('contacts.upsert', (contacts) => {
        const tx = db.transaction(() => {
          for (const c of contacts) stmts.contactUpsert.run(
            c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null,
          );
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: contacts.upsert'); }
      });

      ev.on('contacts.update', (updates) => {
        const tx = db.transaction(() => {
          for (const c of updates) stmts.contactUpsert.run(
            c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null,
          );
        });
        try { tx(); } catch (e) { logger.warn({ err: e }, 'store: contacts.update'); }
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    close() { db.close(); },
  };
}

module.exports = { makeSQLiteStore };
