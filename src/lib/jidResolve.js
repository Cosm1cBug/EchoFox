/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * jidResolve — LID ⇄ PN resolution and LID-safe admin checks.
 *
 * The bug this fixes
 * ------------------
 * Baileys 7.x defaults to LID addressing, and even 6.7.24 delivered LIDs in
 * practice — real entries from this bot's own logs:
 *
 *   cmd: "menu"  sender: "32844286005291@lid"
 *   "key": { "remoteJid": "32844286005291@lid", ... }
 *
 * Admin authorisation was a raw string compare:
 *
 *   const isAdmin = (config.admins || []).includes(ctx.sender);
 *
 * but `config.admins` is normally written in PN form
 * (`919876543210@s.whatsapp.net`) while `ctx.sender` arrives as a LID
 * (`32844286005291@lid`). Those never match, so:
 *
 *   • the owner is not recognised as an admin,
 *   • `$`-prefixed admin commands are refused ("The `$` prefix is reserved
 *     for admins"),
 *   • `admin: true` commands are blocked ("🔒 Admin-only command."),
 *   • the owner is subject to the normal per-sender rate limit.
 *
 * `src/lib/configSchema.js` explicitly accepts EITHER `@s.whatsapp.net` or
 * `@lid` for `config.admins`, so matching only one form was always a
 * contract violation — v7 just makes it hit far more often.
 *
 * Resolution order
 * ----------------
 *   1. `sock.signalRepository.lidMapping.getPNForLID()` / `getLIDForPN()`
 *      (Baileys 7.x; absent on 6.7.24)
 *   2. the persisted mapping written by `src/events/lid-mapping.update.js`
 *      (`store.getLidMapping` / `store.getReverseLidMapping`)
 *   3. give up — callers fall back to the previous exact-match behaviour, so
 *      this is never a regression on a bot whose mapping table is empty.
 */

const logger = require('../core/logger').child({ mod: 'jid-resolve' });

/** Small cache: these lookups sit on every inbound message. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 5_000;
const _cache = new Map();

function _cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function _cacheSet(key, value) {
  if (_cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest inserted key.
    const first = _cache.keys().next().value;
    if (first !== undefined) _cache.delete(first);
  }
  _cache.set(key, { value, at: Date.now() });
}

/** Test hook. */
function _clearCache() {
  _cache.clear();
}

/**
 * Resolve a `@lid` to its `@s.whatsapp.net` counterpart.
 * @returns {Promise<string|null>}
 */
async function resolvePnForLid(sock, store, lid) {
  if (!lid || !lid.endsWith('@lid')) return null;
  const cached = _cacheGet(`pn:${lid}`);
  if (cached !== undefined) return cached;

  let pn = null;

  // 1. Baileys 7.x LID store (present only on v7+, and only for cached pairs).
  try {
    const got = await sock?.signalRepository?.lidMapping?.getPNForLID?.(lid);
    if (got) pn = got;
  } catch (e) {
    logger.debug({ err: e, lid }, 'lidMapping.getPNForLID failed');
  }

  // 2. Persisted mapping written by the lid-mapping.update event handler.
  if (!pn) {
    try {
      if (typeof store?.getLidMapping === 'function') {
        pn = (await store.getLidMapping(lid)) || null;
      }
    } catch (e) {
      logger.debug({ err: e, lid }, 'store.getLidMapping failed');
    }
  }

  _cacheSet(`pn:${lid}`, pn);
  return pn;
}

/**
 * Resolve a `@s.whatsapp.net` to its `@lid` counterpart.
 * @returns {Promise<string|null>}
 */
async function resolveLidForPn(sock, store, pn) {
  if (!pn || !pn.endsWith('@s.whatsapp.net')) return null;
  const cached = _cacheGet(`lid:${pn}`);
  if (cached !== undefined) return cached;

  let lid = null;

  try {
    const got = await sock?.signalRepository?.lidMapping?.getLIDForPN?.(pn);
    if (got) lid = Array.isArray(got) ? got[0] : got;
  } catch (e) {
    logger.debug({ err: e, pn }, 'lidMapping.getLIDForPN failed');
  }

  if (!lid) {
    try {
      if (typeof store?.getReverseLidMapping === 'function') {
        lid = (await store.getReverseLidMapping(pn)) || null;
      }
    } catch (e) {
      logger.debug({ err: e, pn }, 'store.getReverseLidMapping failed');
    }
  }

  _cacheSet(`lid:${pn}`, lid);
  return lid;
}

/**
 * LID-safe replacement for `config.admins.includes(jid)`.
 *
 * Matches the sender against `config.admins` in BOTH addressing forms, so an
 * admin entry written as a PN still authorises a LID sender and vice versa.
 * Falls back to an exact compare whenever resolution is unavailable, which
 * preserves the previous behaviour on installs with no mapping data.
 *
 * @param {object} sock    Baileys socket (may be null in some call paths)
 * @param {object} store   EchoFox store (may be null)
 * @param {string} senderJid
 * @param {string[]} [admins]  defaults to config.admins
 * @returns {Promise<boolean>}
 */
async function isConfiguredAdmin(sock, store, senderJid, admins, altJid) {
  const list = admins || require('./configLoader').config.admins || [];
  if (!senderJid || !list.length) return false;

  // Fast path 1 — exact match (covers admins already stored in LID form).
  if (list.includes(senderJid)) return true;

  // Fast path 2 — the alternate addressing form Baileys already decoded onto
  // the message key (ctx.senderPn / m.key.participantAlt). This is the common
  // case and needs NO lookup at all: the server supplies both forms whenever
  // the stanza is LID-addressed, which is the default on v7. Checked before
  // the async lidMapping path because it is synchronous and always fresh.
  if (altJid && list.includes(altJid)) return true;

  try {
    if (senderJid.endsWith('@lid')) {
      const pn = await resolvePnForLid(sock, store, senderJid);
      if (pn && pn !== altJid && list.includes(pn)) return true;
    } else if (senderJid.endsWith('@s.whatsapp.net')) {
      const lid = await resolveLidForPn(sock, store, senderJid);
      if (lid && lid !== altJid && list.includes(lid)) return true;
    }
  } catch (e) {
    logger.debug({ err: e, senderJid }, 'admin resolution failed — using exact match');
  }

  return false;
}

module.exports = {
  resolvePnForLid,
  resolveLidForPn,
  isConfiguredAdmin,
  _clearCache,
};
