/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * muteService — chat-local mute list. When user X is muted in chat Y,
 * the bot ignores X's COMMANDS in Y until the mute expires.
 *
 *   It does NOT remove the user from the group (that would be a kick).
 *   It does NOT delete their messages (that would be antilink-style).
 *   It simply makes the bot pretend they aren't there for command
 *   dispatch purposes.
 *
 * Storage:
 *   In-memory only — bounded LRU, keyed by `<chatJid>|<userJid>`.
 *   Restart clears all mutes. Persisting would create stuck-mute
 *   states across overnight restarts (same rationale as AFK in v1.6.0).
 *
 * API:
 *   mute(chat, user, durationMs)  → records mute, returns ISO expiry
 *   unmute(chat, user)             → returns boolean (was-muted)
 *   isMuted(chat, user)            → returns boolean (auto-expires)
 *   list(chat)                     → array of { user, untilMs }
 *   timeLeftMs(chat, user)         → ms until expiry or 0
 *
 * Hook:
 *   events/messages.upsert.js consults isMuted() right after the AFK
 *   block — if muted, the runner is skipped silently for that message.
 */

const { LRUCache } = require('lru-cache');

const MAX_ENTRIES = 50_000;
const MIN_DURATION_MS = 60 * 1000; // 1 minute
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Entry shape: { until: <unix-ms>, by: <byJid>, reason: <string?> }
const _store = new LRUCache({
  max: MAX_ENTRIES,
  ttl: MAX_DURATION_MS, // hard upper bound; auto-evict
});

const UNIT_MS = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse a duration like "30m", "2h", "1d". Plain integer = minutes.
 * Returns ms, or null on parse failure / out-of-range.
 */
function parseDuration(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    // Plain number = minutes (most-natural for "mute for 30")
    const min = parseInt(s, 10);
    if (min <= 0) return null;
    return min * 60_000;
  }
  const m = /^(\d+)\s*([smhd])$/.exec(s);
  if (!m) return null;
  const total = parseInt(m[1], 10) * UNIT_MS[m[2]];
  if (total < MIN_DURATION_MS || total > MAX_DURATION_MS) return null;
  return total;
}

function key(chat, user) {
  return `${chat}|${user}`;
}

function mute(chat, user, durationMs, opts = {}) {
  const until = Date.now() + Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, durationMs));
  _store.set(key(chat, user), {
    until,
    by: opts.by || null,
    reason: String(opts.reason || '').slice(0, 200),
  });
  return until;
}

function unmute(chat, user) {
  return _store.delete(key(chat, user));
}

function get(chat, user) {
  const e = _store.get(key(chat, user));
  if (!e) return null;
  if (e.until <= Date.now()) {
    _store.delete(key(chat, user));
    return null;
  }
  return e;
}

function isMuted(chat, user) {
  return !!get(chat, user);
}

function timeLeftMs(chat, user) {
  const e = get(chat, user);
  return e ? Math.max(0, e.until - Date.now()) : 0;
}

function list(chat) {
  const now = Date.now();
  const out = [];
  for (const [k, v] of _store.entries()) {
    const [c, u] = k.split('|');
    if (c !== chat) continue;
    if (v.until <= now) continue;
    out.push({ user: u, until: v.until, by: v.by, reason: v.reason });
  }
  return out;
}

function fmtDuration(ms) {
  if (ms <= 0) return '0s';
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
  _store.clear();
}

module.exports = {
  MIN_DURATION_MS,
  MAX_DURATION_MS,
  parseDuration,
  fmtDuration,
  mute,
  unmute,
  get,
  isMuted,
  timeLeftMs,
  list,
  _resetForTests,
};
