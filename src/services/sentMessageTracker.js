/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * sentMessageTracker — keep a bounded ring of the bot's recently sent
 * messages, indexed by chat JID, so admin commands like `.purge` can
 * revoke them on demand.
 *
 *   wrap(sock)              ← call once after wrapSocketSend
 *   recent(chat, n)         ← return up to n most-recent {key, ts}
 *   recentSince(chat, ms)   ← all sent in the last <ms> ms
 *   forget(key)             ← drop one (called by purge on success)
 *
 * Storage:
 *   • Per-chat circular buffer, cap MAX_PER_CHAT (default 100).
 *   • Whole tracker capped by an LRU on chat-jids (MAX_CHATS).
 *   • Each entry: { key: WAMessageKey, ts: number(ms), chat: string }.
 *
 *   • NOT persisted to disk. Purge is intended to work on messages from
 *     the current process lifetime; that matches what users expect from
 *     a fresh `.purge` command after a long uptime.
 *
 * Wraps `sock.sendMessage` non-destructively: we call the previous
 * implementation (which may itself be the p-queue wrapper from
 * `middleware/sendQueue.js`), await its result, capture the returned
 * WAMessage's key, and pass the result through unchanged.
 */

const { LRUCache } = require('lru-cache');

const MAX_PER_CHAT = 100;
const MAX_CHATS = 2000;
const ENTRY_TTL_MS = 1000 * 60 * 60 * 24; // 24h hard ceiling

const _byChat = new LRUCache({ max: MAX_CHATS, ttl: ENTRY_TTL_MS });

function _push(chat, entry) {
  let buf = _byChat.get(chat);
  if (!buf) {
    buf = [];
    _byChat.set(chat, buf);
  }
  buf.push(entry);
  if (buf.length > MAX_PER_CHAT) {
    buf.splice(0, buf.length - MAX_PER_CHAT);
  }
}

function wrap(sock) {
  if (!sock || typeof sock.sendMessage !== 'function') return;
  if (sock.__echofoxSendTracked) return;

  const previous = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const result = await previous(jid, content, options);
    try {
      // Baileys returns a WAMessage with .key on success.
      // Some send modes (reactions, presence, polls receipts) return falsy
      // or non-key shapes; skip those silently.
      if (result?.key?.id && result.key.remoteJid) {
        _push(result.key.remoteJid, {
          key: result.key,
          ts: Date.now(),
          chat: result.key.remoteJid,
        });
      }
    } catch (_e) {
      /* never block the send on tracker bookkeeping */
    }
    return result;
  };
  sock.__echofoxSendTracked = true;
}

function recent(chat, n = 50) {
  const buf = _byChat.get(chat) || [];
  return buf.slice(-Math.max(1, Math.min(MAX_PER_CHAT, n)));
}

function recentSince(chat, ms) {
  const cutoff = Date.now() - Math.max(0, ms);
  const buf = _byChat.get(chat) || [];
  return buf.filter((e) => e.ts >= cutoff);
}

function forget(key) {
  if (!key?.remoteJid || !key?.id) return false;
  const buf = _byChat.get(key.remoteJid);
  if (!buf) return false;
  const idx = buf.findIndex((e) => e.key.id === key.id);
  if (idx < 0) return false;
  buf.splice(idx, 1);
  return true;
}

function _resetForTests() {
  _byChat.clear();
}

module.exports = {
  wrap,
  recent,
  recentSince,
  forget,
  _resetForTests,
  MAX_PER_CHAT,
  MAX_CHATS,
};
