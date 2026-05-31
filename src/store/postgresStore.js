/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('../lib/configLoader');
const { Pool } = require('pg');
const { proto } = require('@whiskeysockets/baileys');
const { SQL_DDL: PARTICIPANTS_DDL } = require('./schema/participants');
const { SQL_DDL: STATS_DDL }        = require('./schema/stats');
const {
  SQL_DDL: EXTRAS_DDL,
  applyMessagesMigration_postgres,
} = require('./schema/messages-extras');

function makePostgresStore(url, logger, groupCache) {
  const pool = new Pool({
    connectionString:        url,
    max:                     20,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 2_000,
    allowExitOnIdle:         false,
  });
  pool.on('error', (e) => logger.error({ err: e }, 'pg pool error (idle client)'));

  pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      jid TEXT, id TEXT, from_me BOOLEAN, participant TEXT,
      msg BYTEA, ts BIGINT, PRIMARY KEY (jid, id));
    CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts);
    CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages (jid, ts DESC);

    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY, name TEXT, unread INTEGER DEFAULT 0, ts BIGINT);

    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY, name TEXT, notify TEXT, img_url TEXT);
    CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);

    CREATE TABLE IF NOT EXISTS groups (
      jid TEXT PRIMARY KEY, subject TEXT, creation BIGINT, meta JSONB);
    CREATE INDEX IF NOT EXISTS idx_groups_subject ON groups (subject);

    ${STATS_DDL.postgres}
    ${PARTICIPANTS_DDL.postgres}
    ${EXTRAS_DDL.postgres}
  `).then(() => applyMessagesMigration_postgres(pool))
    .catch((e) => logger.error({ err: e }, 'Postgres init failed'));

  return {
    async getMessage(key) {
      const r = await pool.query(
        'SELECT msg FROM messages WHERE jid = $1 AND id = $2',
        [key.remoteJid, key.id],
      );
      if (!r.rows[0]) return undefined;
      return proto.Message.decode(r.rows[0].msg);
    },

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

    async listGroups() {
      try {
        const r = await pool.query(`SELECT jid, subject, meta FROM groups ORDER BY subject`);
        return r.rows.map((row) => ({
          jid:              row.jid,
          subject:          row.subject || row.meta?.subject || '(unnamed)',
          participantCount: row.meta?.participants?.length || 0,
        }));
      } catch { return []; }
    },

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

    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded    = new Set(config.privacy?.excludeFromStore || []);
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          const msgBuf = storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null;
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

    // ── Edits ──────────────────────────────────────────────────────────
    async recordMessageEdit(jid, messageId, editor, oldBody, newBody, ts) {
      try {
        await pool.query(
          `INSERT INTO message_edits (jid, message_id, editor, old_body, new_body, ts)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [jid, messageId, editor || null, oldBody || '', newBody || '',
           ts ?? Math.floor(Date.now()/1000)]);
      } catch (e) { logger.warn({err:e}, 'edit insert failed'); }
    },
    async getMessageEdits(jid, messageId) {
      try {
        const r = await pool.query(
          `SELECT editor, old_body, new_body, ts FROM message_edits
           WHERE jid = $1 AND message_id = $2 ORDER BY ts ASC`,
          [jid, messageId]);
        return r.rows;
      } catch (e) { logger.warn({err:e}, 'edits query failed'); return []; }
    },
    async updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        await pool.query(
          `UPDATE messages SET msg = $1, ts = $2 WHERE jid = $3 AND id = $4`,
          [buf, ts ?? Math.floor(Date.now()/1000), jid, messageId]);
      } catch (e) { logger.warn({err:e}, 'updateMessageBody failed'); }
    },

    // ── Reactions ──────────────────────────────────────────────────────
    async recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      try {
        await pool.query(
          `INSERT INTO message_reactions (jid, message_id, reactor, emoji, ts)
           VALUES ($1, $2, $3, $4, $5)`,
          [jid, messageId, reactor || '', emoji || null,
           ts ?? Math.floor(Date.now()/1000)]);
      } catch (e) { logger.warn({err:e}, 'reaction insert failed'); }
    },
    async getMessageReactions(jid, messageId) {
      try {
        const r = await pool.query(
          `SELECT reactor, emoji, ts FROM message_reactions
           WHERE jid = $1 AND message_id = $2 ORDER BY ts ASC`,
          [jid, messageId]);
        return r.rows;
      } catch (e) { logger.warn({err:e}, 'reactions query failed'); return []; }
    },

    // ── Receipts ───────────────────────────────────────────────────────
    async recordReceipt(jid, messageId, recipient, status, ts) {
      try {
        await pool.query(
          `INSERT INTO message_receipts (jid, message_id, recipient, status, ts)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (jid, message_id, recipient) DO UPDATE
             SET status = GREATEST(message_receipts.status, EXCLUDED.status),
                 ts = EXCLUDED.ts`,
          [jid, messageId, recipient, status, ts ?? Math.floor(Date.now()/1000)]);
      } catch (e) { logger.warn({err:e}, 'receipt upsert failed'); }
    },
    async getMessageReceipts(jid, messageId) {
      try {
        const r = await pool.query(
          `SELECT recipient, status, ts FROM message_receipts
           WHERE jid = $1 AND message_id = $2 ORDER BY ts ASC`,
          [jid, messageId]);
        return r.rows;
      } catch (e) { logger.warn({err:e}, 'receipts query failed'); return []; }
    },

    // ── Deletions ──────────────────────────────────────────────────────
    async markMessageDeleted(jid, messageId, _by, ts) {
      try {
        await pool.query(
          `UPDATE messages SET deleted_at = $1
           WHERE jid = $2 AND id = $3 AND deleted_at IS NULL`,
          [ts ?? Math.floor(Date.now()/1000), jid, messageId]);
      } catch (e) { logger.warn({err:e}, 'markMessageDeleted failed'); }
    },
    async markChatMessagesDeleted(jid, ts) {
      try {
        await pool.query(
          `UPDATE messages SET deleted_at = $1 WHERE jid = $2 AND deleted_at IS NULL`,
          [ts ?? Math.floor(Date.now()/1000), jid]);
      } catch (e) { logger.warn({err:e}, 'markChatMessagesDeleted failed'); }
    },
    async getDeletedInGroup(jid, limit = 100) {
      try {
        const r = await pool.query(
          `SELECT id, participant, deleted_at FROM messages
           WHERE jid = $1 AND deleted_at IS NOT NULL
           ORDER BY deleted_at DESC LIMIT $2`,
          [jid, limit]);
        return r.rows;
      } catch (e) { logger.warn({err:e}, 'deletedInGroup failed'); return []; }
    },

    // ── Aggregate status ───────────────────────────────────────────────
    async updateMessageStatus(jid, messageId, status, _ts) {
      try {
        await pool.query(
          `UPDATE messages SET status = GREATEST(COALESCE(status,0), $1)
           WHERE jid = $2 AND id = $3`,
          [Number(status), jid, messageId]);
      } catch (e) { logger.warn({err:e}, 'updateMessageStatus failed'); }
    },

    close() { pool.end(); },
  };
}

module.exports = { makePostgresStore };