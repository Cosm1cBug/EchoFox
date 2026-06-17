/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * afkState — in-memory store of currently-AFK users.
 *
 *   Map<userJid, { reason: string, since: number, lastAnnounced: number }>
 *
 *   • Set with `mark(jid, reason)`
 *   • Cleared on `clear(jid)` or auto-cleared on the user's next message
 *     (handled in events/messages.upsert.js).
 *   • `shouldAnnounce(jid)` enforces a 30-second debounce so the bot
 *     doesn't spam the same chat for every mention of an AFK user.
 *
 * Intentionally NOT persisted to SQLite: AFK is by definition transient.
 * If the process restarts, users come back from AFK — which is the
 * expected behaviour anyway.
 *
 * Bounded to 10_000 entries via LRUCache to defend against runaway state
 * (e.g. if every user in a huge group marks themselves AFK).
 */

const { LRUCache } = require('lru-cache');

const ANNOUNCE_DEBOUNCE_MS = 30_000;
const MAX_AFK_USERS = 10_000;
const AFK_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7-day hard ceiling

const afk = new LRUCache({ max: MAX_AFK_USERS, ttl: AFK_TTL_MS });

function mark(jid, reason) {
  afk.set(jid, {
    reason: String(reason || '').slice(0, 200) || 'AFK',
    since: Date.now(),
    lastAnnounced: 0,
  });
}

function clear(jid) {
  return afk.delete(jid);
}

function get(jid) {
  return afk.get(jid) || null;
}

function isAfk(jid) {
  return afk.has(jid);
}

function shouldAnnounce(jid) {
  const entry = afk.get(jid);
  if (!entry) return false;
  const now = Date.now();
  if (now - entry.lastAnnounced < ANNOUNCE_DEBOUNCE_MS) return false;
  entry.lastAnnounced = now;
  return true;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function _resetForTests() {
  afk.clear();
}

module.exports = {
  mark,
  clear,
  get,
  isAfk,
  shouldAnnounce,
  formatDuration,
  _resetForTests,
  ANNOUNCE_DEBOUNCE_MS,
};
