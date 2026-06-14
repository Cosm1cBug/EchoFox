/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Test helpers: minimal Baileys-shaped mock socket + utilities for
 * integration tests.
 *
 *   const { makeMockSock, makeMockMessage } = require('./mockSock');
 *   const sock = makeMockSock({ userJid: '111@s.whatsapp.net' });
 *
 *   sock.sendMessage(jid, content, opts);   // → resolves; recorded in sock.sent[]
 *   sock.calls.sendMessage                  // count
 *   sock.lastSent                           // most recent send
 *
 * The mock implements the methods used by:
 *   • src/events/messages.upsert.js
 *   • src/core/commandRunner.js
 *   • src/middleware/presence.js (sendPresenceUpdate stub)
 *   • most commands that call sock.sendMessage / sock.readMessages
 */

function makeMockSock(opts = {}) {
  const sent = [];
  const presence = [];
  const reads = [];
  const sock = {
    user: { id: opts.userJid || '+0000000@s.whatsapp.net', name: 'TestBot' },
    sent,
    presence,
    reads,
    calls: { sendMessage: 0, sendPresenceUpdate: 0, readMessages: 0 },
    lastSent: null,

    sendMessage: async (jid, content, options = {}) => {
      sock.calls.sendMessage++;
      const record = { jid, content, options, at: Date.now() };
      sent.push(record);
      sock.lastSent = record;
      return { key: { remoteJid: jid, id: 'mock-' + sent.length, fromMe: true } };
    },

    sendPresenceUpdate: async (kind, jid) => {
      sock.calls.sendPresenceUpdate++;
      presence.push({ kind, jid, at: Date.now() });
    },

    readMessages: async (keys) => {
      sock.calls.readMessages++;
      reads.push(keys);
    },

    groupMetadata: async (_jid) => ({
      id: _jid,
      subject: 'TestGroup',
      creation: 1700000000,
      owner: '111@s.whatsapp.net',
      participants: [{ id: '111@s.whatsapp.net', admin: 'admin' }, { id: '222@s.whatsapp.net' }],
    }),

    groupFetchAllParticipating: async () => ({}),
    decodeJid: (j) => j,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, fatal: () => {} },
  };
  return sock;
}

/** Build a Baileys-shaped inbound message. */
function makeMockMessage({ text, jid, sender, fromMe = false, msgId, ts } = {}) {
  return {
    key: {
      remoteJid: jid || '999@s.whatsapp.net',
      id: msgId || `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fromMe,
      participant: jid && jid.endsWith('@g.us') ? sender || '222@s.whatsapp.net' : undefined,
    },
    message: { conversation: text || 'hello' },
    messageTimestamp: ts || Math.floor(Date.now() / 1000),
    pushName: 'TestUser',
  };
}

/** Quick stub for a store (in-memory; supports the methods commands use). */
function makeMockStore() {
  const _gauges = {},
    _counters = {};
  const _subs = new Map(); // `${service}|${jid}` → { last_seen_pulse_ts, meta }
  const _sent = new Map(); // `${service}|${jid}|${articleUrl}` → true
  const _key = (service, jid) => `${service}|${jid}`;
  const _sKey = (service, jid, url) => `${service}|${jid}|${url}`;
  return {
    async getMessage() {
      return undefined;
    },
    async getGroupMetadata() {
      return undefined;
    },
    async saveGroupMetadata() {},
    async getParticipantHistory() {
      return [];
    },
    async getCurrentParticipants() {
      return [];
    },
    async listGroups() {
      return [];
    },
    async countGroups() {
      return 0;
    },
    async countUniqueUsers() {
      return 0;
    },
    recordStat(k, n = 1) {
      _counters[k] = (_counters[k] || 0) + n;
    },
    setGauge(k, v) {
      _gauges[k] = v;
    },
    async getStats() {
      return { ..._counters };
    },
    async getGauges() {
      return { ..._gauges };
    },
    recordParticipantEvent() {},
    recordMessageEdit() {},
    recordMessageReaction() {},
    recordReceipt() {},
    markMessageDeleted() {},
    markChatMessagesDeleted() {},
    updateMessageStatus() {},
    updateMessageBody() {},
    getDeletedInGroup() {
      return [];
    },
    async getSubscribers(service) {
      const out = [];
      for (const [k, v] of _subs) {
        const [svc, jid] = k.split('|');
        if (svc === service)
          out.push({ jid, last_seen_pulse_ts: v.last_seen_pulse_ts, meta: v.meta });
      }
      return out;
    },
    async addSubscriber(service, jid, meta) {
      if (_subs.has(_key(service, jid))) return;
      _subs.set(_key(service, jid), { last_seen_pulse_ts: null, meta: meta ?? null });
    },
    async removeSubscriber(service, jid) {
      _subs.delete(_key(service, jid));
    },
    async updateSubscriberTimestamp(service, jid, ts) {
      const v = _subs.get(_key(service, jid));
      if (v) v.last_seen_pulse_ts = ts;
    },
    async isSubscriber(service, jid) {
      return _subs.has(_key(service, jid));
    },
    async getSubscriberMeta(service, jid) {
      const v = _subs.get(_key(service, jid));
      return v ? v.meta : null;
    },
    async updateSubscriberMeta(service, jid, meta) {
      const v = _subs.get(_key(service, jid));
      if (v) v.meta = meta ?? null;
    },
    async hasSentArticle(service, jid, url) {
      return _sent.has(_sKey(service, jid, url));
    },
    async recordSentArticle(service, jid, url) {
      _sent.set(_sKey(service, jid, url), true);
    },
    async hasSentItem(service, jid, itemUrl) {
      return _sent.has(_sKey(service, jid, itemUrl));
    },
    async recordSentItem(service, jid, itemUrl) {
      _sent.set(_sKey(service, jid, itemUrl), true);
    },
    bind() {},
    close() {},
  };
}

module.exports = { makeMockSock, makeMockMessage, makeMockStore };
