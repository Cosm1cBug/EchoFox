/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Redis store.
 *
 *   Key conventions:
 *     msg:<jid>:<id>                  Buffer (proto-encoded Message), TTL configurable
 *     group:<jid>                     JSON GroupMetadata
 *     groups                          SET of all group JIDs (for counts)
 *     gpe:<groupJid>                  ZSET, score=ts, member=JSON event
 *     gpe:users                       SET of all participants ever seen
 *     stat:<key>                      Integer counter
 *     gauge:<key>                     Hash { value, updated_at }
 *     edits:<jid>:<msgId>             ZSET, score=ts, member=JSON edit
 *     reactions:<jid>:<msgId>         ZSET, score=ts, member=JSON reaction
 *     receipts:<jid>:<msgId>          HASH { recipient -> "status|ts" }
 *     deleted:<jid>                   HASH { messageId -> deleted_at_ts }
 *     chat-deleted:<jid>              String (ts of full-chat delete)
 *     msg-status:<jid>                HASH { messageId -> aggregate_status }
 *
 * Privacy (v0.4.4):
 *   • config.privacy.storeMessageBodies = false → message body writes skipped
 *   • config.privacy.excludeFromStore[]        → those chats never persisted
 *   • config.privacy.messageBodyRetentionDays  → overrides default 7d TTL
 */

const { config } = require('../lib/configLoader');
const Redis      = require('ioredis');
const { proto }  = require('@whiskeysockets/baileys');

const MSG_TTL = 604800;   // 7 days default

function makeRedisStore(url, logger, groupCache) {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck:     true,
    retryStrategy: (times) => Math.min(times * 200, 5000),
    reconnectOnError: (err) => {
      // Auto-reconnect on transient errors (READONLY, network drop, etc.)
      const m = err && err.message;
      if (m && (m.includes('READONLY') || m.includes('ECONNRESET'))) return 2;
      return false;
    },
  });
  client.on('error', (e) => logger.error({ err: e }, 'redis client error'));

  return {
    async getMessage(key) {
      const buf = await client.getBuffer(`msg:${key.remoteJid}:${key.id}`);
      return buf ? proto.Message.decode(buf) : undefined;
    },

    async getGroupMetadata(jid) {
      const mem = groupCache.get(jid);
      if (mem) return mem;
      const str = await client.get(`group:${jid}`);
      if (!str) return undefined;
      const meta = JSON.parse(str);
      groupCache.set(jid, meta);
      return meta;
    },

    async saveGroupMetadata(jid, meta) {
      groupCache.set(jid, meta);
      const p = client.pipeline();
      p.set(`group:${jid}`, JSON.stringify(meta));
      p.sadd('groups', jid);
      await p.exec();
    },

    async recordParticipantEvent(groupJid, participant, action, actor, ts) {
      const tsEff = ts ?? Math.floor(Date.now() / 1000);
      const ev = JSON.stringify({ participant, action, actor: actor || null, ts: tsEff });
      try {
        const p = client.pipeline();
        p.zadd(`gpe:${groupJid}`, tsEff, ev);
        p.sadd('gpe:users', participant);
        await p.exec();
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        const raw = await client.zrevrange(`gpe:${groupJid}`, 0, limit - 1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) { logger.warn({ err: e }, 'history query failed'); return []; }
    },

    async getCurrentParticipants(groupJid) {
      try {
        const raw = await client.zrevrange(`gpe:${groupJid}`, 0, -1);
        const seen = new Map();
        for (const s of raw) {
          const ev = JSON.parse(s);
          if (!seen.has(ev.participant)) seen.set(ev.participant, ev);
        }
        const out = [];
        for (const [participant, ev] of seen) {
          if (ev.action === 'leave' || ev.action === 'kick' || ev.action === 'reject') continue;
          out.push({ participant, last_action: ev.action, last_ts: ev.ts });
        }
        return out;
      } catch (e) { logger.warn({ err: e }, 'current participants query failed'); return []; }
    },

    async listGroups() {
      try {
        const jids = await client.smembers('groups');
        const out = [];
        for (const jid of jids) {
          const str = await client.get(`group:${jid}`);
          if (!str) continue;
          let meta;
          try { meta = JSON.parse(str); } catch { continue; }
          out.push({
            jid,
            subject:          meta?.subject || '(unnamed)',
            participantCount: meta?.participants?.length || 0,
          });
        }
        return out.sort((a, b) => a.subject.localeCompare(b.subject));
      } catch { return []; }
    },

    recordStat(key, inc = 1) {
      client.incrby(`stat:${key}`, inc).catch((e) =>
        logger.warn({ err: e, key }, 'recordStat failed'));
    },

    async getStats() {
      try {
        const keys = await client.keys('stat:*');
        const stats = {};
        if (keys.length) {
          const values = await client.mget(keys);
          keys.forEach((k, i) => { stats[k.slice(5)] = Number(values[i]); });
        }
        return stats;
      } catch { return {}; }
    },

    setGauge(key, value) {
      const now = Math.floor(Date.now() / 1000);
      client.hset(`gauge:${key}`, { value: String(value), updated_at: String(now) })
        .catch((e) => logger.warn({ err: e, key }, 'setGauge failed'));
    },

    async getGauges() {
      try {
        const keys = await client.keys('gauge:*');
        const out = {};
        for (const k of keys) {
          const h = await client.hgetall(k);
          out[k.slice(6)] = Number(h.value);
        }
        return out;
      } catch { return {}; }
    },

    async countGroups()      { try { return await client.scard('groups'); }   catch { return 0; } },
    async countUniqueUsers() { try { return await client.scard('gpe:users'); } catch { return 0; } },

    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded    = new Set(config.privacy?.excludeFromStore || []);
        const retentionDays = config.privacy?.messageBodyRetentionDays || 0;
        const ttl = retentionDays > 0 ? retentionDays * 86400 : MSG_TTL;
        if (!storeBodies) return;          // privacy: skip the entire write
        const p = client.pipeline();
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
          p.set(`msg:${m.key.remoteJid}:${m.key.id}`, msgBuf, 'EX', ttl);
        }
        p.exec().catch(() => {});
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    // ── Edits (ZSET keyed by ts, member=JSON) ──────────────────────────
    async recordMessageEdit(jid, messageId, editor, oldBody, newBody, ts) {
      const t = ts ?? Math.floor(Date.now()/1000);
      try {
        await client.zadd(
          `edits:${jid}:${messageId}`, t,
          JSON.stringify({ editor: editor || null, old_body: oldBody || '', new_body: newBody || '', ts: t }));
      } catch (e) { logger.warn({err:e}, 'edit insert failed'); }
    },
    async getMessageEdits(jid, messageId) {
      try {
        const raw = await client.zrange(`edits:${jid}:${messageId}`, 0, -1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) { logger.warn({err:e}, 'edits query failed'); return []; }
    },
    async updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        await client.set(`msg:${jid}:${messageId}`, buf, 'EX', 604800);
      } catch (e) { logger.warn({err:e}, 'updateMessageBody failed'); }
    },

    // ── Reactions (ZSET keyed by ts, member=JSON) ──────────────────────
    async recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      const t = ts ?? Math.floor(Date.now()/1000);
      try {
        await client.zadd(
          `reactions:${jid}:${messageId}`, t,
          JSON.stringify({ reactor: reactor || '', emoji: emoji || null, ts: t }));
      } catch (e) { logger.warn({err:e}, 'reaction insert failed'); }
    },
    async getMessageReactions(jid, messageId) {
      try {
        const raw = await client.zrange(`reactions:${jid}:${messageId}`, 0, -1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) { logger.warn({err:e}, 'reactions query failed'); return []; }
    },

    // ── Receipts (HASH per message: { recipient -> "status|ts" }) ──────
    async recordReceipt(jid, messageId, recipient, status, ts) {
      const t = ts ?? Math.floor(Date.now()/1000);
      try {
        const key = `receipts:${jid}:${messageId}`;
        const existing = await client.hget(key, recipient);
        if (existing) {
          const [oldStatus] = existing.split('|').map(Number);
          if (oldStatus >= status) return;
        }
        await client.hset(key, recipient, `${status}|${t}`);
      } catch (e) { logger.warn({err:e}, 'receipt upsert failed'); }
    },
    async getMessageReceipts(jid, messageId) {
      try {
        const h = await client.hgetall(`receipts:${jid}:${messageId}`);
        return Object.entries(h).map(([recipient, v]) => {
          const [status, ts] = v.split('|').map(Number);
          return { recipient, status, ts };
        });
      } catch (e) { logger.warn({err:e}, 'receipts query failed'); return []; }
    },

    // ── Deletions (HASH `deleted:<jid>`: { messageId -> ts }) ──────────
    async markMessageDeleted(jid, messageId, _by, ts) {
      const t = ts ?? Math.floor(Date.now()/1000);
      try {
        await client.hsetnx(`deleted:${jid}`, messageId, String(t));
      } catch (e) { logger.warn({err:e}, 'markMessageDeleted failed'); }
    },
    async markChatMessagesDeleted(jid, ts) {
      try {
        await client.set(`chat-deleted:${jid}`, String(ts ?? Math.floor(Date.now()/1000)));
      } catch (e) { logger.warn({err:e}, 'markChatMessagesDeleted failed'); }
    },
    async getDeletedInGroup(jid, limit = 100) {
      try {
        const h = await client.hgetall(`deleted:${jid}`);
        return Object.entries(h)
          .map(([id, ts]) => ({ id, participant: null, deleted_at: Number(ts) }))
          .sort((a, b) => b.deleted_at - a.deleted_at)
          .slice(0, limit);
      } catch (e) { logger.warn({err:e}, 'deletedInGroup failed'); return []; }
    },

    // ── Aggregate status ───────────────────────────────────────────────
    async updateMessageStatus(jid, messageId, status, _ts) {
      try {
        const key = `msg-status:${jid}`;
        const existing = await client.hget(key, messageId);
        if (existing && Number(existing) >= status) return;
        await client.hset(key, messageId, String(status));
      } catch (e) { logger.warn({err:e}, 'updateMessageStatus failed'); }
    },

    close() { client.quit(); }
  };
}

module.exports = { makeRedisStore };