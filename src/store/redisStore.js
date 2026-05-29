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
 * Redis store.
 *
 *   Key conventions:
 *     msg:<jid>:<id>                  Buffer (proto-encoded Message), TTL 7d
 *     group:<jid>                     JSON GroupMetadata
 *     groups                          SET of all group JIDs (for counts)
 *     gpe:<groupJid>                  ZSET, score=ts, member=JSON event
 *     gpe:users                       SET of all participants ever seen
 *     stat:<key>                      Integer counter
 *     gauge:<key>                     Hash { value, updated_at }
 */

const Redis    = require('ioredis');
const { proto } = require('@whiskeysockets/baileys');

const MSG_TTL = 604800;   // 7 days

function makeRedisStore(url, logger, groupCache) {
  const client = new Redis(url);

  return {
    // ── Retry-decryption hook ──────────────────────────────────────────
    async getMessage(key) {
      const buf = await client.getBuffer(`msg:${key.remoteJid}:${key.id}`);
      return buf ? proto.Message.decode(buf) : undefined;
    },

    // ── Groups ─────────────────────────────────────────────────────────
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

    // ── Participants event-log (ZSET, score=ts) ────────────────────────
    async recordParticipantEvent(groupJid, participant, action, actor, ts) {
      const tsEff = ts ?? Math.floor(Date.now() / 1000);
      const ev = JSON.stringify({ participant, action, actor: actor || null, ts: tsEff });
      try {
        const p = client.pipeline();
        // Add with score=ts; the member is JSON so duplicate scores are fine
        // because the JSON itself differs (action/actor change between events).
        p.zadd(`gpe:${groupJid}`, tsEff, ev);
        p.sadd('gpe:users', participant);
        await p.exec();
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        // REV order, newest first
        const raw = await client.zrevrange(`gpe:${groupJid}`, 0, limit - 1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) { logger.warn({ err: e }, 'history query failed'); return []; }
    },

    async getCurrentParticipants(groupJid) {
      try {
        // We need latest event per participant. Pull everything (capped by Redis card)
        // and reduce. For very large groups this is O(N); acceptable up to ~10k events.
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

    // ── Stats: counters ────────────────────────────────────────────────
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

    // ── Stats: gauges ──────────────────────────────────────────────────
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

    // ── Derived counts ─────────────────────────────────────────────────
    async countGroups()      { try { return await client.scard('groups'); }   catch { return 0; } },
    async countUniqueUsers() { try { return await client.scard('gpe:users'); } catch { return 0; } },

    // ── Bind to Baileys events ─────────────────────────────────────────
    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        const p = client.pipeline();
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
          // ioredis supports Buffer values with the `set` command + 'EX' option
          p.set(`msg:${m.key.remoteJid}:${m.key.id}`, msgBuf, 'EX', MSG_TTL);
        }
        p.exec().catch(() => {});
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    close() { client.quit(); },
  };
}

module.exports = { makeRedisStore };
