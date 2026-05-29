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

const mongoose  = require('mongoose');
const { proto } = require('@whiskeysockets/baileys');

function makeMongoStore(uri, logger, groupCache) {
  const conn = mongoose.createConnection(uri);

  // ── Models ─────────────────────────────────────────────────────────────
  const Message = conn.model('Message', new mongoose.Schema({
    jid: String, id: String, from_me: Boolean, participant: String,
    msg: Buffer, ts: Number,
  }).index({ jid: 1, id: 1 }, { unique: true }));

  const Chat = conn.model('Chat', new mongoose.Schema({
    jid: { type: String, unique: true }, name: String, unread: Number, ts: Number,
  }));

  const Contact = conn.model('Contact', new mongoose.Schema({
    jid: { type: String, unique: true }, name: String, notify: String, img_url: String,
  }));

  const Group = conn.model('Group', new mongoose.Schema({
    jid: { type: String, unique: true }, subject: String, creation: Number, meta: Object,
  }));

  const Stat = conn.model('Stat', new mongoose.Schema({
    key: { type: String, unique: true },
    value: { type: Number, default: 0 },
  }));

  const Gauge = conn.model('Gauge', new mongoose.Schema({
    key: { type: String, unique: true },
    value: { type: Number, default: 0 },
    updated_at: { type: Number, default: 0 },
  }));

  const ParticipantEvent = conn.model('ParticipantEvent', new mongoose.Schema({
    group_jid:   { type: String, index: true },
    participant: { type: String, index: true },
    action:      String,
    actor:       String,
    ts:          { type: Number, index: true },
  }));

  return {
    // ── Retry-decryption hook ──────────────────────────────────────────
    async getMessage(key) {
      const doc = await Message.findOne({ jid: key.remoteJid, id: key.id });
      return doc ? proto.Message.decode(doc.msg) : undefined;
    },

    // ── Groups ─────────────────────────────────────────────────────────
    async getGroupMetadata(jid) {
      const mem = groupCache.get(jid);
      if (mem) return mem;
      const doc = await Group.findOne({ jid });
      if (!doc) return undefined;
      groupCache.set(jid, doc.meta);
      return doc.meta;
    },

    async saveGroupMetadata(jid, meta) {
      groupCache.set(jid, meta);
      await Group.updateOne({ jid },
        { jid, subject: meta.subject, creation: meta.creation, meta },
        { upsert: true });
    },

    // ── Participants event-log ─────────────────────────────────────────
    async recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        await ParticipantEvent.create({
          group_jid: groupJid, participant, action, actor: actor || null,
          ts: ts ?? Math.floor(Date.now() / 1000),
        });
      } catch (e) { logger.warn({ err: e }, 'participant event insert failed'); }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        const docs = await ParticipantEvent.find({ group_jid: groupJid })
          .sort({ ts: -1 }).limit(limit).lean();
        return docs.map((d) => ({
          participant: d.participant, action: d.action, actor: d.actor, ts: d.ts,
        }));
      } catch (e) { logger.warn({ err: e }, 'history query failed'); return []; }
    },

    async getCurrentParticipants(groupJid) {
      try {
        const docs = await ParticipantEvent.aggregate([
          { $match: { group_jid: groupJid } },
          { $sort:  { ts: -1 } },
          { $group: {
              _id: '$participant',
              last_action: { $first: '$action' },
              last_ts:     { $first: '$ts' },
            },
          },
          { $match: { last_action: { $nin: ['leave', 'kick', 'reject'] } } },
        ]);
        return docs.map((d) => ({
          participant: d._id, last_action: d.last_action, last_ts: d.last_ts,
        }));
      } catch (e) { logger.warn({ err: e }, 'current participants query failed'); return []; }
    },

    // ── Stats: counters ────────────────────────────────────────────────
    recordStat(key, inc = 1) {
      Stat.updateOne({ key }, { $inc: { value: inc } }, { upsert: true })
        .catch((e) => logger.warn({ err: e, key }, 'recordStat failed'));
    },

    async getStats() {
      try {
        const docs = await Stat.find({}).lean();
        return docs.reduce((acc, d) => (acc[d.key] = d.value, acc), {});
      } catch { return {}; }
    },

    // ── Stats: gauges ──────────────────────────────────────────────────
    setGauge(key, value) {
      Gauge.updateOne(
        { key },
        { key, value, updated_at: Math.floor(Date.now() / 1000) },
        { upsert: true },
      ).catch((e) => logger.warn({ err: e, key }, 'setGauge failed'));
    },

    async getGauges() {
      try {
        const docs = await Gauge.find({}).lean();
        return docs.reduce((acc, d) => (acc[d.key] = d.value, acc), {});
      } catch { return {}; }
    },

    // ── Derived counts ─────────────────────────────────────────────────
    async countGroups() { try { return await Group.countDocuments(); } catch { return 0; } },
    async countUniqueUsers() {
      try {
        const r = await ParticipantEvent.distinct('participant');
        return r.length;
      } catch { return 0; }
    },

    // ── Bind to Baileys events ─────────────────────────────────────────
    bind(ev) {
      ev.on('messages.upsert', async ({ messages }) => {
        const ops = [];
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          const msgBuf = Buffer.from(proto.Message.encode(m.message).finish());
          ops.push({
            updateOne: {
              filter: { jid: m.key.remoteJid, id: m.key.id },
              update: {
                jid: m.key.remoteJid, id: m.key.id,
                from_me: !!m.key.fromMe, participant: m.key.participant,
                msg: msgBuf, ts: Number(m.messageTimestamp),
              },
              upsert: true,
            },
          });
        }
        if (ops.length) Message.bulkWrite(ops).catch(() => {});
      });

      ev.on('chats.upsert', async (chats) => {
        const ops = chats.map((c) => ({
          updateOne: {
            filter: { jid: c.id },
            update: {
              jid: c.id, name: c.name ?? null,
              unread: Number(c.unreadCount) || 0,
              ts: Number(c.conversationTimestamp) || Math.floor(Date.now() / 1000),
            },
            upsert: true,
          },
        }));
        if (ops.length) Chat.bulkWrite(ops).catch(() => {});
      });

      ev.on('contacts.upsert', async (contacts) => {
        const ops = contacts.map((c) => ({
          updateOne: {
            filter: { jid: c.id },
            update: { jid: c.id, name: c.name, notify: c.notify, img_url: c.imgUrl },
            upsert: true,
          },
        }));
        if (ops.length) Contact.bulkWrite(ops).catch(() => {});
      });

      ev.on('groups.upsert', (groups) => {
        for (const g of groups) this.saveGroupMetadata(g.id, g);
      });
    },

    close() { conn.close(); },
  };
}

module.exports = { makeMongoStore };
