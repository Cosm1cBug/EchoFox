/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('../lib/configLoader');
const mongoose  = require('mongoose');
const { makeBatcher } = require('../lib/backpressure');
const { proto } = require('@whiskeysockets/baileys');

function makeMongoStore(uri, logger, groupCache) {
  const conn = mongoose.createConnection(uri, {
    maxPoolSize:               20,
    serverSelectionTimeoutMS:  5_000,
    socketTimeoutMS:           45_000,
    heartbeatFrequencyMS:      10_000,
  });
  conn.on('error', (e) => logger.error({ err: e }, 'mongo connection error'));

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

  const MessageEdit = conn.model('MessageEdit', new mongoose.Schema({
    jid:        { type: String, index: true },
    message_id: { type: String, index: true },
    editor:     String,
    old_body:   String,
    new_body:   String,
    ts:         { type: Number, index: true },
  }));

  const MessageReaction = conn.model('MessageReaction', new mongoose.Schema({
    jid:        { type: String, index: true },
    message_id: { type: String, index: true },
    reactor:    String,
    emoji:      String,
    ts:         { type: Number, index: true },
  }));

  const MessageReceipt = conn.model('MessageReceipt', new mongoose.Schema({
    jid:        String,
    message_id: String,
    recipient:  String,
    status:     Number,
    ts:         Number,
  }).index({ jid: 1, message_id: 1, recipient: 1 }, { unique: true }));

  const ServiceSubscriber = conn.model('ServiceSubscriber', new mongoose.Schema({
    service:            { type: String, required: true },
    jid:                { type: String, required: true },
    last_seen_pulse_ts: { type: Number, default: null },
    meta:               { type: mongoose.Schema.Types.Mixed, default: null },
  }).index({ service: 1, jid: 1 }, { unique: true }).index({ service: 1 }));

  const SentArticle = conn.model('SentArticle', new mongoose.Schema({
    service:     { type: String, required: true },
    jid:         { type: String, required: true },
    article_url: { type: String, required: true },
    sent_at:     { type: Number, required: true },
  }).index({ service: 1, jid: 1, article_url: 1 }, { unique: true }));

  const batchCfg = config.processing?.messageBatch || {};
  const messageBatcher = makeBatcher({
    name: 'mongo-messages',
    maxBatch:      batchCfg.maxBatch      ?? 100,
    maxWaitMs:     batchCfg.maxWaitMs     ?? 250,
    maxBufferSize: batchCfg.maxBufferSize ?? 5_000,
    onDrop: (n) => logger.warn({ dropped: n }, 'mongo message batcher overflow'),
    flush: async (ops) => {
      if (!ops.length) return;
      try {
        await Message.bulkWrite(ops, { ordered: false });
      } catch (e) {
        logger.warn({ err: e, ops: ops.length }, 'mongo batched bulkWrite failed');
      }
    },
  });

  return {
    async getMessage(key) {
      const doc = await Message.findOne({ jid: key.remoteJid, id: key.id });
      return doc ? proto.Message.decode(doc.msg) : undefined;
    },

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

    async listGroups() {
      try {
        const docs = await Group.find({}).sort({ subject: 1 }).lean();
        return docs.map((g) => ({
          jid:              g.jid,
          subject:          g.subject || g.meta?.subject || '(unnamed)',
          participantCount: g.meta?.participants?.length || 0,
        }));
      } catch { return []; }
    },

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

    async countGroups() { try { return await Group.countDocuments(); } catch { return 0; } },
    async countUniqueUsers() {
      try {
        const r = await ParticipantEvent.distinct('participant');
        return r.length;
      } catch { return 0; }
    },

    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded    = new Set(config.privacy?.excludeFromStore || []);
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          const msgBuf = storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null;
          messageBatcher.push({
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

    // ── Edits ──────────────────────────────────────────────────────────
    async recordMessageEdit(jid, messageId, editor, oldBody, newBody, ts) {
      try {
        await MessageEdit.create({
          jid, message_id: messageId,
          editor: editor || null,
          old_body: oldBody || '',
          new_body: newBody || '',
          ts: ts ?? Math.floor(Date.now()/1000),
        });
      } catch (e) { logger.warn({err:e}, 'edit insert failed'); }
    },
    async getMessageEdits(jid, messageId) {
      try {
        const docs = await MessageEdit.find({ jid, message_id: messageId }).sort({ ts: 1 }).lean();
        return docs.map((d) => ({
          editor: d.editor, old_body: d.old_body, new_body: d.new_body, ts: d.ts,
        }));
      } catch (e) { logger.warn({err:e}, 'edits query failed'); return []; }
    },
    async updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        await Message.updateOne(
          { jid, id: messageId },
          { $set: { msg: buf, ts: ts ?? Math.floor(Date.now()/1000) } });
      } catch (e) { logger.warn({err:e}, 'updateMessageBody failed'); }
    },

    // ── Reactions ──────────────────────────────────────────────────────
    async recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      try {
        await MessageReaction.create({
          jid, message_id: messageId,
          reactor: reactor || '',
          emoji:   emoji   || null,
          ts: ts ?? Math.floor(Date.now()/1000),
        });
      } catch (e) { logger.warn({err:e}, 'reaction insert failed'); }
    },
    async getMessageReactions(jid, messageId) {
      try {
        const docs = await MessageReaction.find({ jid, message_id: messageId }).sort({ ts: 1 }).lean();
        return docs.map((d) => ({ reactor: d.reactor, emoji: d.emoji, ts: d.ts }));
      } catch (e) { logger.warn({err:e}, 'reactions query failed'); return []; }
    },

    // ── Receipts ───────────────────────────────────────────────────────
    async recordReceipt(jid, messageId, recipient, status, ts) {
      try {
        // Use upsert + $max so we never downgrade (e.g. read → delivered)
        await MessageReceipt.updateOne(
          { jid, message_id: messageId, recipient },
          { $max: { status }, $set: { ts: ts ?? Math.floor(Date.now()/1000) } },
          { upsert: true });
      } catch (e) { logger.warn({err:e}, 'receipt upsert failed'); }
    },
    async getMessageReceipts(jid, messageId) {
      try {
        const docs = await MessageReceipt.find({ jid, message_id: messageId }).sort({ ts: 1 }).lean();
        return docs.map((d) => ({ recipient: d.recipient, status: d.status, ts: d.ts }));
      } catch (e) { logger.warn({err:e}, 'receipts query failed'); return []; }
    },

    // ── Deletions ──────────────────────────────────────────────────────
    async markMessageDeleted(jid, messageId, _by, ts) {
      try {
        await Message.updateOne(
          { jid, id: messageId, $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
          { $set: { deleted_at: ts ?? Math.floor(Date.now()/1000) } });
      } catch (e) { logger.warn({err:e}, 'markMessageDeleted failed'); }
    },
    async markChatMessagesDeleted(jid, ts) {
      try {
        await Message.updateMany(
          { jid, $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
          { $set: { deleted_at: ts ?? Math.floor(Date.now()/1000) } });
      } catch (e) { logger.warn({err:e}, 'markChatMessagesDeleted failed'); }
    },
    async getDeletedInGroup(jid, limit = 100) {
      try {
        const docs = await Message.find({ jid, deleted_at: { $ne: null } })
          .sort({ deleted_at: -1 }).limit(limit).lean();
        return docs.map((d) => ({ id: d.id, participant: d.participant, deleted_at: d.deleted_at }));
      } catch (e) { logger.warn({err:e}, 'deletedInGroup failed'); return []; }
    },

    // ── Aggregate status ───────────────────────────────────────────────
    async updateMessageStatus(jid, messageId, status, _ts) {
      try {
        await Message.updateOne(
          { jid, id: messageId },
          { $max: { status: Number(status) } });
      } catch (e) { logger.warn({err:e}, 'updateMessageStatus failed'); }
    },

    async getSubscribers(service) {
      try {
        const docs = await ServiceSubscriber.find({ service }).lean();
        return docs.map((d) => ({
          jid: d.jid,
          last_seen_pulse_ts: d.last_seen_pulse_ts == null ? null : Number(d.last_seen_pulse_ts),
          meta: d.meta || null,
        }));
      } catch (e) { logger.warn({ err: e, service }, 'getSubscribers failed'); return []; }
    },
    async addSubscriber(service, jid, meta) {
      try {
        await ServiceSubscriber.updateOne(
          { service, jid },
          { $setOnInsert: {
              service, jid, last_seen_pulse_ts: null,
              meta: meta == null ? null : meta,
          } },
          { upsert: true });
      } catch (e) { logger.warn({ err: e, service, jid }, 'addSubscriber failed'); }
    },
    async removeSubscriber(service, jid) {
      try {
        await ServiceSubscriber.deleteOne({ service, jid });
      } catch (e) { logger.warn({ err: e, service, jid }, 'removeSubscriber failed'); }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try {
        await ServiceSubscriber.updateOne(
          { service, jid },
          { $set: { last_seen_pulse_ts: ts } });
      } catch (e) { logger.warn({ err: e }, 'updateSubscriberTimestamp failed'); }
    },
        async isSubscriber(service, jid) {
      try {
        const doc = await ServiceSubscriber.findOne({ service, jid }, { _id: 1 }).lean();
        return !!doc;
      } catch { return false; }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const doc = await ServiceSubscriber.findOne({ service, jid }, { meta: 1 }).lean();
        if (!doc) return null;
        return doc.meta || null;
      } catch { return null; }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        await ServiceSubscriber.updateOne(
          { service, jid },
          { $set: { meta: meta == null ? null : meta } });
      } catch (e) { logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed'); }
    },
    async hasSentArticle(service, jid, articleUrl) {
      try {
        const doc = await SentArticle.findOne(
          { service, jid, article_url: articleUrl },
          { _id: 1 }).lean();
        return !!doc;
      } catch { return false; }
    },
    async recordSentArticle(service, jid, articleUrl) {
      try {
        await SentArticle.updateOne(
          { service, jid, article_url: articleUrl },
          { $setOnInsert: {
              service, jid, article_url: articleUrl,
              sent_at: Math.floor(Date.now() / 1000),
          } },
          { upsert: true });
      } catch (e) { logger.warn({ err: e, service, jid }, 'recordSentArticle failed'); }
    },

    conn,
    async close() {
      try { 
        await messageBatcher.drain(); 
      }
      catch (e) { 
        logger.warn({ err: e }, 'mongo batcher drain failed'); 
      }
      conn.close();
    },
  };
}

module.exports = { makeMongoStore };