/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('../lib/configLoader');
const mongoose = require('mongoose');
const { makeBatcher } = require('../lib/backpressure');
const { proto } = require('@whiskeysockets/baileys');

function makeMongoStore(uri, logger, groupCache) {
  const conn = mongoose.createConnection(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS: 45_000,
    heartbeatFrequencyMS: 10_000,
  });
  conn.on('error', (e) => logger.error({ err: e }, 'mongo connection error'));

  const Message = conn.model(
    'Message',
    new mongoose.Schema({
      jid: String,
      id: String,
      from_me: Boolean,
      participant: String,
      msg: Buffer,
      ts: Number,
    }).index({ jid: 1, id: 1 }, { unique: true }),
  );

  const Chat = conn.model(
    'Chat',
    new mongoose.Schema({
      jid: { type: String, unique: true },
      name: String,
      unread: Number,
      ts: Number,
    }),
  );

  const Contact = conn.model(
    'Contact',
    new mongoose.Schema({
      jid: { type: String, unique: true },
      name: String,
      notify: String,
      img_url: String,
    }),
  );

  const Group = conn.model(
    'Group',
    new mongoose.Schema({
      jid: { type: String, unique: true },
      subject: String,
      creation: Number,
      meta: Object,
    }),
  );

  const Stat = conn.model(
    'Stat',
    new mongoose.Schema({
      key: { type: String, unique: true },
      value: { type: Number, default: 0 },
    }),
  );

  const Gauge = conn.model(
    'Gauge',
    new mongoose.Schema({
      key: { type: String, unique: true },
      value: { type: Number, default: 0 },
      updated_at: { type: Number, default: 0 },
    }),
  );

  const ParticipantEvent = conn.model(
    'ParticipantEvent',
    new mongoose.Schema({
      group_jid: { type: String, index: true },
      participant: { type: String, index: true },
      action: String,
      actor: String,
      ts: { type: Number, index: true },
    }),
  );

  const MessageEdit = conn.model(
    'MessageEdit',
    new mongoose.Schema({
      jid: { type: String, index: true },
      message_id: { type: String, index: true },
      editor: String,
      old_body: String,
      new_body: String,
      ts: { type: Number, index: true },
    }),
  );

  const MessageReaction = conn.model(
    'MessageReaction',
    new mongoose.Schema({
      jid: { type: String, index: true },
      message_id: { type: String, index: true },
      reactor: String,
      emoji: String,
      ts: { type: Number, index: true },
    }),
  );

  const MessageReceipt = conn.model(
    'MessageReceipt',
    new mongoose.Schema({
      jid: String,
      message_id: String,
      recipient: String,
      status: Number,
      ts: Number,
    }).index({ jid: 1, message_id: 1, recipient: 1 }, { unique: true }),
  );

  const ServiceSubscriber = conn.model(
    'ServiceSubscriber',
    new mongoose.Schema({
      service: { type: String, required: true },
      jid: { type: String, required: true },
      last_seen_pulse_ts: { type: Number, default: null },
      meta: { type: mongoose.Schema.Types.Mixed, default: null },
    })
      .index({ service: 1, jid: 1 }, { unique: true })
      .index({ service: 1 }),
  );

  const SentItem = conn.model(
    'SentItem',
    new mongoose.Schema({
      service: { type: String, required: true },
      jid: { type: String, required: true },
      item_url: { type: String, required: true },
      sent_at: { type: Number, required: true },
    }).index({ service: 1, jid: 1, item_url: 1 }, { unique: true }),
  );

  const batchCfg = config.processing?.messageBatch || {};
  const messageBatcher = makeBatcher({
    name: 'mongo-messages',
    maxBatch: batchCfg.maxBatch ?? 100,
    maxWaitMs: batchCfg.maxWaitMs ?? 250,
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
    async hasContact(jid) {
      try {
        const count = await this.db.collection('contacts').countDocuments({ jid }, { limit: 1 });
        return count > 0;
      } catch (e) {
        logger.warn({ err: e, jid }, 'hasContact failed');
        return false;
      }
    },

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
      await Group.updateOne(
        { jid },
        { jid, subject: meta.subject, creation: meta.creation, meta },
        { upsert: true },
      );
    },

    async recordParticipantEvent(groupJid, participant, action, actor, ts) {
      try {
        await ParticipantEvent.create({
          group_jid: groupJid,
          participant,
          action,
          actor: actor || null,
          ts: ts ?? Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        logger.warn({ err: e }, 'participant event insert failed');
      }
    },

    async getParticipantHistory(groupJid, limit = 500) {
      try {
        const docs = await ParticipantEvent.find({ group_jid: groupJid })
          .sort({ ts: -1 })
          .limit(limit)
          .lean();
        return docs.map((d) => ({
          participant: d.participant,
          action: d.action,
          actor: d.actor,
          ts: d.ts,
        }));
      } catch (e) {
        logger.warn({ err: e }, 'history query failed');
        return [];
      }
    },

    async getCurrentParticipants(groupJid) {
      try {
        const docs = await ParticipantEvent.aggregate([
          { $match: { group_jid: groupJid } },
          { $sort: { ts: -1 } },
          {
            $group: {
              _id: '$participant',
              last_action: { $first: '$action' },
              last_ts: { $first: '$ts' },
            },
          },
          { $match: { last_action: { $nin: ['leave', 'kick', 'reject'] } } },
        ]);
        return docs.map((d) => ({
          participant: d._id,
          last_action: d.last_action,
          last_ts: d.last_ts,
        }));
      } catch (e) {
        logger.warn({ err: e }, 'current participants query failed');
        return [];
      }
    },

    async listGroups() {
      try {
        const docs = await Group.find({}).sort({ subject: 1 }).lean();
        return docs.map((g) => ({
          jid: g.jid,
          subject: g.subject || g.meta?.subject || '(unnamed)',
          participantCount: g.meta?.participants?.length || 0,
        }));
      } catch {
        return [];
      }
    },

    // labels ─────────────────────────────────────────
    async upsertLabel(labelId, name, color) {
      try {
        if (!labelId || !name) return;
        await conn.collection('labels').updateOne(
          { label_id: labelId },
          {
            $set: { name, color: color ?? null, deleted: 0, updated_at: Date.now() },
            $setOnInsert: { label_id: labelId },
          },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, labelId }, 'upsertLabel failed');
      }
    },
    async deleteLabel(labelId) {
      try {
        await conn
          .collection('labels')
          .updateOne({ label_id: labelId }, { $set: { deleted: 1, updated_at: Date.now() } });
      } catch (e) {
        logger.warn({ err: e, labelId }, 'deleteLabel failed');
      }
    },
    async getLabel(labelId) {
      try {
        return await conn
          .collection('labels')
          .findOne({ label_id: labelId }, { projection: { _id: 0 } });
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabel failed');
        return null;
      }
    },
    async listLabels() {
      try {
        return await conn
          .collection('labels')
          .find({ deleted: { $in: [0, false, null] } }, { projection: { _id: 0 } })
          .sort({ name: 1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'listLabels failed');
        return [];
      }
    },
    async associateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        await conn.collection('label_associations').updateOne(
          {
            label_id: labelId,
            target_type: targetType,
            target_jid: targetJid,
            target_msg_id: targetMsgId || '',
          },
          { $setOnInsert: { associated_at: Date.now() } },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'associateLabel failed');
      }
    },
    async disassociateLabel(labelId, targetType, targetJid, targetMsgId = null) {
      try {
        await conn.collection('label_associations').deleteOne({
          label_id: labelId,
          target_type: targetType,
          target_jid: targetJid,
          target_msg_id: targetMsgId || '',
        });
      } catch (e) {
        logger.warn({ err: e, labelId, targetJid }, 'disassociateLabel failed');
      }
    },
    async getLabelAssociations(labelId) {
      try {
        return await conn
          .collection('label_associations')
          .find({ label_id: labelId }, { projection: { _id: 0 } })
          .toArray();
      } catch (e) {
        logger.warn({ err: e, labelId }, 'getLabelAssociations failed');
        return [];
      }
    },
    async getLabelsForTarget(targetJid) {
      try {
        const assocs = await conn
          .collection('label_associations')
          .find({ target_jid: targetJid }, { projection: { _id: 0, label_id: 1 } })
          .toArray();
        if (!assocs.length) return [];
        const labelIds = assocs.map((a) => a.label_id);
        return await conn
          .collection('labels')
          .find(
            { label_id: { $in: labelIds }, deleted: { $in: [0, false, null] } },
            { projection: { _id: 0, label_id: 1, name: 1, color: 1 } },
          )
          .toArray();
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
        const update = { updated_at: ts };
        if (m.name != null) update.name = m.name;
        if (m.description != null) update.description = m.description;
        if (m.picture_url ?? m.pictureUrl) update.picture_url = m.picture_url ?? m.pictureUrl;
        if (m.verification != null) update.verification = m.verification;
        if (m.subscribers != null) update.subscribers = m.subscribers;
        if (m.raw != null) update.meta = m.raw;
        await conn.collection('newsletters').updateOne(
          { newsletter_id: newsletterId },
          {
            $set: update,
            $setOnInsert: { newsletter_id: newsletterId, created_at: m.created_at ?? ts },
          },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'upsertNewsletter failed');
      }
    },
    async updateNewsletter(newsletterId, partial = {}) {
      return this.upsertNewsletter(newsletterId, partial);
    },
    async getNewsletter(newsletterId) {
      try {
        return await conn
          .collection('newsletters')
          .findOne({ newsletter_id: newsletterId }, { projection: { _id: 0 } });
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletter failed');
        return null;
      }
    },
    async listNewsletters() {
      try {
        return await conn
          .collection('newsletters')
          .find({}, { projection: { _id: 0, meta: 0 } })
          .sort({ updated_at: -1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'listNewsletters failed');
        return [];
      }
    },
    async incrementNewsletterView(newsletterId, messageId) {
      try {
        await conn
          .collection('newsletter_views')
          .updateOne(
            { newsletter_id: newsletterId, message_id: messageId },
            { $inc: { view_count: 1 }, $set: { updated_at: Date.now() } },
            { upsert: true },
          );
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'incrementNewsletterView failed');
      }
    },
    async getNewsletterViews(newsletterId, messageId, limit = 100) {
      try {
        const q = messageId
          ? { newsletter_id: newsletterId, message_id: messageId }
          : { newsletter_id: newsletterId };
        return await conn
          .collection('newsletter_views')
          .find(q, { projection: { _id: 0, message_id: 1, view_count: 1, updated_at: 1 } })
          .sort({ updated_at: -1 })
          .limit(limit)
          .toArray();
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletterViews failed');
        return [];
      }
    },
    async recordNewsletterReaction(newsletterId, messageId, emoji, count = 1) {
      try {
        await conn.collection('newsletter_reactions').insertOne({
          newsletter_id: newsletterId,
          message_id: messageId,
          emoji: emoji || null,
          count: count || 1,
          recorded_at: Date.now(),
        });
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'recordNewsletterReaction failed');
      }
    },
    async getNewsletterReactions(newsletterId, messageId) {
      try {
        return await conn
          .collection('newsletter_reactions')
          .aggregate([
            { $match: { newsletter_id: newsletterId, message_id: messageId } },
            {
              $group: {
                _id: '$emoji',
                total: { $sum: '$count' },
                last_seen: { $max: '$recorded_at' },
              },
            },
            { $project: { _id: 0, emoji: '$_id', total: 1, last_seen: 1 } },
            { $sort: { total: -1 } },
          ])
          .toArray();
      } catch (e) {
        logger.warn({ err: e, newsletterId, messageId }, 'getNewsletterReactions failed');
        return [];
      }
    },
    async updateNewsletterSettings(newsletterId, settings = {}) {
      try {
        await conn.collection('newsletter_settings').updateOne(
          { newsletter_id: newsletterId },
          {
            $set: { settings_json: settings || {}, updated_at: Date.now() },
            $setOnInsert: { newsletter_id: newsletterId },
          },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'updateNewsletterSettings failed');
      }
    },
    async getNewsletterSettings(newsletterId) {
      try {
        const r = await conn
          .collection('newsletter_settings')
          .findOne(
            { newsletter_id: newsletterId },
            { projection: { _id: 0, settings_json: 1, updated_at: 1 } },
          );
        return r ? { settings: r.settings_json || {}, updated_at: r.updated_at } : null;
      } catch (e) {
        logger.warn({ err: e, newsletterId }, 'getNewsletterSettings failed');
        return null;
      }
    },

    // lid-mapping ────────────────────────────────────
    async setLidMapping(lid, jid) {
      try {
        if (!lid || !jid) return;
        await conn
          .collection('lid_mapping')
          .updateOne(
            { lid },
            { $set: { jid, updated_at: Date.now() }, $setOnInsert: { lid } },
            { upsert: true },
          );
      } catch (e) {
        logger.warn({ err: e, lid, jid }, 'setLidMapping failed');
      }
    },
    async getLidMapping(lid) {
      try {
        const r = await conn
          .collection('lid_mapping')
          .findOne({ lid }, { projection: { _id: 0, jid: 1 } });
        return r?.jid || null;
      } catch (e) {
        logger.warn({ err: e, lid }, 'getLidMapping failed');
        return null;
      }
    },
    async getReverseLidMapping(jid) {
      try {
        const r = await conn
          .collection('lid_mapping')
          .findOne({ jid }, { projection: { _id: 0, lid: 1 } });
        return r?.lid || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getReverseLidMapping failed');
        return null;
      }
    },

    // message-capping ────────────────────────────────
    async setMessageCap(jid, capValue) {
      try {
        if (!jid || capValue == null) return;
        await conn.collection('message_capping').updateOne(
          { jid },
          {
            $set: { cap_value: Number(capValue), updated_at: Date.now() },
            $setOnInsert: { jid },
          },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, jid }, 'setMessageCap failed');
      }
    },
    async getMessageCap(jid) {
      try {
        const r = await conn
          .collection('message_capping')
          .findOne({ jid }, { projection: { _id: 0, cap_value: 1, updated_at: 1 } });
        return r || null;
      } catch (e) {
        logger.warn({ err: e, jid }, 'getMessageCap failed');
        return null;
      }
    },

    // blocklist ───────────────────────────────────────────────
    async setBlocklist(jids) {
      try {
        if (!Array.isArray(jids)) return;
        const coll = conn.collection('blocklist');
        await coll.deleteMany({});
        if (jids.length) {
          const ts = Date.now();
          await coll
            .insertMany(
              jids.filter(Boolean).map((jid) => ({ jid, added_at: ts })),
              { ordered: false },
            )
            .catch(() => {});
        }
      } catch (e) {
        logger.warn({ err: e }, 'setBlocklist failed');
      }
    },
    async addToBlocklist(jid) {
      try {
        await conn
          .collection('blocklist')
          .updateOne({ jid }, { $setOnInsert: { jid, added_at: Date.now() } }, { upsert: true });
      } catch (e) {
        logger.warn({ err: e, jid }, 'addToBlocklist failed');
      }
    },
    async removeFromBlocklist(jid) {
      try {
        await conn.collection('blocklist').deleteOne({ jid });
      } catch (e) {
        logger.warn({ err: e, jid }, 'removeFromBlocklist failed');
      }
    },
    async getBlocklist() {
      try {
        return await conn
          .collection('blocklist')
          .find({}, { projection: { _id: 0, jid: 1, added_at: 1 } })
          .sort({ added_at: -1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'getBlocklist failed');
        return [];
      }
    },
    async isBlocked(jid) {
      try {
        return !!(await conn.collection('blocklist').findOne({ jid }));
      } catch (e) {
        logger.warn({ err: e, jid }, 'isBlocked failed');
        return false;
      }
    },

    // presence ────────────────────────────────────────────────
    async recordPresence(jid, state, lastSeenTs, chatJid) {
      try {
        const update = {
          last_state: state || null,
          chat_jid: chatJid || null,
          updated_at: Date.now(),
        };
        if (lastSeenTs != null) update.last_seen_ts = lastSeenTs;
        await conn
          .collection('presence')
          .updateOne({ jid }, { $set: update, $setOnInsert: { jid } }, { upsert: true });
      } catch (e) {
        logger.warn({ err: e, jid }, 'recordPresence failed');
      }
    },
    async getPresence(jid) {
      try {
        return await conn.collection('presence').findOne({ jid }, { projection: { _id: 0 } });
      } catch (e) {
        logger.warn({ err: e, jid }, 'getPresence failed');
        return null;
      }
    },
    async getPresenceInChat(chatJid) {
      try {
        return await conn
          .collection('presence')
          .find({ chat_jid: chatJid }, { projection: { _id: 0 } })
          .sort({ updated_at: -1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'getPresenceInChat failed');
        return [];
      }
    },
    async getRecentPresence(limit = 50) {
      try {
        return await conn
          .collection('presence')
          .find({}, { projection: { _id: 0 } })
          .sort({ updated_at: -1 })
          .limit(limit)
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'getRecentPresence failed');
        return [];
      }
    },

    // chat state ──────────────────────────────────────────────
    async updateChat(jid, partial) {
      try {
        if (!jid) return;
        const update = {};
        for (const k of ['name', 'unread', 'ts', 'pinned', 'muted_until', 'archived']) {
          if (partial?.[k] != null) {
            update[k] = k === 'pinned' || k === 'archived' ? (partial[k] ? 1 : 0) : partial[k];
          }
        }
        if (Object.keys(update).length) {
          await conn
            .collection('chats')
            .updateOne({ jid }, { $set: update, $setOnInsert: { jid } }, { upsert: true });
        }
      } catch (e) {
        logger.warn({ err: e, jid }, 'updateChat failed');
      }
    },
    async markChatDeleted(jid) {
      try {
        await conn.collection('chats').updateOne({ jid }, { $set: { deleted_at: Date.now() } });
      } catch (e) {
        logger.warn({ err: e, jid }, 'markChatDeleted failed');
      }
    },
    async listChats() {
      try {
        return await conn
          .collection('chats')
          .find({}, { projection: { _id: 0 } })
          .sort({ ts: -1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'listChats failed');
        return [];
      }
    },
    async getChat(jid) {
      try {
        return await conn.collection('chats').findOne({ jid }, { projection: { _id: 0 } });
      } catch (e) {
        logger.warn({ err: e, jid }, 'getChat failed');
        return null;
      }
    },

    // contacts (bulk + extended) ─────────────────────────────
    async bulkUpsertContacts(contacts) {
      try {
        if (!Array.isArray(contacts) || !contacts.length) return 0;
        const ops = contacts
          .filter((c) => c?.id)
          .map((c) => ({
            updateOne: {
              filter: { jid: c.id },
              update: {
                $set: {
                  ...(c.name != null && { name: c.name }),
                  ...(c.notify != null && { notify: c.notify }),
                  ...(c.imgUrl != null && { img_url: c.imgUrl }),
                  ...(c.status != null && { status: c.status }),
                  ...(c.verifiedName != null && { verified_name: c.verifiedName }),
                },
                $setOnInsert: { jid: c.id },
              },
              upsert: true,
            },
          }));
        if (!ops.length) return 0;
        const r = await conn.collection('contacts').bulkWrite(ops, { ordered: false });
        return (r.upsertedCount || 0) + (r.modifiedCount || 0);
      } catch (e) {
        logger.warn({ err: e }, 'bulkUpsertContacts failed');
        return 0;
      }
    },
    async getContact(jid) {
      try {
        return await conn.collection('contacts').findOne({ jid }, { projection: { _id: 0 } });
      } catch (e) {
        logger.warn({ err: e, jid }, 'getContact failed');
        return null;
      }
    },
    async listContacts({ limit = 100, offset = 0 } = {}) {
      try {
        return await conn
          .collection('contacts')
          .find({}, { projection: { _id: 0 } })
          .sort({ name: 1 })
          .skip(offset)
          .limit(limit)
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'listContacts failed');
        return [];
      }
    },
    async countContacts() {
      try {
        return await conn.collection('contacts').countDocuments();
      } catch (e) {
        logger.warn({ err: e }, 'countContacts failed');
        return 0;
      }
    },

    // v1.2.0 AI ──────────────────────────────────────────────
    async appendAiTurn(chatJid, turn) {
      try {
        await conn.collection('ai_conversations').insertOne({
          chat_jid: chatJid,
          role: String(turn.role || ''),
          content: String(turn.content == null ? '' : turn.content),
          tool_name: turn.toolName || null,
          tool_args: turn.toolArgs
            ? typeof turn.toolArgs === 'string'
              ? turn.toolArgs
              : JSON.stringify(turn.toolArgs)
            : null,
          tool_id: turn.toolId || null,
          model: turn.model || null,
          provider: turn.provider || null,
          prompt_tokens: Number(turn.promptTokens || 0),
          completion_tokens: Number(turn.completionTokens || 0),
          ts: Number(turn.ts || Date.now()),
        });
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'appendAiTurn failed');
        return false;
      }
    },
    async getRecentAiTurns(chatJid, limit = 20) {
      try {
        const rows = await conn
          .collection('ai_conversations')
          .find({ chat_jid: chatJid })
          .sort({ ts: -1 })
          .limit(Number(limit) || 20)
          .toArray();
        return rows.reverse().map((r) => ({
          role: r.role,
          content: r.content,
          toolName: r.tool_name || undefined,
          toolArgs: r.tool_args || undefined,
          toolId: r.tool_id || undefined,
          model: r.model || undefined,
          provider: r.provider || undefined,
          promptTokens: r.prompt_tokens || 0,
          completionTokens: r.completion_tokens || 0,
          ts: Number(r.ts),
        }));
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getRecentAiTurns failed');
        return [];
      }
    },
    async clearAiTurns(chatJid) {
      try {
        await conn.collection('ai_conversations').deleteMany({ chat_jid: chatJid });
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
        await conn.collection('ai_usage_daily').updateOne(
          { day: String(day), provider: String(provider || ''), model: String(model || '') },
          {
            $inc: {
              prompt_tokens: Number(promptTokens) || 0,
              completion_tokens: Number(completionTokens) || 0,
              cost_usd: Number(costUsd) || 0,
              calls: 1,
            },
            $setOnInsert: { created_at: Date.now() },
          },
          { upsert: true },
        );
        return true;
      } catch (e) {
        logger.warn({ err: e }, 'recordAiUsage failed');
        return false;
      }
    },
    async getAiUsageDayTotal(day) {
      try {
        const rows = await conn
          .collection('ai_usage_daily')
          .aggregate([
            { $match: { day: String(day) } },
            { $group: { _id: null, total: { $sum: '$cost_usd' } } },
          ])
          .toArray();
        return Number(rows[0]?.total || 0);
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageDayTotal failed');
        return 0;
      }
    },
    async getAiUsageSince(day) {
      try {
        return await conn
          .collection('ai_usage_daily')
          .find({ day: { $gte: String(day) } })
          .sort({ day: -1, cost_usd: -1 })
          .toArray();
      } catch (e) {
        logger.warn({ err: e }, 'getAiUsageSince failed');
        return [];
      }
    },
    async getAiUsageByDay(limit = 30) {
      try {
        return await conn
          .collection('ai_usage_daily')
          .aggregate([
            {
              $group: {
                _id: '$day',
                cost_usd: { $sum: '$cost_usd' },
                prompt_tokens: { $sum: '$prompt_tokens' },
                completion_tokens: { $sum: '$completion_tokens' },
                calls: { $sum: '$calls' },
              },
            },
            { $sort: { _id: -1 } },
            { $limit: Number(limit) || 30 },
            {
              $project: {
                _id: 0,
                day: '$_id',
                cost_usd: 1,
                prompt_tokens: 1,
                completion_tokens: 1,
                calls: 1,
              },
            },
          ])
          .toArray();
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
        await conn.collection('ai_chat_opt_in').updateOne(
          { chat_jid: chatJid },
          {
            $set: {
              enabled: !!enabled,
              overrides: { persona, provider, model },
              updated_at: Date.now(),
            },
          },
          { upsert: true },
        );
        return true;
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'setAiChatOptIn failed');
        return false;
      }
    },
    async getAiChatOptIn(chatJid) {
      try {
        const r = await conn.collection('ai_chat_opt_in').findOne({ chat_jid: chatJid });
        if (!r) return null;
        const o = r.overrides || {};
        return {
          enabled: !!r.enabled,
          persona: o.persona ?? null,
          provider: o.provider ?? null,
          model: o.model ?? null,
          updatedAt: Number(r.updated_at),
        };
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiChatOptIn failed');
        return null;
      }
    },
    async listAiOptedInChats(limit = 100) {
      try {
        const rows = await conn
          .collection('ai_chat_opt_in')
          .find({})
          .sort({ updated_at: -1 })
          .limit(Number(limit) || 100)
          .toArray();
        return rows.map((r) => {
          const o = r.overrides || {};
          return {
            chatJid: r.chat_jid,
            enabled: !!r.enabled,
            persona: o.persona ?? null,
            provider: o.provider ?? null,
            model: o.model ?? null,
            updatedAt: Number(r.updated_at),
          };
        });
      } catch (e) {
        logger.warn({ err: e }, 'listAiOptedInChats failed');
        return [];
      }
    },

    // v1.3.0 AI persistent rate-limit ────────────────────────
    async incrAiRateUser(userJid, hourBucket) {
      try {
        const exp = (Number(hourBucket) + 2) * 60 * 60 * 1000;
        const r = await conn
          .collection('ai_rate_user')
          .findOneAndUpdate(
            { user_jid: String(userJid), hour_bucket: Number(hourBucket) },
            { $inc: { count: 1 }, $set: { expires_at: new Date(exp) } },
            { upsert: true, returnDocument: 'after' },
          );
        return Number((r && (r.value?.count ?? r.count)) || 1);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'incrAiRateUser failed');
        return 0;
      }
    },
    async getAiRateUser(userJid, hourBucket) {
      try {
        const r = await conn
          .collection('ai_rate_user')
          .findOne({ user_jid: String(userJid), hour_bucket: Number(hourBucket) });
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, userJid }, 'getAiRateUser failed');
        return 0;
      }
    },
    async incrAiRateChat(chatJid, dayBucket) {
      try {
        const exp = (Number(dayBucket) + 2) * 24 * 60 * 60 * 1000;
        const r = await conn
          .collection('ai_rate_chat')
          .findOneAndUpdate(
            { chat_jid: String(chatJid), day_bucket: Number(dayBucket) },
            { $inc: { count: 1 }, $set: { expires_at: new Date(exp) } },
            { upsert: true, returnDocument: 'after' },
          );
        return Number((r && (r.value?.count ?? r.count)) || 1);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'incrAiRateChat failed');
        return 0;
      }
    },
    async getAiRateChat(chatJid, dayBucket) {
      try {
        const r = await conn
          .collection('ai_rate_chat')
          .findOne({ chat_jid: String(chatJid), day_bucket: Number(dayBucket) });
        return Number(r?.count || 0);
      } catch (e) {
        logger.warn({ err: e, chatJid }, 'getAiRateChat failed');
        return 0;
      }
    },
    async pruneAiRate(now = Date.now()) {
      // MongoDB TTL index on expires_at handles this automatically (within ~60s).
      // We still expose this for parity; manual delete here as a belt-and-braces.
      try {
        const cutoff = new Date(Number(now));
        const a = await conn.collection('ai_rate_user').deleteMany({ expires_at: { $lt: cutoff } });
        const b = await conn.collection('ai_rate_chat').deleteMany({ expires_at: { $lt: cutoff } });
        return { users: a.deletedCount || 0, chats: b.deletedCount || 0 };
      } catch (e) {
        logger.warn({ err: e }, 'pruneAiRate failed');
        return { users: 0, chats: 0 };
      }
    },

    recordStat(key, inc = 1) {
      Stat.updateOne({ key }, { $inc: { value: inc } }, { upsert: true }).catch((e) =>
        logger.warn({ err: e, key }, 'recordStat failed'),
      );
    },

    async getStats() {
      try {
        const docs = await Stat.find({}).lean();
        return docs.reduce((acc, d) => ((acc[d.key] = d.value), acc), {});
      } catch {
        return {};
      }
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
        return docs.reduce((acc, d) => ((acc[d.key] = d.value), acc), {});
      } catch {
        return {};
      }
    },

    async countGroups() {
      try {
        return await Group.countDocuments();
      } catch {
        return 0;
      }
    },
    async countUniqueUsers() {
      try {
        const r = await ParticipantEvent.distinct('participant');
        return r.length;
      } catch {
        return 0;
      }
    },

    bind(ev) {
      ev.on('messages.upsert', ({ messages }) => {
        const storeBodies = config.privacy?.storeMessageBodies !== false;
        const excluded = new Set(config.privacy?.excludeFromStore || []);
        for (const m of messages) {
          if (!m?.key?.id || !m?.key?.remoteJid || !m?.message) continue;
          if (excluded.has(m.key.remoteJid)) continue;
          const msgBuf = storeBodies ? Buffer.from(proto.Message.encode(m.message).finish()) : null;
          messageBatcher.push({
            updateOne: {
              filter: { jid: m.key.remoteJid, id: m.key.id },
              update: {
                jid: m.key.remoteJid,
                id: m.key.id,
                from_me: !!m.key.fromMe,
                participant: m.key.participant,
                msg: msgBuf,
                ts: Number(m.messageTimestamp),
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
              jid: c.id,
              name: c.name ?? null,
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
          jid,
          message_id: messageId,
          editor: editor || null,
          old_body: oldBody || '',
          new_body: newBody || '',
          ts: ts ?? Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        logger.warn({ err: e }, 'edit insert failed');
      }
    },
    async getMessageEdits(jid, messageId) {
      try {
        const docs = await MessageEdit.find({ jid, message_id: messageId }).sort({ ts: 1 }).lean();
        return docs.map((d) => ({
          editor: d.editor,
          old_body: d.old_body,
          new_body: d.new_body,
          ts: d.ts,
        }));
      } catch (e) {
        logger.warn({ err: e }, 'edits query failed');
        return [];
      }
    },
    async updateMessageBody(jid, messageId, message, ts) {
      try {
        const buf = Buffer.from(proto.Message.encode(message).finish());
        await Message.updateOne(
          { jid, id: messageId },
          { $set: { msg: buf, ts: ts ?? Math.floor(Date.now() / 1000) } },
        );
      } catch (e) {
        logger.warn({ err: e }, 'updateMessageBody failed');
      }
    },

    // ── Reactions ──────────────────────────────────────────────────────
    async recordMessageReaction(jid, messageId, reactor, emoji, ts) {
      try {
        await MessageReaction.create({
          jid,
          message_id: messageId,
          reactor: reactor || '',
          emoji: emoji || null,
          ts: ts ?? Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        logger.warn({ err: e }, 'reaction insert failed');
      }
    },
    async getMessageReactions(jid, messageId) {
      try {
        const docs = await MessageReaction.find({ jid, message_id: messageId })
          .sort({ ts: 1 })
          .lean();
        return docs.map((d) => ({ reactor: d.reactor, emoji: d.emoji, ts: d.ts }));
      } catch (e) {
        logger.warn({ err: e }, 'reactions query failed');
        return [];
      }
    },

    // ── Receipts ───────────────────────────────────────────────────────
    async recordReceipt(jid, messageId, recipient, status, ts) {
      try {
        // Use upsert + $max so we never downgrade (e.g. read → delivered)
        await MessageReceipt.updateOne(
          { jid, message_id: messageId, recipient },
          { $max: { status }, $set: { ts: ts ?? Math.floor(Date.now() / 1000) } },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e }, 'receipt upsert failed');
      }
    },
    async getMessageReceipts(jid, messageId) {
      try {
        const docs = await MessageReceipt.find({ jid, message_id: messageId })
          .sort({ ts: 1 })
          .lean();
        return docs.map((d) => ({ recipient: d.recipient, status: d.status, ts: d.ts }));
      } catch (e) {
        logger.warn({ err: e }, 'receipts query failed');
        return [];
      }
    },

    // ── Deletions ──────────────────────────────────────────────────────
    async markMessageDeleted(jid, messageId, _by, ts) {
      try {
        await Message.updateOne(
          { jid, id: messageId, $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
          { $set: { deleted_at: ts ?? Math.floor(Date.now() / 1000) } },
        );
      } catch (e) {
        logger.warn({ err: e }, 'markMessageDeleted failed');
      }
    },
    async markChatMessagesDeleted(jid, ts) {
      try {
        await Message.updateMany(
          { jid, $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
          { $set: { deleted_at: ts ?? Math.floor(Date.now() / 1000) } },
        );
      } catch (e) {
        logger.warn({ err: e }, 'markChatMessagesDeleted failed');
      }
    },
    async getDeletedInGroup(jid, limit = 100) {
      try {
        const docs = await Message.find({ jid, deleted_at: { $ne: null } })
          .sort({ deleted_at: -1 })
          .limit(limit)
          .lean();
        return docs.map((d) => ({
          id: d.id,
          participant: d.participant,
          deleted_at: d.deleted_at,
        }));
      } catch (e) {
        logger.warn({ err: e }, 'deletedInGroup failed');
        return [];
      }
    },

    // ── Aggregate status ───────────────────────────────────────────────
    async updateMessageStatus(jid, messageId, status, _ts) {
      try {
        await Message.updateOne({ jid, id: messageId }, { $max: { status: Number(status) } });
      } catch (e) {
        logger.warn({ err: e }, 'updateMessageStatus failed');
      }
    },

    async getSubscribers(service) {
      try {
        const docs = await ServiceSubscriber.find({ service }).lean();
        return docs.map((d) => ({
          jid: d.jid,
          last_seen_pulse_ts: d.last_seen_pulse_ts == null ? null : Number(d.last_seen_pulse_ts),
          meta: d.meta || null,
        }));
      } catch (e) {
        logger.warn({ err: e, service }, 'getSubscribers failed');
        return [];
      }
    },
    async addSubscriber(service, jid, meta) {
      try {
        await ServiceSubscriber.updateOne(
          { service, jid },
          {
            $setOnInsert: {
              service,
              jid,
              last_seen_pulse_ts: null,
              meta: meta == null ? null : meta,
            },
          },
          { upsert: true },
        );
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'addSubscriber failed');
      }
    },
    async removeSubscriber(service, jid) {
      try {
        await ServiceSubscriber.deleteOne({ service, jid });
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'removeSubscriber failed');
      }
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      try {
        await ServiceSubscriber.updateOne({ service, jid }, { $set: { last_seen_pulse_ts: ts } });
      } catch (e) {
        logger.warn({ err: e }, 'updateSubscriberTimestamp failed');
      }
    },
    async isSubscriber(service, jid) {
      try {
        const doc = await ServiceSubscriber.findOne({ service, jid }, { _id: 1 }).lean();
        return !!doc;
      } catch {
        return false;
      }
    },
    async getSubscriberMeta(service, jid) {
      try {
        const doc = await ServiceSubscriber.findOne({ service, jid }, { meta: 1 }).lean();
        if (!doc) return null;
        return doc.meta || null;
      } catch {
        return null;
      }
    },
    async updateSubscriberMeta(service, jid, meta) {
      try {
        await ServiceSubscriber.updateOne(
          { service, jid },
          { $set: { meta: meta == null ? null : meta } },
        );
      } catch (e) {
        logger.warn({ err: e, service, jid }, 'updateSubscriberMeta failed');
      }
    },
    async hasSentItem(service, jid, itemUrl) {
      try {
        const doc = await SentItem.findOne({ service, jid, item_url: itemUrl }, { _id: 1 }).lean();
        return !!doc;
      } catch {
        return false;
      }
    },
    async recordSentItem(service, jid, itemUrl) {
      try {
        await SentItem.updateOne(
          { service, jid, item_url: itemUrl },
          {
            $setOnInsert: {
              service,
              jid,
              item_url: itemUrl,
              sent_at: Math.floor(Date.now() / 1000),
            },
          },
          { upsert: true },
        );
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
        const doc = await conn.collection('user_levels').findOne({ jid });
        return doc ? { jid, xp: Number(doc.xp) || 0, last_at: Number(doc.last_at) || 0 } : null;
      } catch (e) {
        logger.debug({ err: e, jid }, 'getUserLevel failed');
        return null;
      }
    },
    async addUserXp(jid, amount) {
      const xp = Math.max(0, Math.floor(Number(amount) || 0));
      if (xp === 0) {
        try {
          const doc = await conn.collection('user_levels').findOne({ jid });
          return doc ? Number(doc.xp) : 0;
        } catch {
          return 0;
        }
      }
      try {
        const now = Math.floor(Date.now() / 1000);
        const r = await conn
          .collection('user_levels')
          .findOneAndUpdate(
            { jid },
            { $inc: { xp }, $set: { last_at: now } },
            { upsert: true, returnDocument: 'after' },
          );
        const after = r?.value || r;
        return after ? Number(after.xp) : xp;
      } catch (e) {
        logger.debug({ err: e, jid, amount }, 'addUserXp failed');
        return 0;
      }
    },

    conn,
    async close() {
      try {
        await messageBatcher.drain();
      } catch (e) {
        logger.warn({ err: e }, 'mongo batcher drain failed');
      }
      conn.close();
    },
  };
}

module.exports = { makeMongoStore };
