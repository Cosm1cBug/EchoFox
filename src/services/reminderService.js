/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * reminderService — persistent per-user reminders.
 *
 * Reminders are stored under the existing service_subscribers.meta JSON
 * column so we don't need a fresh migration. Shape:
 *
 *   meta = { items: [{ id, dueAt, text, chat, createdAt }, ...] }
 *
 *   • id        crypto.randomUUID(); user-visible short id = first 8 chars
 *   • dueAt     unix ms
 *   • text      ≤ 500 chars
 *   • chat      JID where the reminder was created (so we reply in that chat)
 *   • createdAt unix ms (for `.remindme list` display)
 *
 * `tick()` runs every minute (cron started from src/core/worker.js).
 * It loads all subscribers under SERVICE, fires any due items, and rewrites
 * meta in-place. Failures are logged but don't crash the bot.
 *
 * Hard caps (per user):
 *   • MAX_PER_USER reminders pending at once
 *   • MAX_HORIZON_MS into the future (default: 365 days)
 *
 * Persistence semantics:
 *   • SQLite store: full support via store.setSubscriberMeta / getSubscribers
 *   • Other stores: same API — depends on subscriber_meta support
 *   • If store layer rejects, command surface a friendly error.
 */

const crypto = require('node:crypto');
const { getStore } = require('../store/instance');

const SERVICE = 'reminders';
const MAX_PER_USER = 50;
const MAX_HORIZON_MS = 1000 * 60 * 60 * 24 * 365; // 1 year
const MAX_TEXT_LEN = 500;
const TICK_MS = 60_000;

const logger = require('../core/logger').child({ mod: 'reminders' });

let _sock = null;
let _timer = null;

/* ─── duration parsing ────────────────────────────────────────────────
 *
 *   "10s"   →    10_000
 *   "5m"    →   300_000
 *   "2h30m" →  9000_000
 *   "1d12h" → 129600000
 *   "1w"    → 604800000
 *
 * Returns ms (number) or null on parse failure.
 */
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function parseDuration(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  // Plain integer = seconds (POSIX `sleep` convention)
  if (/^\d+$/.test(s)) return parseInt(s, 10) * 1000;
  const re = /(\d+)\s*([smhdw])/g;
  let total = 0;
  let consumed = 0;
  let match;
  while ((match = re.exec(s)) !== null) {
    total += parseInt(match[1], 10) * UNIT_MS[match[2]];
    consumed += match[0].length;
  }
  if (total <= 0) return null;
  // Reject trailing junk (e.g. "5mx" should not be accepted as 5m)
  if (consumed !== s.replace(/\s+/g, '').length) return null;
  return total;
}

function formatRelative(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/* ─── CRUD ────────────────────────────────────────────────────────────*/

async function listFor(userJid) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, userJid)) || {};
  return Array.isArray(meta.items) ? meta.items : [];
}

async function add({ userJid, chat, text, durationMs }) {
  const store = getStore();
  if (durationMs <= 0) throw new Error('duration must be positive');
  if (durationMs > MAX_HORIZON_MS) {
    throw new Error(`duration too far in future (max ${MAX_HORIZON_MS / 86_400_000} days)`);
  }
  const trimmed = String(text || '')
    .trim()
    .slice(0, MAX_TEXT_LEN);
  if (!trimmed) throw new Error('text required');

  const meta = (await store.getSubscriberMeta(SERVICE, userJid)) || {};
  const items = Array.isArray(meta.items) ? [...meta.items] : [];
  if (items.length >= MAX_PER_USER) {
    throw new Error(`at the ${MAX_PER_USER}-reminder limit; clear some first`);
  }

  const item = {
    id: crypto.randomUUID(),
    dueAt: Date.now() + durationMs,
    text: trimmed,
    chat,
    createdAt: Date.now(),
  };
  items.push(item);

  // Ensure subscription exists so getSubscribers() returns this jid
  await store.subscribe(SERVICE, userJid).catch(() => {});
  await store.setSubscriberMeta(SERVICE, userJid, { ...meta, items });

  return item;
}

async function remove(userJid, shortId) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, userJid)) || {};
  const items = Array.isArray(meta.items) ? meta.items : [];
  const idx = items.findIndex((it) => it.id === shortId || it.id.startsWith(shortId));
  if (idx < 0) return null;
  const [removed] = items.splice(idx, 1);
  await store.setSubscriberMeta(SERVICE, userJid, { ...meta, items });
  return removed;
}

async function clearAll(userJid) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, userJid)) || {};
  const n = Array.isArray(meta.items) ? meta.items.length : 0;
  await store.setSubscriberMeta(SERVICE, userJid, { ...meta, items: [] });
  return n;
}

/* ─── ticker ──────────────────────────────────────────────────────────*/

async function tick() {
  if (!_sock) return;
  const store = getStore();
  const subs = await store.getSubscribers(SERVICE).catch(() => []);
  const now = Date.now();
  for (const userJid of subs) {
    let meta;
    try {
      meta = (await store.getSubscriberMeta(SERVICE, userJid)) || {};
    } catch (err) {
      logger.warn({ err, userJid }, 'getSubscriberMeta failed');
      continue;
    }
    const items = Array.isArray(meta.items) ? meta.items : [];
    if (!items.length) continue;

    const due = items.filter((it) => it.dueAt <= now);
    if (!due.length) continue;

    const remaining = items.filter((it) => it.dueAt > now);

    for (const it of due) {
      try {
        const ago = formatRelative(now - it.createdAt);
        await _sock.sendMessage(it.chat, {
          text:
            `⏰ *Reminder* (set ${ago} ago)\n\n` +
            `${it.text}\n\n` +
            `_For:_ @${userJid.split('@')[0]}`,
          mentions: [userJid],
        });
      } catch (err) {
        logger.warn({ err, userJid, id: it.id }, 'reminder delivery failed');
      }
    }

    try {
      await store.setSubscriberMeta(SERVICE, userJid, { ...meta, items: remaining });
    } catch (err) {
      logger.warn({ err, userJid }, 'setSubscriberMeta failed');
    }
  }
}

function start(sock) {
  _sock = sock;
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, 'reminder tick failed'));
  }, TICK_MS).unref();
  logger.info({ tick_ms: TICK_MS }, '⏰ reminderService started');
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
  _sock = null;
}

module.exports = {
  SERVICE,
  MAX_PER_USER,
  MAX_HORIZON_MS,
  MAX_TEXT_LEN,
  start,
  stop,
  tick,
  listFor,
  add,
  remove,
  clearAll,
  parseDuration,
  formatRelative,
};
