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

const { Pool } = require('pg');
const { proto } = require('@whiskeysockets/baileys');
const { SQL_DDL: PARTICIPANTS_DDL } = require('./schema/participants');
const { SQL_DDL: STATS_DDL }        = require('./schema/stats');

function makePostgresStore(url, logger, groupCache) {
  const pool = new Pool({ connectionString: url });

  // Schema init (fire-and-forget; logs on failure)
  pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      jid TEXT, id TEXT, from_me BOOLEAN, participant TEXT,
      msg BYTEA, ts BIGINT, PRIMARY KEY (jid, id));
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);

    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY, name TEXT, unread INTEGER DEFAULT 0, ts BIGINT);

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY, name TEXT, notify TEXT, img_url TEXT);

    CREATE TABLE IF NOT EXISTS groups (
      jid TEXT PRIMARY KEY, subject TEXT, creation BIGINT, meta JSONB);

    ${STATS_DDL.postgres}
    ${PARTICIPANTS_DDL.postgres}
  `).catch((e) => logger.error({ err: e }, 'Postgres init failed'));

  return {
    // ── Retry-decryption hook ──────────────────────────────────────────
    async getMessage(key) {
      const r = await pool.query(
        'SELECT msg FROM messages WHERE jid = $1 AND id = $2',
        [key.remoteJid, key.id],
      );
      if (!r.rows[0]) return undefined;
      return proto.Message.decode(r.rows[0].msg);
    },

    // ── Groups ─────────────────────────────────────────────────────────
    async getGroupMetadata(jid) {
      const mem = groupCache.get(jid);
      if (mem) return mem;
      const r = await pool.query('SELECT meta FROM groups WHERE jid = $1', [jid]);
      if (!r.rows[0]) return undefined;
      groupCache.set(jid, r.rows[0].meta);
      return r.rows[0].meta;
    },

    async saveGroupMetadata(jid, meta) {
      groupCache.set(jid, meta);
      await pool.query(
        `INSERT INTO groups (jid, subject, creation, meta) VALUES ($1, $2, $3, $4)
         ON CONFLICT (jid) DO UPDATE SET subject=EXCLUDED.subject,
           creation=EXCLUDED.creation, meta=EXCLUDED.meta`,
        [jid, meta.subject, meta.creation, meta],
      );
    },

    // ── Participants event-log ─────────────────────────────────────────
    async recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        await pool.query(
          `INSERT INTO group_participants_events (group_jid, participant, action, actor, ts)
           VALUES ($1, $2, $3, $4, $5)`,
          [groupJid, participant, action, actor || null,
           ts ?? Math.floor(Date.now() / 1000)],
        );
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        const r = await pool.query(
          `SELECT participant, action, actor, ts FROM group_participants_events
           WHERE group_jid = $1 ORDER BY ts DESC LIMIT $2`,
          [groupJid, limit],
        );
        return r.rows;
      } catch (e) { logger.warn({ err: e }, 'history query failed'); return []; }
    },

    async getCurrentParticipants(groupJid) {
      try {
        const r = await pool.query(
          `SELECT DISTINCT ON (participant) participant, action AS last_action, ts AS last_ts
           FROM group_participants_events
           WHERE group_jid = $1
           ORDER BY participant, ts DESC`,
          [groupJid],
        );
        return r.rows.filter(
          (row) => row.last_action !== 'leave' && row.last_action !== 'kick' && row.last_action !== 'reject',
        );
      } catch (e) { logger.warn({ err: e }, 'current participants query failed'); return []; }
    },

    // ── Stats: counters ────────────────────────────────────────────────
    recordStat(key, inc = 1) {
      pool.query(
        `INSERT INTO stats (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = stats.value + EXCLUDED.value`,
        [key, inc],
      ).catch((e) => logger.warn({ err: e, key }, 'recordStat failed'));
    },

    async getStats() {
      try {
        const r = await pool.query('SELECT key, value FROM stats');
        return r.rows.reduce((acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    // ── Stats: gauges ──────────────────────────────────────────────────
    setGauge(key, value) {
      pool.query(
        `INSERT INTO stats_gauges (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, value, Math.floor(Date.now() / 1000)],
      ).catch((e) => logger.warn({ err: e, key }, 'setGauge failed'));
    },

    async getGauges() {
      try {
        const r = await pool.query('SELECT key, value FROM stats_gauges');
        return r.rows.reduce((acc, row) => (acc[row.key] = Number(row.value), acc), {});
      } catch { return {}; }
    },

    // ── Derived counts ─────────────────────────────────────────────────
    async countGroups() {
      try { const r = await pool.query('SELECT COUNT(*) AS n FROM groups'); return Number(r.rows[0].n); }
      catch { return 0; }
    },

    async countUniqueUsers() {
      try {
        const r = await pool.query('SELECT COUNT(DISTINCT participant) AS n FROM group_participants_events');
        return Number(r.rows[0].n);
      } catch { return 0; }
    },

    // ── Bind to Baileys events ─────────────────────────────────────────
    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
          try {
            await pool.query(
              `INSERT INTO messages (jid, id, from_me, participant, msg, ts)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (jid, id) DO UPDATE SET msg = EXCLUDED.msg`,
              [m.key.remoteJid, m.key.id, !!m.key.fromMe,
               m.key.participant, msgBuf, Number(m.messageTimestamp)],
            );
          } catch { /* swallow per-row failures */ }
        }
      });

      ev.on('chats.upsert', async (chats) => {
        for (const c of chats) {
          try {
            await pool.query(
              `INSERT INTO chats (jid, name, unread, ts) VALUES ($1, $2, $3, $4)
               ON CONFLICT (jid) DO UPDATE SET name=EXCLUDED.name,
                 unread=EXCLUDED.unread, ts=EXCLUDED.ts`,
              [c.id, c.name ?? null, Number(c.unreadCount) || 0,
               Number(c.conversationTimestamp) || Math.floor(Date.now() / 1000)],
            );
          } catch {}
        }
      });

      ev.on('contacts.upsert', async (contacts) => {
        for (const c of contacts) {
          try {
            await pool.query(
              `INSERT INTO contacts (jid, name, notify, img_url) VALUES ($1, $2, $3, $4)
               ON CONFLICT (jid) DO UPDATE SET name=COALESCE(EXCLUDED.name,contacts.name),
                 notify=COALESCE(EXCLUDED.notify,contacts.notify),
                 img_url=COALESCE(EXCLUDED.img_url,contacts.img_url)`,
              [c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null],
            );
          } catch {}
        }
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    close() { pool.end(); },
  };
}

module.exports = { makePostgresStore };
