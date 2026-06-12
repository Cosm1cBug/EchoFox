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
const { makeBatcher } = require('../lib/backpressure');
const { SQL_DDL: STATS_DDL }        = require('./schema/stats');
const { SQL_DDL: EXTRAS_DDL, applyMessagesMigration_postgres } = require('./schema/messages-extras');

function makePostgresStore(url, logger, groupCache) {
  const pool = new Pool({
    connectionString:        url,
    max:                     20,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 2_000,
    allowExitOnIdle:         false,
  });
  pool.on('error', (e) => logger.error({ err: e }, 'pg pool error (idle client)'));

  const batchCfg = config.processing?.messageBatch || {};
  const messageBatcher = makeBatcher({
    name: 'pg-messages',
    maxBatch:      batchCfg.maxBatch      ?? 100,
    maxWaitMs:     batchCfg.maxWaitMs     ?? 250,
    maxBufferSize: batchCfg.maxBufferSize ?? 5_000,
    onDrop: (n) => logger.warn({ dropped: n }, 'pg message batcher overflow'),
    flush: async (rows) => {
      if (!rows.length) return;
      const params = [];
      const tuples = rows.map((r, i) => {
        const o = i * 6;
        params.push(r.jid, r.id, r.fromMe, r.participant, r.msg, r.ts);
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`;
      });
      try {
        await pool.query(
          `INSERT INTO messages (jid, id, from_me, participant, msg, ts)
           VALUES ${tuples.join(', ')}
           ON CONFLICT (jid, id) DO UPDATE SET msg = EXCLUDED.msg`,
          params,
        );
      } catch (e) {
        logger.warn({ err: e, rows: rows.length }, 'pg batched message insert failed');
      }
    },
  });

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

    CREATE TABLE IF NOT EXISTS service_subscribers (
      service TEXT NOT NULL,
      jid     TEXT NOT NULL,
      last_seen_pulse_ts BIGINT,
      meta    JSONB,
      PRIMARY KEY (service, jid)
    );

    ALTER TABLE service_subscribers ADD COLUMN IF NOT EXISTS meta JSONB;

    CREATE INDEX IF NOT EXISTS idx_service_subscribers_service
      ON service_subscribers (service);

    CREATE TABLE IF NOT EXISTS service_sent_items (
      service  TEXT NOT NULL,
      jid      TEXT NOT NULL,
      item_url TEXT NOT NULL,
      sent_at  BIGINT NOT NULL,
      PRIMARY KEY (service, jid, item_url)
    );
  `).then(() => applyMessagesMigration_postgres(pool))
    .catch((e) => logger.error({ err: e }, 'Postgres init failed'));

  return {
    async hasContact(jid) {
      try {
        const res = await this.pool.query(
          'SELECT 1 FROM contacts WHERE jid = $1 LIMIT 1',
          [jid]
        );
        return res.rowCount > 0;
      } catch (e) {
        logger.warn({ err: e, jid }, 'hasContact failed');
        return false;
      }
    },
    
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

    // labels ─────────────────────────────────────────
    async upsertLabel(labelId, name, color) {
      try {
        if (!labelId || !name) return;
        await pool.query(
          `INSERT INTO labels (label_id, name, color, deleted, updated_at)
           VALUES ($1, $2, $3, FALSE, $4)
           ON CONFLICT (label_id) DO UPDATE SET
             name = EXCLUDED.name,
             color = EXCLUDED.color,
             deleted = FALSE,
             updated_at = EXCLUDED.updated_at`,
          [labelId, name, color ?? null, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, labelId }, 'upsertLabel failed'); }
    },
    async deleteLabel(labelId) {
      try {
        await pool.query('UPDATE labels SET deleted = TRUE, updated_at = $1 WHERE label_id = $2', [Date.now(), labelId]);
      } catch (e) { logger.warn({ err: e, labelId }, 'deleteLabel failed'); }
    },
    async getLabel(labelId) {
      try {
        const { rows } = await pool.query(
          'SELECT label_id, name, color, deleted, updated_at FROM labels WHERE label_id = $1',
          [labelId],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, labelId }, 'getLabel failed'); return null; }
    },
    async listLabels() {
      try {
        const { rows } = await pool.query(
          'SELECT label_id, name, color, deleted, updated_at FROM labels WHERE deleted = FALSE ORDER BY name',
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'listLabels failed'); return []; }
    },
    async associateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        await pool.query(
          `INSERT INTO label_associations (label_id, target_type, target_jid, target_msg_id, associated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (label_id, target_type, target_jid, target_msg_id) DO NOTHING`,
          [labelId, targetType, targetJid, targetMsgId || '', Date.now()],
        );
      } catch (e) { logger.warn({ err: e, labelId, targetJid }, 'associateLabel failed'); }
    },
    async disassociateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        await pool.query(
          `DELETE FROM label_associations
           WHERE label_id = $1 AND target_type = $2 AND target_jid = $3
             AND COALESCE(target_msg_id, '') = COALESCE($4, '')`,
          [labelId, targetType, targetJid, targetMsgId || ''],
        );
      } catch (e) { logger.warn({ err: e, labelId, targetJid }, 'disassociateLabel failed'); }
    },
    async getLabelAssociations(labelId) {
      try {
        const { rows } = await pool.query(
          'SELECT label_id, target_type, target_jid, target_msg_id, associated_at FROM label_associations WHERE label_id = $1',
          [labelId],
        );
        return rows;
      } catch (e) { logger.warn({ err: e, labelId }, 'getLabelAssociations failed'); return []; }
    },
    async getLabelsForTarget(targetJid) {
      try {
        const { rows } = await pool.query(
          `SELECT la.label_id, l.name, l.color
           FROM label_associations la
           JOIN labels l ON la.label_id = l.label_id
           WHERE la.target_jid = $1 AND l.deleted = FALSE`,
          [targetJid],
        );
        return rows;
      } catch (e) { logger.warn({ err: e, targetJid }, 'getLabelsForTarget failed'); return []; }
    },

    // newsletters ────────────────────────────────────
    async upsertNewsletter(newsletterId, meta = {}) {
      try {
        if (!newsletterId) return;
        const ts = Date.now();
        const m = meta || {};
        await pool.query(
          `INSERT INTO newsletters (newsletter_id, name, description, picture_url, verification, subscribers, meta, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (newsletter_id) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, newsletters.name),
             description = COALESCE(EXCLUDED.description, newsletters.description),
             picture_url = COALESCE(EXCLUDED.picture_url, newsletters.picture_url),
             verification = COALESCE(EXCLUDED.verification, newsletters.verification),
             subscribers = COALESCE(EXCLUDED.subscribers, newsletters.subscribers),
             meta = COALESCE(EXCLUDED.meta, newsletters.meta),
             updated_at = EXCLUDED.updated_at`,
          [
            newsletterId,
            m.name ?? null,
            m.description ?? null,
            m.picture_url ?? m.pictureUrl ?? null,
            m.verification ?? null,
            m.subscribers ?? null,
            m.raw ? JSON.stringify(m.raw) : null,
            m.created_at ?? ts,
            ts,
          ],
        );
      } catch (e) { logger.warn({ err: e, newsletterId }, 'upsertNewsletter failed'); }
    },
    async updateNewsletter(newsletterId, partial = {}) {
      return this.upsertNewsletter(newsletterId, partial);
    },
    async getNewsletter(newsletterId) {
      try {
        const { rows } = await pool.query(
          'SELECT newsletter_id, name, description, picture_url, verification, subscribers, meta, created_at, updated_at FROM newsletters WHERE newsletter_id = $1',
          [newsletterId],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, newsletterId }, 'getNewsletter failed'); return null; }
    },
    async listNewsletters() {
      try {
        const { rows } = await pool.query(
          'SELECT newsletter_id, name, description, picture_url, verification, subscribers, created_at, updated_at FROM newsletters ORDER BY updated_at DESC',
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'listNewsletters failed'); return []; }
    },
    async incrementNewsletterView(newsletterId, messageId) {
      try {
        await pool.query(
          `INSERT INTO newsletter_views (newsletter_id, message_id, view_count, updated_at)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (newsletter_id, message_id) DO UPDATE SET
             view_count = newsletter_views.view_count + 1,
             updated_at = EXCLUDED.updated_at`,
          [newsletterId, messageId, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, newsletterId, messageId }, 'incrementNewsletterView failed'); }
    },
    async getNewsletterViews(newsletterId, messageId, limit = 100) {
      try {
        if (messageId) {
          const { rows } = await pool.query(
            'SELECT message_id, view_count, updated_at FROM newsletter_views WHERE newsletter_id = $1 AND message_id = $2',
            [newsletterId, messageId],
          );
          return rows;
        }
        const { rows } = await pool.query(
          'SELECT message_id, view_count, updated_at FROM newsletter_views WHERE newsletter_id = $1 ORDER BY updated_at DESC LIMIT $2',
          [newsletterId, limit],
        );
        return rows;
      } catch (e) { logger.warn({ err: e, newsletterId }, 'getNewsletterViews failed'); return []; }
    },
    async recordNewsletterReaction(newsletterId, messageId, emoji, count = 1) {
      try {
        await pool.query(
          'INSERT INTO newsletter_reactions (newsletter_id, message_id, emoji, count, recorded_at) VALUES ($1, $2, $3, $4, $5)',
          [newsletterId, messageId, emoji || null, count || 1, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, newsletterId, messageId }, 'recordNewsletterReaction failed'); }
    },
    async getNewsletterReactions(newsletterId, messageId) {
      try {
        const { rows } = await pool.query(
          `SELECT emoji, SUM(count)::int AS total, MAX(recorded_at) AS last_seen
           FROM newsletter_reactions
           WHERE newsletter_id = $1 AND message_id = $2
           GROUP BY emoji ORDER BY total DESC`,
          [newsletterId, messageId],
        );
        return rows;
      } catch (e) { logger.warn({ err: e, newsletterId, messageId }, 'getNewsletterReactions failed'); return []; }
    },
    async updateNewsletterSettings(newsletterId, settings = {}) {
      try {
        await pool.query(
          `INSERT INTO newsletter_settings (newsletter_id, settings_json, updated_at)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (newsletter_id) DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = EXCLUDED.updated_at`,
          [newsletterId, JSON.stringify(settings || {}), Date.now()],
        );
      } catch (e) { logger.warn({ err: e, newsletterId }, 'updateNewsletterSettings failed'); }
    },
    async getNewsletterSettings(newsletterId) {
      try {
        const { rows } = await pool.query(
          'SELECT settings_json AS settings, updated_at FROM newsletter_settings WHERE newsletter_id = $1',
          [newsletterId],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, newsletterId }, 'getNewsletterSettings failed'); return null; }
    },

    // lid-mapping ────────────────────────────────────
    async setLidMapping(lid, jid) {
      try {
        if (!lid || !jid) return;
        await pool.query(
          `INSERT INTO lid_mapping (lid, jid, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (lid) DO UPDATE SET jid = EXCLUDED.jid, updated_at = EXCLUDED.updated_at`,
          [lid, jid, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, lid, jid }, 'setLidMapping failed'); }
    },
    async getLidMapping(lid) {
      try {
        const { rows } = await pool.query('SELECT jid FROM lid_mapping WHERE lid = $1', [lid]);
        return rows[0]?.jid || null;
      } catch (e) { logger.warn({ err: e, lid }, 'getLidMapping failed'); return null; }
    },
    async getReverseLidMapping(jid) {
      try {
        const { rows } = await pool.query('SELECT lid FROM lid_mapping WHERE jid = $1', [jid]);
        return rows[0]?.lid || null;
      } catch (e) { logger.warn({ err: e, jid }, 'getReverseLidMapping failed'); return null; }
    },

    // message-capping ────────────────────────────────
    async setMessageCap(jid, capValue) {
      try {
        if (!jid || capValue == null) return;
        await pool.query(
          `INSERT INTO message_capping (jid, cap_value, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (jid) DO UPDATE SET cap_value = EXCLUDED.cap_value, updated_at = EXCLUDED.updated_at`,
          [jid, Number(capValue), Date.now()],
        );
      } catch (e) { logger.warn({ err: e, jid }, 'setMessageCap failed'); }
    },
    async getMessageCap(jid) {
      try {
        const { rows } = await pool.query(
          'SELECT cap_value, updated_at FROM message_capping WHERE jid = $1',
          [jid],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, jid }, 'getMessageCap failed'); return null; }
    },

    // blocklist ───────────────────────────────────────────────
    async setBlocklist(jids) {
      try {
        if (!Array.isArray(jids)) return;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM blocklist');
          const ts = Date.now();
          for (const j of jids) if (j) {
            await client.query(
              'INSERT INTO blocklist (jid, added_at) VALUES ($1, $2) ON CONFLICT (jid) DO NOTHING',
              [j, ts],
            );
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { client.release(); }
      } catch (e) { logger.warn({ err: e }, 'setBlocklist failed'); }
    },
    async addToBlocklist(jid) {
      try {
        await pool.query(
          'INSERT INTO blocklist (jid, added_at) VALUES ($1, $2) ON CONFLICT (jid) DO NOTHING',
          [jid, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, jid }, 'addToBlocklist failed'); }
    },
    async removeFromBlocklist(jid) {
      try { await pool.query('DELETE FROM blocklist WHERE jid = $1', [jid]); }
      catch (e) { logger.warn({ err: e, jid }, 'removeFromBlocklist failed'); }
    },
    async getBlocklist() {
      try {
        const { rows } = await pool.query('SELECT jid, added_at FROM blocklist ORDER BY added_at DESC');
        return rows;
      } catch (e) { logger.warn({ err: e }, 'getBlocklist failed'); return []; }
    },
    async isBlocked(jid) {
      try {
        const { rows } = await pool.query('SELECT 1 FROM blocklist WHERE jid = $1 LIMIT 1', [jid]);
        return rows.length > 0;
      } catch (e) { logger.warn({ err: e, jid }, 'isBlocked failed'); return false; }
    },

    // presence ────────────────────────────────────────────────
    async recordPresence(jid, state, lastSeenTs, chatJid) {
      try {
        await pool.query(
          `INSERT INTO presence (jid, last_state, last_seen_ts, chat_jid, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (jid) DO UPDATE SET
             last_state = EXCLUDED.last_state,
             last_seen_ts = COALESCE(EXCLUDED.last_seen_ts, presence.last_seen_ts),
             chat_jid = EXCLUDED.chat_jid,
             updated_at = EXCLUDED.updated_at`,
          [jid, state || null, lastSeenTs || null, chatJid || null, Date.now()],
        );
      } catch (e) { logger.warn({ err: e, jid }, 'recordPresence failed'); }
    },
    async getPresence(jid) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, last_state, last_seen_ts, chat_jid, updated_at FROM presence WHERE jid = $1',
          [jid],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, jid }, 'getPresence failed'); return null; }
    },
    async getPresenceInChat(chatJid) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, last_state, last_seen_ts, updated_at FROM presence WHERE chat_jid = $1 ORDER BY updated_at DESC',
          [chatJid],
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'getPresenceInChat failed'); return []; }
    },
    async getRecentPresence(limit = 50) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, last_state, last_seen_ts, chat_jid, updated_at FROM presence ORDER BY updated_at DESC LIMIT $1',
          [limit],
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'getRecentPresence failed'); return []; }
    },

    // chat state ──────────────────────────────────────────────
    async updateChat(jid, partial) {
      try {
        if (!jid) return;
        const { name, unread, ts, pinned, muted_until, archived } = partial || {};
        await pool.query(
          `UPDATE chats SET
             name = COALESCE($2, name),
             unread = COALESCE($3, unread),
             ts = COALESCE($4, ts),
             pinned = COALESCE($5, pinned),
             muted_until = COALESCE($6, muted_until),
             archived = COALESCE($7, archived)
           WHERE jid = $1`,
          [
            jid,
            name ?? null,
            unread ?? null,
            ts ?? null,
            pinned == null ? null : (pinned ? 1 : 0),
            muted_until ?? null,
            archived == null ? null : (archived ? 1 : 0),
          ],
        );
      } catch (e) { logger.warn({ err: e, jid }, 'updateChat failed'); }
    },
    async markChatDeleted(jid) {
      try { await pool.query('UPDATE chats SET deleted_at = $1 WHERE jid = $2', [Date.now(), jid]); }
      catch (e) { logger.warn({ err: e, jid }, 'markChatDeleted failed'); }
    },
    async listChats() {
      try {
        const { rows } = await pool.query(
          'SELECT jid, name, unread, ts, pinned, muted_until, archived, deleted_at FROM chats ORDER BY ts DESC NULLS LAST',
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'listChats failed'); return []; }
    },
    async getChat(jid) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, name, unread, ts, pinned, muted_until, archived, deleted_at FROM chats WHERE jid = $1',
          [jid],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, jid }, 'getChat failed'); return null; }
    },

    // contacts (bulk + extended) ─────────────────────────────
    async bulkUpsertContacts(contacts) {
      try {
        if (!Array.isArray(contacts) || !contacts.length) return 0;
        const client = await pool.connect();
        let n = 0;
        try {
          await client.query('BEGIN');
          for (const c of contacts) {
            if (!c?.id) continue;
            await client.query(
              `INSERT INTO contacts (jid, name, notify, img_url, status, verified_name)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (jid) DO UPDATE SET
                 name = COALESCE(EXCLUDED.name, contacts.name),
                 notify = COALESCE(EXCLUDED.notify, contacts.notify),
                 img_url = COALESCE(EXCLUDED.img_url, contacts.img_url),
                 status = COALESCE(EXCLUDED.status, contacts.status),
                 verified_name = COALESCE(EXCLUDED.verified_name, contacts.verified_name)`,
              [c.id, c.name ?? null, c.notify ?? null, c.imgUrl ?? null, c.status ?? null, c.verifiedName ?? null],
            );
            n++;
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally { client.release(); }
        return n;
      } catch (e) { logger.warn({ err: e }, 'bulkUpsertContacts failed'); return 0; }
    },
    async getContact(jid) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, name, notify, img_url, status, verified_name FROM contacts WHERE jid = $1',
          [jid],
        );
        return rows[0] || null;
      } catch (e) { logger.warn({ err: e, jid }, 'getContact failed'); return null; }
    },
    async listContacts({ limit = 100, offset = 0 } = {}) {
      try {
        const { rows } = await pool.query(
          'SELECT jid, name, notify, img_url, status, verified_name FROM contacts ORDER BY COALESCE(name, notify, jid) LIMIT $1 OFFSET $2',
          [limit, offset],
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'listContacts failed'); return []; }
    },
    async countContacts() {
      try {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM contacts');
        return rows[0]?.n || 0;
      } catch (e) { logger.warn({ err: e }, 'countContacts failed'); return 0; }
    },

    // v1.2.0 AI ──────────────────────────────────────────────
    async appendAiTurn(chatJid, turn) {
      try {
        await pool.query(
          `INSERT INTO ai_conversations
            (chat_jid, role, content, tool_name, tool_args, tool_id, model, provider, prompt_tokens, completion_tokens, ts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            chatJid,
            String(turn.role || ''),
            String(turn.content == null ? '' : turn.content),
            turn.toolName || null,
            turn.toolArgs ? (typeof turn.toolArgs === 'string' ? turn.toolArgs : JSON.stringify(turn.toolArgs)) : null,
            turn.toolId || null,
            turn.model || null,
            turn.provider || null,
            Number(turn.promptTokens || 0),
            Number(turn.completionTokens || 0),
            Number(turn.ts || Date.now()),
          ],
        );
        return true;
      } catch (e) { logger.warn({ err: e, chatJid }, 'appendAiTurn failed'); return false; }
    },
    async getRecentAiTurns(chatJid, limit = 20) {
      try {
        const { rows } = await pool.query(
          `SELECT role, content, tool_name, tool_args, tool_id, model, provider,
                  prompt_tokens, completion_tokens, ts
           FROM ai_conversations WHERE chat_jid = $1 ORDER BY id DESC LIMIT $2`,
          [chatJid, Number(limit) || 20],
        );
        return rows.reverse().map((r) => ({
          role:     r.role,
          content:  r.content,
          toolName: r.tool_name || undefined,
          toolArgs: r.tool_args || undefined,
          toolId:   r.tool_id   || undefined,
          model:    r.model     || undefined,
          provider: r.provider  || undefined,
          promptTokens:     r.prompt_tokens     || 0,
          completionTokens: r.completion_tokens || 0,
          ts:       Number(r.ts),
        }));
      } catch (e) { logger.warn({ err: e, chatJid }, 'getRecentAiTurns failed'); return []; }
    },
    async clearAiTurns(chatJid) {
      try { await pool.query(`DELETE FROM ai_conversations WHERE chat_jid = $1`, [chatJid]); return true; }
      catch (e) { logger.warn({ err: e, chatJid }, 'clearAiTurns failed'); return false; }
    },

    async recordAiUsage({ day, provider, model, promptTokens = 0, completionTokens = 0, costUsd = 0 }) {
      try {
        await pool.query(
          `INSERT INTO ai_usage_daily (day, provider, model, prompt_tokens, completion_tokens, cost_usd, calls)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (day, provider, model) DO UPDATE SET
             prompt_tokens = ai_usage_daily.prompt_tokens + EXCLUDED.prompt_tokens,
             completion_tokens = ai_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
             cost_usd = ai_usage_daily.cost_usd + EXCLUDED.cost_usd,
             calls    = ai_usage_daily.calls + 1`,
          [String(day), String(provider || ''), String(model || ''),
           Number(promptTokens) || 0, Number(completionTokens) || 0, Number(costUsd) || 0],
        );
        return true;
      } catch (e) { logger.warn({ err: e }, 'recordAiUsage failed'); return false; }
    },
    async getAiUsageDayTotal(day) {
      try {
        const { rows } = await pool.query(
          `SELECT COALESCE(SUM(cost_usd), 0)::float AS total FROM ai_usage_daily WHERE day = $1`,
          [String(day)],
        );
        return Number(rows[0]?.total || 0);
      } catch (e) { logger.warn({ err: e }, 'getAiUsageDayTotal failed'); return 0; }
    },
    async getAiUsageSince(day) {
      try {
        const { rows } = await pool.query(
          `SELECT day, provider, model, prompt_tokens, completion_tokens, cost_usd::float AS cost_usd, calls
           FROM ai_usage_daily WHERE day >= $1 ORDER BY day DESC, cost_usd DESC`,
          [String(day)],
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'getAiUsageSince failed'); return []; }
    },
    async getAiUsageByDay(limit = 30) {
      try {
        const { rows } = await pool.query(
          `SELECT day,
                  SUM(cost_usd)::float AS cost_usd,
                  SUM(prompt_tokens)::int  AS prompt_tokens,
                  SUM(completion_tokens)::int AS completion_tokens,
                  SUM(calls)::int AS calls
           FROM ai_usage_daily GROUP BY day ORDER BY day DESC LIMIT $1`,
          [Number(limit) || 30],
        );
        return rows;
      } catch (e) { logger.warn({ err: e }, 'getAiUsageByDay failed'); return []; }
    },

    async setAiChatOptIn(chatJid, { enabled = false, persona = null, provider = null, model = null } = {}) {
      try {
        const overrides = { persona, provider, model };
        await pool.query(
          `INSERT INTO ai_chat_opt_in (chat_jid, enabled, overrides, updated_at)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (chat_jid) DO UPDATE SET
             enabled = EXCLUDED.enabled,
             overrides = EXCLUDED.overrides,
             updated_at = EXCLUDED.updated_at`,
          [chatJid, !!enabled, JSON.stringify(overrides), Date.now()],
        );
        return true;
      } catch (e) { logger.warn({ err: e, chatJid }, 'setAiChatOptIn failed'); return false; }
    },
    async getAiChatOptIn(chatJid) {
      try {
        const { rows } = await pool.query(
          `SELECT enabled, overrides, updated_at FROM ai_chat_opt_in WHERE chat_jid = $1`,
          [chatJid],
        );
        if (!rows[0]) return null;
        const o = rows[0].overrides || {};
        return {
          enabled:  !!rows[0].enabled,
          persona:  o.persona  ?? null,
          provider: o.provider ?? null,
          model:    o.model    ?? null,
          updatedAt: Number(rows[0].updated_at),
        };
      } catch (e) { logger.warn({ err: e, chatJid }, 'getAiChatOptIn failed'); return null; }
    },
    async listAiOptedInChats(limit = 100) {
      try {
        const { rows } = await pool.query(
          `SELECT chat_jid, enabled, overrides, updated_at
           FROM ai_chat_opt_in ORDER BY updated_at DESC LIMIT $1`,
          [Number(limit) || 100],
        );
        return rows.map((r) => {
          const o = r.overrides || {};
          return {
            chatJid:   r.chat_jid,
            enabled:   !!r.enabled,
            persona:   o.persona  ?? null,
            provider:  o.provider ?? null,
            model:     o.model    ?? null,
            updatedAt: Number(r.updated_at),
          };
        });
      } catch (e) { logger.warn({ err: e }, 'listAiOptedInChats failed'); return []; }
    },

    // v1.3.0 AI persistent rate-limit ────────────────────────
    async incrAiRateUser(userJid, hourBucket) {
      try {
        const exp = (Number(hourBucket) + 2) * 60 * 60 * 1000;
        const { rows } = await pool.query(
          `INSERT INTO ai_rate_user (user_jid, hour_bucket, count, expires_at)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (user_jid, hour_bucket) DO UPDATE SET count = ai_rate_user.count + 1
           RETURNING count`,
          [String(userJid), Number(hourBucket), exp],
        );
        return Number(rows[0]?.count || 0);
      } catch (e) { logger.warn({ err: e, userJid }, 'incrAiRateUser failed'); return 0; }
    },
    async getAiRateUser(userJid, hourBucket) {
      try {
        const { rows } = await pool.query(
          `SELECT count FROM ai_rate_user WHERE user_jid = $1 AND hour_bucket = $2`,
          [String(userJid), Number(hourBucket)],
        );
        return Number(rows[0]?.count || 0);
      } catch (e) { logger.warn({ err: e, userJid }, 'getAiRateUser failed'); return 0; }
    },
    async incrAiRateChat(chatJid, dayBucket) {
      try {
        const exp = (Number(dayBucket) + 2) * 24 * 60 * 60 * 1000;
        const { rows } = await pool.query(
          `INSERT INTO ai_rate_chat (chat_jid, day_bucket, count, expires_at)
           VALUES ($1, $2, 1, $3)
           ON CONFLICT (chat_jid, day_bucket) DO UPDATE SET count = ai_rate_chat.count + 1
           RETURNING count`,
          [String(chatJid), Number(dayBucket), exp],
        );
        return Number(rows[0]?.count || 0);
      } catch (e) { logger.warn({ err: e, chatJid }, 'incrAiRateChat failed'); return 0; }
    },
    async getAiRateChat(chatJid, dayBucket) {
      try {
        const { rows } = await pool.query(
          `SELECT count FROM ai_rate_chat WHERE chat_jid = $1 AND day_bucket = $2`,
          [String(chatJid), Number(dayBucket)],
        );
        return Number(rows[0]?.count || 0);
      } catch (e) { logger.warn({ err: e, chatJid }, 'getAiRateChat failed'); return 0; }
    },
    async pruneAiRate(now = Date.now()) {
      try {
        const a = await pool.query(`DELETE FROM ai_rate_user WHERE expires_at < $1`, [Number(now)]);
        const b = await pool.query(`DELETE FROM ai_rate_chat WHERE expires_at < $1`, [Number(now)]);
        return { users: a.rowCount || 0, chats: b.rowCount || 0 };
      } catch (e) { logger.warn({ err: e }, 'pruneAiRate failed'); return { users: 0, chats: 0 }; }
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
      ev.on('messages.upsert', ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded    = new Set(config.privacy?.excludeFromStore || []);
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          messageBatcher.push({
            jid: m.key.remoteJid,
            id: m.key.id,
            fromMe: !!m.key.fromMe,
            participant: m.key.participant,
            msg: storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null,
            ts: Number(m.messageTimestamp),
          });
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

    async getSubscribers(service) {
      try {
        const r = await pool.query(
          'SELECT jid, last_seen_pulse_ts, meta FROM service_subscribers WHERE service = $1',
          [service]);
        return r.rows.map((row) => ({
          jid: row.jid,
          last_seen_pulse_ts: row.last_seen_pulse_ts == null
            ? null : Number(row.last_seen_pulse_ts),
          meta: row.meta || null,
        }));
      } catch (e) { logger.warn({ err: e, service }, 'getSubscribers failed'); return []; }
    },
    async addSubscriber(service, jid, meta) {
      try {
        await pool.query(
          `INSERT INTO service_subscribers (service, jid, last_seen_pulse_ts, meta)
           VALUES ($1, $2, NULL, $3)
           ON CONFLICT (service, jid) DO NOTHING`,
          [service, jid, meta == null ? null : meta]);
      } catch (e) { logger.warn({ err: e, service, jid }, 'addSubscriber failed'); }
    },
    async removeSubscriber(service, jid) {
      try {
        await pool.query(
          'DELETE FROM service_subscribers WHERE service = $1 AND jid = $2',
          [service, jid]);
      } catch (e) { logger.warn({ err: e, service, jid }, 'removeSubscriber failed'); }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try {
        await pool.query(
          `UPDATE service_subscribers SET last_seen_pulse_ts = $1
           WHERE service = $2 AND jid = $3`,
          [ts, service, jid]);
      } catch (e) { logger.warn({ err: e }, 'updateSubscriberTimestamp failed'); }
    },
        async isSubscriber(service, jid) {
      try {
        const r = await pool.query(
          'SELECT 1 FROM service_subscribers WHERE service = $1 AND jid = $2 LIMIT 1',
          [service, jid]);
        return r.rowCount > 0;
      } catch { return false; }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const r = await pool.query(
          'SELECT meta FROM service_subscribers WHERE service = $1 AND jid = $2',
          [service, jid]);
        if (r.rowCount === 0) return null;
        return r.rows[0].meta || null;
      } catch { return null; }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        await pool.query(
          'UPDATE service_subscribers SET meta = $1 WHERE service = $2 AND jid = $3',
          [meta == null ? null : meta, service, jid]);
      } catch (e) { logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed'); }
    },
    async hasSentItem(service, jid, itemUrl) {
      try {
        const r = await pool.query(
          `SELECT 1 FROM service_sent_items
           WHERE service = $1 AND jid = $2 AND item_url = $3 LIMIT 1`,
          [service, jid, itemUrl]);
        return r.rowCount > 0;
      } catch { return false; }
    },
    async recordSentItem(service, jid, itemUrl) {
      try {
        await pool.query(
          `INSERT INTO service_sent_items (service, jid, item_url, sent_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (service, jid, item_url) DO NOTHING`,
          [service, jid, itemUrl, Math.floor(Date.now() / 1000)]);
      } catch (e) { logger.warn({ err: e, service, jid }, 'recordSentItem failed'); }
    },

    async hasSentArticle(service, jid, articleUrl) { return this.hasSentItem(service, jid, articleUrl); },
    async recordSentArticle(service, jid, articleUrl) { return this.recordSentItem(service, jid, articleUrl); },

    pool,
    async close() {
      try { 
        await messageBatcher.drain(); 
      }
      catch (e) { 
        logger.warn({ err: e }, 'pg batcher drain failed'); 
      }
      pool.end();
    },
  };
}

module.exports = { makePostgresStore };