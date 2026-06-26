/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

function _decodeSubscriberValue(jid, v) {
  if (v == null || v === '') return { jid, last_seen_pulse_ts: null, meta: null };
  if (v.startsWith('{')) {
    try {
      const env = JSON.parse(v);
      return {
        jid,
        last_seen_pulse_ts: env.ts == null ? null : Number(env.ts),
        meta: env.meta || null,
      };
    } catch {
      /* fall through */
    }
  }
  const n = Number(v);
  return { jid, last_seen_pulse_ts: Number.isFinite(n) ? n : null, meta: null };
}

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
 *     subscribers:<service>           HASH { jid -> last_seen_pulse_ts | "" }
 *     sent-items:<service>:<jid>     SET of item_url strings
 *
 * Privacy:
 *   • config.privacy.storeMessageBodies = false → message body writes skipped
 *   • config.privacy.excludeFromStore[]        → those chats never persisted
 *   • config.privacy.messageBodyRetentionDays  → overrides default 7d TTL
 */

const { config } = require('../lib/configLoader');
const Redis = require('ioredis');
const { proto } = require('@whiskeysockets/baileys');

const MSG_TTL = 604800; // 7 days default

function makeRedisStore(url, logger, groupCache) {
  const K = 'echofox';
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
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
    async hasContact(jid) {
      try {
        const exists = await this.client.exists(`${this.prefix}contact:${jid}`);
        return exists === 1;
      } catch (e) {
        logger.warn({ err: e, jid }, 'hasContact failed');
        return false;
      }
    },

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
      } catch (e) {
        logger.warn({ err: e }, 'participant event insert failed');
      }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        const raw = await client.zrevrange(`gpe:${groupJid}`, 0, limit - 1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) {
        logger.warn({ err: e }, 'history query failed');
        return [];
      }
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
      } catch (e) {
        logger.warn({ err: e }, 'current participants query failed');
        return [];
      }
    },

    async listGroups() {
      try {
        const jids = await client.smembers('groups');
        const out = [];
        for (const jid of jids) {
          const str = await client.get(`group:${jid}`);
          if (!str) continue;
          let meta;
          try {
            meta = JSON.parse(str);
          } catch {
            continue;
          }
          out.push({
            jid,
            subject: meta?.subject || '(unnamed)',
            participantCount: meta?.participants?.length || 0,
          });
        }
        return out.sort((a, b) => a.subject.localeCompare(b.subject));
      } catch {
        return [];
      }
    },

    // labels ─────────────────────────────────────────
    async upsertLabel(labelId, name, color) {
      try {
        if (!labelId || !name) return;
        await client.hset(K + ':label:' + labelId, {
          name,
          color: color == null ? '' : String(color),
          deleted: '0',
          updated_at: String(Date.now()),
        });
        await client.sadd(K + ':labels:set', labelId);
      } catch (e) {
        logger.warn({ err: e, labelId }, 'upsertLabel failed');
      }
    },
    async deleteLabel(labelId) {
      try {
        await client.hset(K + ':label:' + labelId, {
          deleted: '1',
          updated_at: String(Date.now()),
        });
      } catch (e) {
        logger.warn({ err: e, labelId }, 'deleteLabel failed');
      }
    },
    async getLabel(labelId) {
      try {
        const h = await client.hgetall(K + ':label:' + labelId);
        if (!h || !Object.keys(h).length) return null;
        return {
          label_id: labelId,
          name: h.name || null,
          color: h.color ? Number(h.color) : null,
          deleted: h.deleted === '1' ? 1 : 0,
          updated_at: Number(h.updated_at) || 0,
        };
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabel failed');
        return null;
      }
    },
    async listLabels() {
      try {
        const ids = await client.smembers(K + ':labels:set');
        const out = [];
        for (const id of ids) {
          const r = await this.getLabel(id);
          if (r && !r.deleted) out.push(r);
        }
        out.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'listLabels failed');
        return [];
      }
    },
    async associateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        const member = targetJid + '|' + (targetMsgId || '');
        await client.sadd(K + ':label_assoc:' + labelId + ':' + targetType, member);
        await client.sadd(K + ':label_assoc_by_target:' + targetJid, labelId);
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'associateLabel failed');
      }
    },
    async disassociateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        const member = targetJid + '|' + (targetMsgId || '');
        await client.srem(K + ':label_assoc:' + labelId + ':' + targetType, member);
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'disassociateLabel failed');
      }
    },
    async getLabelAssociations(labelId) {
      try {
        const out = [];
        for (const targetType of ['chat', 'message']) {
          const members = await client.smembers(K + ':label_assoc:' + labelId + ':' + targetType);
          for (const m of members) {
            const [target_jid, target_msg_id] = m.split('|');
            out.push({
              label_id: labelId,
              target_type: targetType,
              target_jid,
              target_msg_id: target_msg_id || null,
            });
          }
        }
        return out;
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabelAssociations failed');
        return [];
      }
    },
    async getLabelsForTarget(targetJid) {
      try {
        const labelIds = await client.smembers(K + ':label_assoc_by_target:' + targetJid);
        const out = [];
        for (const id of labelIds) {
          const r = await this.getLabel(id);
          if (r && !r.deleted) out.push({ label_id: id, name: r.name, color: r.color });
        }
        return out;
      } catch (e) {
        logger.warn({ err: e, targetJid }, 'getLabelsForTarget failed');
        return [];
      }
    },

    // newsletters ────────────────────────────────────
    async upsertNewsletter(newsletterId, meta = {}) {
      try {
        if (!newsletterId) return;
        const ts = Date.now();
        const m = meta || {};
        const h = { updated_at: String(ts) };
        if (m.name != null) h.name = String(m.name);
        if (m.description != null) h.description = String(m.description);
        const pic = m.picture_url ?? m.pictureUrl;
        if (pic != null) h.picture_url = String(pic);
        if (m.verification != null) h.verification = String(m.verification);
        if (m.subscribers != null) h.subscribers = String(m.subscribers);
        if (m.raw != null) h.meta = JSON.stringify(m.raw);
        await client.hset(K + ':newsletter:' + newsletterId, h);
        const ex = await client.hexists(K + ':newsletter:' + newsletterId, 'created_at');
        if (!ex)
          await client.hset(K + ':newsletter:' + newsletterId, {
            created_at: String(m.created_at ?? ts),
          });
        await client.sadd(K + ':newsletters:set', newsletterId);
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'upsertNewsletter failed');
      }
    },
    async updateNewsletter(newsletterId, partial = {}) {
      return this.upsertNewsletter(newsletterId, partial);
    },
    async getNewsletter(newsletterId) {
      try {
        const h = await client.hgetall(K + ':newsletter:' + newsletterId);
        if (!h || !Object.keys(h).length) return null;
        return {
          newsletter_id: newsletterId,
          name: h.name || null,
          description: h.description || null,
          picture_url: h.picture_url || null,
          verification: h.verification || null,
          subscribers: h.subscribers ? Number(h.subscribers) : 0,
          meta: h.meta
            ? (() => {
                try {
                  return JSON.parse(h.meta);
                } catch {
                  return h.meta;
                }
              })()
            : null,
          created_at: Number(h.created_at) || 0,
          updated_at: Number(h.updated_at) || 0,
        };
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletter failed');
        return null;
      }
    },
    async listNewsletters() {
      try {
        const ids = await client.smembers(K + ':newsletters:set');
        const out = [];
        for (const id of ids) {
          const r = await this.getNewsletter(id);
          if (r) {
            delete r.meta;
            out.push(r);
          }
        }
        out.sort((a, b) => b.updated_at - a.updated_at);
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'listNewsletters failed');
        return [];
      }
    },
    async incrementNewsletterView(newsletterId, messageId) {
      try {
        await client.hincrby(K + ':nl_views:' + newsletterId, messageId, 1);
        await client.hset(K + ':nl_views_ts:' + newsletterId, { [messageId]: String(Date.now()) });
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'incrementNewsletterView failed');
      }
    },
    async getNewsletterViews(newsletterId, messageId, limit = 100) {
      try {
        if (messageId) {
          const v = await client.hget(K + ':nl_views:' + newsletterId, messageId);
          const t = await client.hget(K + ':nl_views_ts:' + newsletterId, messageId);
          return v
            ? [{ message_id: messageId, view_count: Number(v), updated_at: Number(t) || 0 }]
            : [];
        }
        const allViews = await client.hgetall(K + ':nl_views:' + newsletterId);
        const allTs = await client.hgetall(K + ':nl_views_ts:' + newsletterId);
        const out = Object.entries(allViews || {}).map(([msgId, v]) => ({
          message_id: msgId,
          view_count: Number(v),
          updated_at: Number(allTs?.[msgId]) || 0,
        }));
        out.sort((a, b) => b.updated_at - a.updated_at);
        return out.slice(0, limit);
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletterViews failed');
        return [];
      }
    },
    async recordNewsletterReaction(newsletterId, messageId, emoji, count = 1) {
      try {
        const entry = JSON.stringify({
          emoji: emoji || null,
          count: count || 1,
          recorded_at: Date.now(),
        });
        await client.rpush(K + ':nl_react:' + newsletterId + ':' + messageId, entry);
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'recordNewsletterReaction failed');
      }
    },
    async getNewsletterReactions(newsletterId, messageId) {
      try {
        const items = await client.lrange(K + ':nl_react:' + newsletterId + ':' + messageId, 0, -1);
        const agg = new Map();
        for (const raw of items) {
          try {
            const r = JSON.parse(raw);
            const e = r.emoji || '';
            const prev = agg.get(e) || { emoji: e, total: 0, last_seen: 0 };
            prev.total += Number(r.count) || 0;
            prev.last_seen = Math.max(prev.last_seen, Number(r.recorded_at) || 0);
            agg.set(e, prev);
          } catch {
            /* ignore */
          }
        }
        return Array.from(agg.values()).sort((a, b) => b.total - a.total);
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'getNewsletterReactions failed');
        return [];
      }
    },
    async updateNewsletterSettings(newsletterId, settings = {}) {
      try {
        await client.set(
          K + ':nl_settings:' + newsletterId,
          JSON.stringify({
            settings: settings || {},
            updated_at: Date.now(),
          }),
        );
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'updateNewsletterSettings failed');
      }
    },
    async getNewsletterSettings(newsletterId) {
      try {
        const raw = await client.get(K + ':nl_settings:' + newsletterId);
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
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
        const pipe = client.pipeline();
        pipe.hset(K + ':lid_map', lid, jid);
        pipe.hset(K + ':lid_rev', jid, lid);
        await pipe.exec();
      } catch (e) {
        logger.warn({ err: e, lid, jid }, 'setLidMapping failed');
      }
    },
    async getLidMapping(lid) {
      try {
        return (await client.hget(K + ':lid_map', lid)) || null;
      } catch (e) {
        logger.warn({ err: e, lid }, 'getLidMapping failed');
        return null;
      }
    },
    async getReverseLidMapping(jid) {
      try {
        return (await client.hget(K + ':lid_rev', jid)) || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getReverseLidMapping failed');
        return null;
      }
    },

    // message-capping ────────────────────────────────
    async setMessageCap(jid, capValue) {
      try {
        if (!jid || capValue == null) return;
        const pipe = client.pipeline();
        pipe.hset(K + ':msg_cap', jid, String(capValue));
        pipe.hset(K + ':msg_cap_ts', jid, String(Date.now()));
        await pipe.exec();
      } catch (e) {
        logger.warn({ err: e, jid }, 'setMessageCap failed');
      }
    },
    async getMessageCap(jid) {
      try {
        const v = await client.hget(K + ':msg_cap', jid);
        if (v == null) return null;
        const t = await client.hget(K + ':msg_cap_ts', jid);
        return { cap_value: Number(v), updated_at: Number(t) || 0 };
      } catch (e) {
        logger.warn({ err: e, jid }, 'getMessageCap failed');
        return null;
      }
    },

    // blocklist ───────────────────────────────────────────────
    async setBlocklist(jids) {
      try {
        if (!Array.isArray(jids)) return;
        const k = K + ':blocklist';
        const pipe = client.pipeline();
        pipe.del(k);
        if (jids.length) pipe.sadd(k, jids.filter(Boolean));
        await pipe.exec();
      } catch (e) {
        logger.warn({ err: e }, 'setBlocklist failed');
      }
    },
    async addToBlocklist(jid) {
      try {
        await client.sadd(K + ':blocklist', jid);
      } catch (e) {
        logger.warn({ err: e, jid }, 'addToBlocklist failed');
      }
    },
    async removeFromBlocklist(jid) {
      try {
        await client.srem(K + ':blocklist', jid);
      } catch (e) {
        logger.warn({ err: e, jid }, 'removeFromBlocklist failed');
      }
    },
    async getBlocklist() {
      try {
        const members = await client.smembers(K + ':blocklist');
        return members.map((jid) => ({ jid, added_at: null }));
      } catch (e) {
        logger.warn({ err: e }, 'getBlocklist failed');
        return [];
      }
    },
    async isBlocked(jid) {
      try {
        return (await client.sismember(K + ':blocklist', jid)) === 1;
      } catch (e) {
        logger.warn({ err: e, jid }, 'isBlocked failed');
        return false;
      }
    },

    // presence ────────────────────────────────────────────────
    async recordPresence(jid, state, lastSeenTs, chatJid) {
      try {
        const h = {
          last_state: state || '',
          chat_jid: chatJid || '',
          updated_at: String(Date.now()),
        };
        if (lastSeenTs != null) h.last_seen_ts = String(lastSeenTs);
        await client.hset(K + ':presence:' + jid, h);
      } catch (e) {
        logger.warn({ err: e, jid }, 'recordPresence failed');
      }
    },
    async getPresence(jid) {
      try {
        const h = await client.hgetall(K + ':presence:' + jid);
        if (!h || !Object.keys(h).length) return null;
        return {
          jid,
          last_state: h.last_state || null,
          last_seen_ts: h.last_seen_ts ? Number(h.last_seen_ts) : null,
          chat_jid: h.chat_jid || null,
          updated_at: h.updated_at ? Number(h.updated_at) : 0,
        };
      } catch (e) {
        logger.warn({ err: e, jid }, 'getPresence failed');
        return null;
      }
    },
    async getPresenceInChat(chatJid) {
      try {
        const keys = [];
        let cursor = '0';
        do {
          const [next, batch] = await client.scan(cursor, 'MATCH', K + ':presence:*', 'COUNT', 200);
          cursor = next;
          keys.push(...batch);
        } while (cursor !== '0');
        const out = [];
        for (const k of keys) {
          const h = await client.hgetall(k);
          if (h.chat_jid === chatJid) {
            out.push({
              jid: k.split(':').pop(),
              last_state: h.last_state,
              last_seen_ts: h.last_seen_ts ? Number(h.last_seen_ts) : null,
              updated_at: Number(h.updated_at) || 0,
            });
          }
        }
        out.sort((a, b) => b.updated_at - a.updated_at);
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'getPresenceInChat failed');
        return [];
      }
    },
    async getRecentPresence(limit = 50) {
      try {
        const keys = [];
        let cursor = '0';
        do {
          const [next, batch] = await client.scan(cursor, 'MATCH', K + ':presence:*', 'COUNT', 200);
          cursor = next;
          keys.push(...batch);
        } while (cursor !== '0');
        const out = [];
        for (const k of keys) {
          const h = await client.hgetall(k);
          if (h && h.updated_at) {
            out.push({
              jid: k.split(':').pop(),
              last_state: h.last_state || null,
              last_seen_ts: h.last_seen_ts ? Number(h.last_seen_ts) : null,
              chat_jid: h.chat_jid || null,
              updated_at: Number(h.updated_at),
            });
          }
        }
        out.sort((a, b) => b.updated_at - a.updated_at);
        return out.slice(0, limit);
      } catch (e) {
        logger.warn({ err: e }, 'getRecentPresence failed');
        return [];
      }
    },

    // chat state ──────────────────────────────────────────────
    async updateChat(jid, partial) {
      try {
        if (!jid) return;
        const h = {};
        for (const k of ['name', 'unread', 'ts', 'pinned', 'muted_until', 'archived']) {
          if (partial?.[k] != null) {
            h[k] =
              k === 'pinned' || k === 'archived' ? (partial[k] ? '1' : '0') : String(partial[k]);
          }
        }
        if (Object.keys(h).length) {
          await client.hset(K + ':chat:' + jid, h);
          await client.sadd(K + ':chats:set', jid);
        }
      } catch (e) {
        logger.warn({ err: e, jid }, 'updateChat failed');
      }
    },
    async markChatDeleted(jid) {
      try {
        await client.hset(K + ':chat:' + jid, { deleted_at: String(Date.now()) });
      } catch (e) {
        logger.warn({ err: e, jid }, 'markChatDeleted failed');
      }
    },
    async listChats() {
      try {
        const members = await client.smembers(K + ':chats:set');
        const out = [];
        for (const jid of members) {
          const h = await client.hgetall(K + ':chat:' + jid);
          if (h && Object.keys(h).length) {
            out.push({ jid, ...h, ts: h.ts ? Number(h.ts) : null });
          }
        }
        out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'listChats failed');
        return [];
      }
    },
    async getChat(jid) {
      try {
        const h = await client.hgetall(K + ':chat:' + jid);
        return h && Object.keys(h).length ? { jid, ...h, ts: h.ts ? Number(h.ts) : null } : null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getChat failed');
        return null;
      }
    },

    // contacts (bulk + extended) ─────────────────────────────
    async bulkUpsertContacts(contacts) {
      try {
        if (!Array.isArray(contacts) || !contacts.length) return 0;
        const pipe = client.pipeline();
        let n = 0;
        for (const c of contacts) {
          if (!c?.id) continue;
          const h = {};
          if (c.name != null) h.name = c.name;
          if (c.notify != null) h.notify = c.notify;
          if (c.imgUrl != null) h.img_url = c.imgUrl;
          if (c.status != null) h.status = c.status;
          if (c.verifiedName != null) h.verified_name = c.verifiedName;
          if (Object.keys(h).length) {
            pipe.hset(K + ':contact:' + c.id, h);
            pipe.sadd(K + ':contacts:set', c.id);
            n++;
          }
        }
        await pipe.exec();
        return n;
      } catch (e) {
        logger.warn({ err: e }, 'bulkUpsertContacts failed');
        return 0;
      }
    },
    async getContact(jid) {
      try {
        const h = await client.hgetall(K + ':contact:' + jid);
        return h && Object.keys(h).length ? { jid, ...h } : null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getContact failed');
        return null;
      }
    },
    async listContacts({ limit = 100, offset = 0 } = {}) {
      try {
        const all = await client.smembers(K + ':contacts:set');
        const slice = all.sort().slice(offset, offset + limit);
        const out = [];
        for (const jid of slice) {
          const h = await client.hgetall(K + ':contact:' + jid);
          out.push({ jid, ...(h || {}) });
        }
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'listContacts failed');
        return [];
      }
    },
    async countContacts() {
      try {
        return await client.scard(K + ':contacts:set');
      } catch (e) {
        logger.warn({ err: e }, 'countContacts failed');
        return 0;
      }
    },

    // v1.2.0 AI ──────────────────────────────────────────────
    async appendAiTurn(chatJid, turn) {
      try {
        const key = `ai_conv:${chatJid}`;
        const payload = JSON.stringify({
          role: String(turn.role || ''),
          content: String(turn.content == null ? '' : turn.content),
          toolName: turn.toolName || undefined,
          toolArgs: turn.toolArgs
            ? typeof turn.toolArgs === 'string'
              ? turn.toolArgs
              : JSON.stringify(turn.toolArgs)
            : undefined,
          toolId: turn.toolId || undefined,
          model: turn.model || undefined,
          provider: turn.provider || undefined,
          promptTokens: Number(turn.promptTokens || 0),
          completionTokens: Number(turn.completionTokens || 0),
          ts: Number(turn.ts || Date.now()),
        });
        await client.rpush(key, payload);
        // Cap list length to a safe multiple of memoryTurns (default 20*4=80
        // accounts for user+assistant+tool+assistant cycles).
        await client.ltrim(key, -400, -1);
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'appendAiTurn failed');
        return false;
      }
    },
    async getRecentAiTurns(chatJid, limit = 20) {
      try {
        const raw = await client.lrange(`ai_conv:${chatJid}`, -Number(limit) || -20, -1);
        return raw
          .map((s) => {
            try {
              return JSON.parse(s);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getRecentAiTurns failed');
        return [];
      }
    },
    async clearAiTurns(chatJid) {
      try {
        await client.del(`ai_conv:${chatJid}`);
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
        const field = `${provider || ''}:${model || ''}`;
        const hk = `ai_usage:${day}`;
        const prev = await client.hget(hk, field);
        const cur = prev
          ? (() => {
              try {
                return JSON.parse(prev);
              } catch {
                return {};
              }
            })()
          : {};
        const next = {
          prompt_tokens: Number(cur.prompt_tokens || 0) + Number(promptTokens) || 0,
          completion_tokens: Number(cur.completion_tokens || 0) + Number(completionTokens) || 0,
          cost_usd: Number(cur.cost_usd || 0) + Number(costUsd) || 0,
          calls: Number(cur.calls || 0) + 1,
        };
        await client.hset(hk, field, JSON.stringify(next));
        // expire after 100 days — usage history beyond that is rarely useful
        await client.expire(hk, 100 * 24 * 60 * 60);
        return true;
      } catch (e) {
        logger.warn({ err: e }, 'recordAiUsage failed');
        return false;
      }
    },
    async getAiUsageDayTotal(day) {
      try {
        const all = await client.hgetall(`ai_usage:${day}`);
        let total = 0;
        for (const v of Object.values(all || {})) {
          try {
            total += Number(JSON.parse(v).cost_usd || 0);
          } catch {
            /* ignore */
          }
        }
        return total;
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageDayTotal failed');
        return 0;
      }
    },
    async getAiUsageSince(day) {
      try {
        const dayKeys = await client.keys('ai_usage:*');
        const out = [];
        for (const k of dayKeys) {
          const d = k.split(':')[1];
          if (d < String(day)) continue;
          const all = await client.hgetall(k);
          for (const [field, v] of Object.entries(all || {})) {
            try {
              const obj = JSON.parse(v);
              const [provider, model] = field.split(':');
              out.push({ day: d, provider, model, ...obj });
            } catch {
              /* ignore */
            }
          }
        }
        out.sort((a, b) => b.day.localeCompare(a.day) || b.cost_usd - a.cost_usd);
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageSince failed');
        return [];
      }
    },
    async getAiUsageByDay(limit = 30) {
      try {
        const dayKeys = await client.keys('ai_usage:*');
        const rolled = new Map();
        for (const k of dayKeys) {
          const d = k.split(':')[1];
          if (!rolled.has(d))
            rolled.set(d, {
              day: d,
              cost_usd: 0,
              prompt_tokens: 0,
              completion_tokens: 0,
              calls: 0,
            });
          const acc = rolled.get(d);
          const all = await client.hgetall(k);
          for (const v of Object.values(all || {})) {
            try {
              const o = JSON.parse(v);
              acc.cost_usd += Number(o.cost_usd || 0);
              acc.prompt_tokens += Number(o.prompt_tokens || 0);
              acc.completion_tokens += Number(o.completion_tokens || 0);
              acc.calls += Number(o.calls || 0);
            } catch {
              /* ignore */
            }
          }
        }
        return [...rolled.values()]
          .sort((a, b) => b.day.localeCompare(a.day))
          .slice(0, Number(limit) || 30);
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
        await client.set(
          `ai_opt_in:${chatJid}`,
          JSON.stringify({
            enabled: !!enabled,
            persona,
            provider,
            model,
            updatedAt: Date.now(),
          }),
        );
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'setAiChatOptIn failed');
        return false;
      }
    },
    async getAiChatOptIn(chatJid) {
      try {
        const raw = await client.get(`ai_opt_in:${chatJid}`);
        if (!raw) return null;
        const o = JSON.parse(raw);
        return {
          enabled: !!o.enabled,
          persona: o.persona ?? null,
          provider: o.provider ?? null,
          model: o.model ?? null,
          updatedAt: Number(o.updatedAt || 0),
        };
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiChatOptIn failed');
        return null;
      }
    },
    async listAiOptedInChats(limit = 100) {
      try {
        const keys = await client.keys('ai_opt_in:*');
        const out = [];
        for (const k of keys.slice(0, Number(limit) || 100)) {
          const raw = await client.get(k);
          if (!raw) continue;
          try {
            const o = JSON.parse(raw);
            out.push({
              chatJid: k.slice('ai_opt_in:'.length),
              enabled: !!o.enabled,
              persona: o.persona ?? null,
              provider: o.provider ?? null,
              model: o.model ?? null,
              updatedAt: Number(o.updatedAt || 0),
            });
          } catch {
            /* ignore */
          }
        }
        out.sort((a, b) => b.updatedAt - a.updatedAt);
        return out;
      } catch (e) {
        logger.warn({ err: e }, 'listAiOptedInChats failed');
        return [];
      }
    },

    // v1.3.0 AI persistent rate-limit ────────────────────────
    async incrAiRateUser(userJid, hourBucket) {
      try {
        const key = `ai_rate_user:${userJid}:${hourBucket}`;
        const n = await client.incr(key);
        // Set expiry once per bucket (no-op once set): (bucket+2)*3600 seconds.
        const ttl = Math.max(60, (Number(hourBucket) + 2) * 3600 - Math.floor(Date.now() / 1000));
        try {
          await client.expire(key, ttl);
        } catch {
          /* ignore */
        }
        return Number(n);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'incrAiRateUser failed');
        return 0;
      }
    },
    async getAiRateUser(userJid, hourBucket) {
      try {
        const v = await client.get(`ai_rate_user:${userJid}:${hourBucket}`);
        return Number(v || 0);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'getAiRateUser failed');
        return 0;
      }
    },
    async incrAiRateChat(chatJid, dayBucket) {
      try {
        const key = `ai_rate_chat:${chatJid}:${dayBucket}`;
        const n = await client.incr(key);
        const ttl = Math.max(60, (Number(dayBucket) + 2) * 86_400 - Math.floor(Date.now() / 1000));
        try {
          await client.expire(key, ttl);
        } catch {
          /* ignore */
        }
        return Number(n);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'incrAiRateChat failed');
        return 0;
      }
    },
    async getAiRateChat(chatJid, dayBucket) {
      try {
        const v = await client.get(`ai_rate_chat:${chatJid}:${dayBucket}`);
        return Number(v || 0);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiRateChat failed');
        return 0;
      }
    },
    async pruneAiRate(_now = Date.now()) {
      // Redis handles TTL natively; nothing to do here.
      return { users: 0, chats: 0 };
    },

    async recordStat(key, inc = 1) {
      client
        .incrby(`stat:${key}`, inc)
        .catch((e) => logger.warn({ err: e, key }, 'recordStat failed'));
    },

    async getStats() {
      try {
        const keys = await client.keys('stat:*');
        const stats = {};
        if (keys.length) {
          const values = await client.mget(keys);
          keys.forEach((k, i) => {
            stats[k.slice(5)] = Number(values[i]);
          });
        }
        return stats;
      } catch {
        return {};
      }
    },

    setGauge(key, value) {
      const now = Math.floor(Date.now() / 1000);
      client
        .hset(`gauge:${key}`, { value: String(value), updated_at: String(now) })
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
      } catch {
        return {};
      }
    },

    async countGroups() {
      try {
        return await client.scard('groups');
      } catch {
        return 0;
      }
    },
    async countUniqueUsers() {
      try {
        return await client.scard('gpe:users');
      } catch {
        return 0;
      }
    },

    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded = new Set(config.privacy?.excludeFromStore || []);
        const retentionDays = config.privacy?.messageBodyRetentionDays || 0;
        const ttl = retentionDays > 0 ? retentionDays * 86400 : MSG_TTL;
        if (!storeBodies) return; // privacy: skip the entire write
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
      const t = ts ?? Math.floor(Date.now() / 1000);
      try {
        await client.zadd(
          `edits:${jid}:${messageId}`,
          t,
          JSON.stringify({
            editor: editor || null,
            old_body: oldBody || '',
            new_body: newBody || '',
            ts: t,
          }),
        );
      } catch (e) {
        logger.warn({ err: e }, 'edit insert failed');
      }
    },
    async getMessageEdits(jid, messageId) {
      try {
        const raw = await client.zrange(`edits:${jid}:${messageId}`, 0, -1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) {
        logger.warn({ err: e }, 'edits query failed');
        return [];
      }
    },
    async updateMessageBody(jid, messageId, message, _ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        await client.set(`msg:${jid}:${messageId}`, buf, 'EX', 604800);
      } catch (e) {
        logger.warn({ err: e }, 'updateMessageBody failed');
      }
    },

    // ── Reactions (ZSET keyed by ts, member=JSON) ──────────────────────
    async recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      const t = ts ?? Math.floor(Date.now() / 1000);
      try {
        await client.zadd(
          `reactions:${jid}:${messageId}`,
          t,
          JSON.stringify({ reactor: reactor || '', emoji: emoji || null, ts: t }),
        );
      } catch (e) {
        logger.warn({ err: e }, 'reaction insert failed');
      }
    },
    async getMessageReactions(jid, messageId) {
      try {
        const raw = await client.zrange(`reactions:${jid}:${messageId}`, 0, -1);
        return raw.map((s) => JSON.parse(s));
      } catch (e) {
        logger.warn({ err: e }, 'reactions query failed');
        return [];
      }
    },

    // ── Receipts (HASH per message: { recipient -> "status|ts" }) ──────
    async recordReceipt(jid, messageId, recipient, status, ts) {
      const t = ts ?? Math.floor(Date.now() / 1000);
      try {
        const key = `receipts:${jid}:${messageId}`;
        const existing = await client.hget(key, recipient);
        if (existing) {
          const [oldStatus] = existing.split('|').map(Number);
          if (oldStatus >= status) return;
        }
        await client.hset(key, recipient, `${status}|${t}`);
      } catch (e) {
        logger.warn({ err: e }, 'receipt upsert failed');
      }
    },
    async getMessageReceipts(jid, messageId) {
      try {
        const h = await client.hgetall(`receipts:${jid}:${messageId}`);
        return Object.entries(h).map(([recipient, v]) => {
          const [status, ts] = v.split('|').map(Number);
          return { recipient, status, ts };
        });
      } catch (e) {
        logger.warn({ err: e }, 'receipts query failed');
        return [];
      }
    },

    // ── Deletions (HASH `deleted:<jid>`: { messageId -> ts }) ──────────
    async markMessageDeleted(jid, messageId, _by, ts) {
      const t = ts ?? Math.floor(Date.now() / 1000);
      try {
        await client.hsetnx(`deleted:${jid}`, messageId, String(t));
      } catch (e) {
        logger.warn({ err: e }, 'markMessageDeleted failed');
      }
    },
    async markChatMessagesDeleted(jid, ts) {
      try {
        await client.set(`chat-deleted:${jid}`, String(ts ?? Math.floor(Date.now() / 1000)));
      } catch (e) {
        logger.warn({ err: e }, 'markChatMessagesDeleted failed');
      }
    },
    async getDeletedInGroup(jid, limit = 100) {
      try {
        const h = await client.hgetall(`deleted:${jid}`);
        return Object.entries(h)
          .map(([id, ts]) => ({ id, participant: null, deleted_at: Number(ts) }))
          .sort((a, b) => b.deleted_at - a.deleted_at)
          .slice(0, limit);
      } catch (e) {
        logger.warn({ err: e }, 'deletedInGroup failed');
        return [];
      }
    },

    // ── Aggregate status ───────────────────────────────────────────────
    async updateMessageStatus(jid, messageId, status, _ts) {
      try {
        const key = `msg-status:${jid}`;
        const existing = await client.hget(key, messageId);
        if (existing && Number(existing) >= status) return;
        await client.hset(key, messageId, String(status));
      } catch (e) {
        logger.warn({ err: e }, 'updateMessageStatus failed');
      }
    },

    // ── Subscribers + sent-article tracker (v0.4.6) ─────────────────────
    async getSubscribers(service) {
      try {
        const h = await client.hgetall(`subscribers:${service}`);
        return Object.entries(h).map(([jid, v]) => _decodeSubscriberValue(jid, v));
      } catch (e) {
        logger.warn({ err: e, service }, 'getSubscribers failed');
        return [];
      }
    },
    async addSubscriber(service, jid, meta) {
      try {
        const payload = JSON.stringify({ ts: null, meta: meta == null ? null : meta });
        await client.hsetnx(`subscribers:${service}`, jid, payload);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'addSubscriber failed');
      }
    },
    async removeSubscriber(service, jid) {
      try {
        await client.hdel(`subscribers:${service}`, jid);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'removeSubscriber failed');
      }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try {
        const key = `subscribers:${service}`;
        const existing = await client.hget(key, jid);
        const decoded = existing ? _decodeSubscriberValue(jid, existing) : { meta: null };
        const payload = JSON.stringify({ ts: ts == null ? null : Number(ts), meta: decoded.meta });
        await client.hset(key, jid, payload);
      } catch (e) {
        logger.warn({ err: e }, 'updateSubscriberTimestamp failed');
      }
    },
    async isSubscriber(service, jid) {
      try {
        const exists = await client.hexists(`subscribers:${service}`, jid);
        return !!exists;
      } catch {
        return false;
      }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const v = await client.hget(`subscribers:${service}`, jid);
        if (v == null) return null;
        return _decodeSubscriberValue(jid, v).meta;
      } catch {
        return null;
      }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        const key = `subscribers:${service}`;
        const existing = await client.hget(key, jid);
        if (existing == null) return;
        const decoded = _decodeSubscriberValue(jid, existing);
        const payload = JSON.stringify({
          ts: decoded.last_seen_pulse_ts,
          meta: meta == null ? null : meta,
        });
        await client.hset(key, jid, payload);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed');
      }
    },
    async hasSentItem(service, jid, itemUrl) {
      try {
        const v = await client.sismember(`sent-items:${service}:${jid}`, itemUrl);
        return Number(v) === 1;
      } catch {
        return false;
      }
    },
    async recordSentItem(service, jid, itemUrl) {
      try {
        await client.sadd(`sent-items:${service}:${jid}`, itemUrl);
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'recordSentItem failed');
      }
    },

    async hasSentArticle(service, jid, articleUrl) {
      return this.hasSentItem(service, jid, articleUrl);
    },
    async recordSentArticle(service, jid, articleUrl) {
      return this.recordSentItem(service, jid, articleUrl);
    },

    // ─── v1.12.0 — user leveling ──────────────────────────────────
    async getUserLevel(jid) {
      try {
        const xpStr = await client.hget(`user_levels:${jid}`, 'xp');
        const lastStr = await client.hget(`user_levels:${jid}`, 'last_at');
        if (xpStr == null) return null;
        return { jid, xp: Number(xpStr) || 0, last_at: Number(lastStr) || 0 };
      } catch (e) {
        logger.debug({ err: e, jid }, 'getUserLevel failed');
        return null;
      }
    },
    async addUserXp(jid, amount) {
      const xp = Math.max(0, Math.floor(Number(amount) || 0));
      const key = `user_levels:${jid}`;
      if (xp === 0) {
        try {
          const cur = await client.hget(key, 'xp');
          return cur == null ? 0 : Number(cur);
        } catch {
          return 0;
        }
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        const total = await client.hincrby(key, 'xp', xp);
        await client.hset(key, 'last_at', now);
        return Number(total) || xp;
      } catch (e) {
        logger.debug({ err: e, jid, amount }, 'addUserXp failed');
        return 0;
      }
    },

    // v1.16.0 — leaderboard / leveling extensions (SCAN-based for Redis)
    async getTopUsersByXp(limit = 10) {
      try {
        const cap = Math.max(1, Math.min(100, Number(limit) || 10));
        const rows = [];
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', 'user_levels:*', 'COUNT', 200);
          cursor = next;
          for (const k of keys) {
            const data = await client.hgetall(k);
            if (!data || !data.xp) continue;
            rows.push({
              jid: k.slice('user_levels:'.length),
              xp: Number(data.xp) || 0,
              last_at: Number(data.last_at) || 0,
            });
          }
        } while (cursor !== '0');
        rows.sort((a, b) => b.xp - a.xp || a.jid.localeCompare(b.jid));
        return rows.filter((r) => r.xp > 0).slice(0, cap);
      } catch (e) {
        logger.debug({ err: e }, 'getTopUsersByXp failed');
        return [];
      }
    },
    async getActiveUsersSince(sinceSec, limit = 10) {
      try {
        const since = Math.floor(Number(sinceSec) || 0);
        const cap = Math.max(1, Math.min(100, Number(limit) || 10));
        const all = await this.getTopUsersByXp(1000);
        return all.filter((r) => r.last_at >= since).slice(0, cap);
      } catch (e) {
        logger.debug({ err: e, sinceSec }, 'getActiveUsersSince failed');
        return [];
      }
    },
    async applyXpDecay(graceSec, ratePerWeek) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const grace = Math.max(0, Math.floor(Number(graceSec) || 0));
        const rate = Math.max(0, Math.min(0.999, Number(ratePerWeek) || 0));
        const cutoff = now - grace;
        if (rate === 0) return 0;
        let affected = 0;
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', 'user_levels:*', 'COUNT', 200);
          cursor = next;
          for (const k of keys) {
            const data = await client.hgetall(k);
            if (!data || !data.xp) continue;
            const xp = Number(data.xp) || 0;
            const lastAt = Number(data.last_at) || 0;
            if (xp <= 0 || lastAt <= 0 || lastAt >= cutoff) continue;
            const weeksOver = (now - lastAt - grace) / (7 * 86400);
            if (weeksOver <= 0) continue;
            const factor = Math.pow(1 - rate, weeksOver);
            const newXp = Math.max(0, Math.floor(xp * factor));
            if (newXp < xp) {
              await client.hset(k, 'xp', String(newXp));
              affected += 1;
            }
          }
        } while (cursor !== '0');
        return affected;
      } catch (e) {
        logger.debug({ err: e, graceSec, ratePerWeek }, 'applyXpDecay failed');
        return 0;
      }
    },
    async getMostChangedGroupsSince(sinceSec, limit = 5) {
      try {
        const since = Math.floor(Number(sinceSec) || 0);
        const cap = Math.max(1, Math.min(50, Number(limit) || 5));
        // Redis layout: group_settings_events stored as LIST per jid.
        // Walk all gse:* keys and count entries with ts >= since.
        const counts = new Map();
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', 'gse:*', 'COUNT', 200);
          cursor = next;
          for (const k of keys) {
            const jid = k.slice('gse:'.length);
            const entries = await client.lrange(k, 0, -1);
            let cnt = 0;
            for (const e of entries) {
              try {
                const obj = JSON.parse(e);
                if (Number(obj.ts) >= since) cnt += 1;
              } catch (_) {
                /* skip malformed */
              }
            }
            if (cnt > 0) counts.set(jid, cnt);
          }
        } while (cursor !== '0');
        const out = Array.from(counts.entries())
          .map(([jid, count]) => ({ jid, count }))
          .sort((a, b) => b.count - a.count || a.jid.localeCompare(b.jid))
          .slice(0, cap);
        return out;
      } catch (e) {
        logger.debug({ err: e, sinceSec }, 'getMostChangedGroupsSince failed');
        return [];
      }
    },
    async getGroupSettingsHistoryByField(jid, field, limit = 200) {
      try {
        const cap = Math.max(1, Math.min(2000, Number(limit) || 200));
        const entries = await client.lrange(`gse:${jid}`, 0, -1);
        const out = [];
        for (let i = 0; i < entries.length; i++) {
          try {
            const obj = JSON.parse(entries[i]);
            if (obj.field === field) {
              out.push({
                id: `r${i}`,
                field: obj.field,
                old_value: obj.old_value,
                new_value: obj.new_value,
                actor: obj.actor,
                ts: Number(obj.ts) || 0,
              });
            }
          } catch (_) {
            /* skip */
          }
          if (out.length >= cap) break;
        }
        out.sort((a, b) => b.ts - a.ts);
        return out.slice(0, cap);
      } catch (e) {
        logger.debug({ err: e, jid, field }, 'getGroupSettingsHistoryByField failed');
        return [];
      }
    },

    // v1.13.0 — groups dashboard helper
    // Redis store doesn't have a queryable messages table — return null
    // so the server falls back to 'unknown' (active=null in API output).
    async getLastHumanMessageTs(_jid) {
      return null;
    },

    // v1.14.0 — group settings event log (LPUSH-capped LIST of JSON events)
    async recordGroupSettingsChange(jid, field, oldValue, newValue, actor, ts) {
      try {
        const key = `group_settings_events:${jid}`;
        const event = {
          field,
          old_value: oldValue == null ? null : String(oldValue),
          new_value: newValue == null ? null : String(newValue),
          actor: actor || null,
          ts: Math.floor(Number(ts) || Date.now() / 1000),
        };
        await client.lpush(key, JSON.stringify(event));
        await client.ltrim(key, 0, 1999);
      } catch (e) {
        logger.debug({ err: e, jid, field }, 'recordGroupSettingsChange failed');
      }
    },
    async getGroupSettingsHistory(jid, limit = 200) {
      try {
        const cap = Math.max(1, Math.min(2000, Number(limit) || 200));
        const raw = await client.lrange(`group_settings_events:${jid}`, 0, cap - 1);
        const out = [];
        for (let i = 0; i < raw.length; i++) {
          try {
            const e = JSON.parse(raw[i]);
            out.push({
              id: `r${i}`,
              field: e.field,
              old_value: e.old_value,
              new_value: e.new_value,
              actor: e.actor,
              ts: Number(e.ts),
            });
          } catch {
            /* skip malformed entry */
          }
        }
        return out;
      } catch (e) {
        logger.debug({ err: e, jid }, 'getGroupSettingsHistory failed');
        return [];
      }
    },

    // v1.15.0 — persistent mutes (HASH for active + LIST for history)
    async recordMute(chatJid, userJid, opts = {}) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const expires = Math.floor(Number(opts.expiresAt) || 0);
        const entry = {
          chat_jid: chatJid,
          user_jid: userJid,
          created_at: now,
          expires_at: expires,
          by_jid: opts.byJid || null,
          reason: opts.reason ? String(opts.reason).slice(0, 200) : null,
          unmuted_at: null,
        };
        await client.hset(`mutes:${chatJid}`, userJid, String(expires));
        await client.lpush(`mutes:log:${chatJid}`, JSON.stringify(entry));
        await client.ltrim(`mutes:log:${chatJid}`, 0, 499);
        return `r${now}-${userJid}`;
      } catch (e) {
        logger.debug({ err: e, chatJid, userJid }, 'recordMute failed');
        return null;
      }
    },
    async markMuteUnmuted(chatJid, userJid) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const existed = await client.hdel(`mutes:${chatJid}`, userJid);
        const head = await client.lindex(`mutes:log:${chatJid}`, 0);
        if (head) {
          try {
            const e = JSON.parse(head);
            if (e.user_jid === userJid && e.unmuted_at == null) {
              e.unmuted_at = now;
              await client.lset(`mutes:log:${chatJid}`, 0, JSON.stringify(e));
            }
          } catch (_) {
            /* skip malformed */
          }
        }
        return (existed || 0) > 0;
      } catch (e) {
        logger.debug({ err: e, chatJid, userJid }, 'markMuteUnmuted failed');
        return false;
      }
    },
    async getActiveMutes() {
      try {
        const now = Math.floor(Date.now() / 1000);
        const out = [];
        let cursor = '0';
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', 'mutes:*', 'COUNT', 100);
          cursor = next;
          for (const k of keys) {
            if (k.startsWith('mutes:log:')) continue;
            const chatJid = k.slice('mutes:'.length);
            const map = await client.hgetall(k);
            for (const [userJid, expStr] of Object.entries(map || {})) {
              const expires = Number(expStr) || 0;
              if (expires <= now) continue;
              out.push({
                id: `r-${chatJid}-${userJid}`,
                chat_jid: chatJid,
                user_jid: userJid,
                created_at: 0,
                expires_at: expires,
                by_jid: null,
                reason: null,
              });
            }
          }
        } while (cursor !== '0');
        return out;
      } catch (e) {
        logger.debug({ err: e }, 'getActiveMutes failed');
        return [];
      }
    },
    async getMuteHistoryByChat(chatJid, limit = 100) {
      try {
        const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
        const raw = await client.lrange(`mutes:log:${chatJid}`, 0, cap - 1);
        const out = [];
        for (let i = 0; i < raw.length; i++) {
          try {
            const e = JSON.parse(raw[i]);
            out.push({
              id: `r${i}`,
              chat_jid: e.chat_jid,
              user_jid: e.user_jid,
              created_at: Number(e.created_at) || 0,
              expires_at: Number(e.expires_at) || 0,
              by_jid: e.by_jid,
              reason: e.reason,
              unmuted_at: e.unmuted_at == null ? null : Number(e.unmuted_at),
            });
          } catch (_) {
            /* skip malformed */
          }
        }
        return out;
      } catch (e) {
        logger.debug({ err: e, chatJid }, 'getMuteHistoryByChat failed');
        return [];
      }
    },
    async getMuteHistoryByUser(_userJid, _limit) {
      // Redis layout is chat-keyed; per-user history would require a full scan.
      // Dashboard falls back gracefully on the empty array.
      return [];
    },

    client,
    close() {
      client.quit();
    },
  };
}

module.exports = { makeRedisStore };
