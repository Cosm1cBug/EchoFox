'use strict';
/**
 * SQLite-backed Baileys store (re-written for Baileys 7.x).
 *
 * Why a custom store at all?
 *   • Baileys 7 removed `makeInMemoryStore`.
 *   • We want a *bounded* on-disk message buffer to satisfy
 *     `getMessage(key)` for retry decryption – this is the #1
 *     cause of "Waiting for this message" stuck chats.
 *
 * Design choices:
 *   • better-sqlite3 (sync, ~50× faster than node-sqlite3).
 *   • WAL + MEMORY temp-store + NORMAL synchronous → safe & fast.
 *   • Hot LRU on top of SQLite for `getMessage` lookups.
 *   • All writes batched with prepared statements & transactions.
 *   • Group metadata stored AND pushed into the in-memory LRU so the
 *     socket's `cachedGroupMetadata` hook never round-trips to disk.
 */

const Database = require('better-sqlite3');
const path = require('node:path');
const { existsSync, mkdirSync } = require('node:fs');
const { LRUCache } = require('lru-cache');
const { proto } = require('@whiskeysockets/baileys');

function makeSQLiteStore({ dbPath, logger, groupCache }) {
  const dir = path.dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');   // 256 MiB mmap → fewer reads
  db.pragma('cache_size = -64000');     // 64 MiB page cache
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      jid       TEXT NOT NULL,
      id        TEXT NOT NULL,
      from_me   INTEGER NOT NULL DEFAULT 0,
      participant TEXT,
      msg       BLOB,           -- proto-encoded WAMessage.Message
      ts        INTEGER NOT NULL,
      PRIMARY KEY (jid, id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);

    CREATE TABLE IF NOT EXISTS chats (
      jid       TEXT PRIMARY KEY,
      name      TEXT,
      unread    INTEGER DEFAULT 0,
      ts        INTEGER
    );

    CREATE TABLE IF NOT EXISTS contacts (
      jid       TEXT PRIMARY KEY,
      name      TEXT,
      notify    TEXT,
      img_url   TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      jid       TEXT PRIMARY KEY,
      subject   TEXT,
      creation  INTEGER,
      meta      BLOB             -- JSON-encoded full GroupMetadata
    );

    CREATE TABLE IF NOT EXISTS stats (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
  `);

  // ─── Prepared statements ────────────────────────────────────────────────
  const stmts = {
    msgInsert: db.prepare(`
      INSERT OR REPLACE INTO messages (jid,id,from_me,participant,msg,ts)
      VALUES (@jid,@id,@fromMe,@participant,@msg,@ts)`),
    msgGet: db.prepare(`SELECT msg FROM messages WHERE jid = ? AND id = ?`),
    msgPrune: db.prepare(`DELETE FROM messages WHERE ts < ?`),

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
    statUpsert: db.prepare(`
      INSERT INTO stats (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`),
    statsAll:   db.prepare(`SELECT key, value FROM stats`),
  };

  // Hot in-process LRU for getMessage – avoids SQLite hit for recent chats.
  const msgHot = new LRUCache({ max: 5_000, ttl: 1000 * 60 * 30 });

  // ─── Transactional bulk writes ──────────────────────────────────────────
  const writeMessages = db.transaction((rows) => {
    for (const r of rows) stmts.msgInsert.run(r);
  });

  // ─── Periodic prune (keep last 7 days of messages) ──────────────────────
  const PRUNE_AFTER_S = 60 * 60 * 24 * 7;
  setInterval(() => {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - PRUNE_AFTER_S;
      const r = stmts.msgPrune.run(cutoff);
      if (r.changes) logger.debug({ removed: r.changes }, 'store: pruned old messages');
    } catch (e) { logger.warn({ err: e }, 'store: prune failed'); }
  }, 60 * 60 * 1000).unref();

  // ─── Public API ─────────────────────────────────────────────────────────
  return {
    db,

    /** Satisfies Baileys `getMessage(key)` contract. */
    async getMessage(key) {
      const cacheKey = `${key.remoteJid}|${key.id}`;
      const hot = msgHot.get(cacheKey);
      if (hot) return hot;

      const row = stmts.msgGet.get(key.remoteJid, key.id);
      if (!row?.msg) return undefined;
      const decoded = proto.Message.decode(row.msg);
      msgHot.set(cacheKey, decoded);
      return decoded;
    },

    /** Satisfies Baileys `cachedGroupMetadata(jid)` contract. */
    async getGroupMetadata(jid) {
      // 1. memory
      const mem = groupCache.get(jid);
      if (mem) return mem;
      // 2. disk
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

    /**
     * Bind to a baileys EventEmitter. We only persist what we *need*
     * (messages for retry, contacts/chats for context, groups for caching).
     * Anything else stays in memory & is GC'd by Node.
     */
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
          // also seed the hot cache
          msgHot.set(`${m.key.remoteJid}|${m.key.id}`, m.message);
        }
        if (rows.length) {
          try { writeMessages(rows); }
          catch (e) { logger.warn({ err: e }, 'store: msg write failed'); }
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

      // Group metadata is fed both by direct `saveGroupMetadata` calls
      // (after a `groups.update` / `group-participants.update`) and by
      // the initial groups.upsert event.
      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },
    recordStat(key, inc = 1) {
      try { stmts.statUpsert.run(key, inc); } catch {}
    },

    getStats() {
      try {
        return stmts.statsAll.all().reduce(
          (acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },
    
    close() { db.close(); },
  };
}

module.exports = { makeSQLiteStore };
