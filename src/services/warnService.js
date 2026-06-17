/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * warnService — per-group warn system.
 *
 * Storage: existing service_subscribers.meta JSON column, with the
 * group jid as the subscriber id under the synthetic service
 * "warnings". No new migration.
 *
 *   meta = {
 *     threshold: number,                    // auto-kick at this many strikes
 *     users: {                               // user jid → warn list
 *       "<userJid>": [
 *         { id, reason, byJid, ts },        // newest last
 *         ...
 *       ]
 *     }
 *   }
 *
 *   • threshold defaults to DEFAULT_THRESHOLD; admin can change via
 *     `.warn config threshold <N>` (handled in commands/group/warn.js).
 *   • addWarn() returns { count, threshold, item } so the caller can
 *     decide whether to auto-kick.
 *   • clearWarns() wipes a user's strikes (e.g. after admin pardon).
 *   • removeWarn(userJid, idOrIndex) removes one specific warn.
 *
 * The actual kick action lives in the command (calls
 * sock.groupParticipantsUpdate(group, [userJid], 'remove')).
 */

const crypto = require('node:crypto');
const { getStore } = require('../store/instance');

const SERVICE = 'warnings';
const DEFAULT_THRESHOLD = 3;
const MAX_THRESHOLD = 20;
const MAX_WARNS_PER_USER = 100;
const MAX_REASON_LEN = 300;

async function getMeta(groupJid) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, groupJid)) || {};
  return {
    threshold:
      Number.isInteger(meta.threshold) && meta.threshold > 0 && meta.threshold <= MAX_THRESHOLD
        ? meta.threshold
        : DEFAULT_THRESHOLD,
    users: meta.users && typeof meta.users === 'object' ? meta.users : {},
  };
}

async function saveMeta(groupJid, meta) {
  const store = getStore();
  await store.subscribe(SERVICE, groupJid).catch(() => {});
  await store.setSubscriberMeta(SERVICE, groupJid, meta);
}

async function addWarn(groupJid, userJid, { reason, byJid }) {
  const meta = await getMeta(groupJid);
  const list = Array.isArray(meta.users[userJid]) ? [...meta.users[userJid]] : [];
  if (list.length >= MAX_WARNS_PER_USER) {
    list.shift(); // oldest off, never grow unbounded
  }
  const item = {
    id: crypto.randomUUID().slice(0, 8),
    reason:
      String(reason || '')
        .slice(0, MAX_REASON_LEN)
        .trim() || 'no reason given',
    byJid: byJid || null,
    ts: Math.floor(Date.now() / 1000),
  };
  list.push(item);
  meta.users[userJid] = list;
  await saveMeta(groupJid, meta);
  return { count: list.length, threshold: meta.threshold, item };
}

async function listWarns(groupJid, userJid) {
  const meta = await getMeta(groupJid);
  return {
    threshold: meta.threshold,
    warns: Array.isArray(meta.users[userJid]) ? meta.users[userJid] : [],
  };
}

async function listAllWarns(groupJid) {
  const meta = await getMeta(groupJid);
  return {
    threshold: meta.threshold,
    users: meta.users,
  };
}

async function clearWarns(groupJid, userJid) {
  const meta = await getMeta(groupJid);
  const before = (meta.users[userJid] || []).length;
  delete meta.users[userJid];
  await saveMeta(groupJid, meta);
  return before;
}

async function removeWarn(groupJid, userJid, idOrIndex) {
  const meta = await getMeta(groupJid);
  const list = Array.isArray(meta.users[userJid]) ? [...meta.users[userJid]] : [];
  if (!list.length) return null;
  let idx = -1;
  const n = parseInt(idOrIndex, 10);
  if (Number.isInteger(n) && n >= 1 && n <= list.length) {
    idx = n - 1;
  } else {
    idx = list.findIndex((w) => w.id === idOrIndex || w.id.startsWith(idOrIndex));
  }
  if (idx < 0) return null;
  const [removed] = list.splice(idx, 1);
  if (list.length) {
    meta.users[userJid] = list;
  } else {
    delete meta.users[userJid];
  }
  await saveMeta(groupJid, meta);
  return removed;
}

async function setThreshold(groupJid, n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_THRESHOLD) {
    throw new Error(`threshold must be an integer between 1 and ${MAX_THRESHOLD}`);
  }
  const meta = await getMeta(groupJid);
  meta.threshold = n;
  await saveMeta(groupJid, meta);
  return meta.threshold;
}

module.exports = {
  SERVICE,
  DEFAULT_THRESHOLD,
  MAX_THRESHOLD,
  MAX_WARNS_PER_USER,
  MAX_REASON_LEN,
  getMeta,
  addWarn,
  listWarns,
  listAllWarns,
  clearWarns,
  removeWarn,
  setThreshold,
};
