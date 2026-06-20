/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * Centralised caches. All long-lived caches in one place so we can:
 *   • monitor their hit/miss rates
 *   • clear them from a single point on shutdown
 *
 * We use:
 *   • LRUCache (native) for size-bounded caches we control fully.
 *   • LruCacheShim for size+TTL caches the APP USES that previously
 *     used node-cache. The shim exposes a NodeCache-compatible API
 *     so call sites don't need to change.
 *   • node-cache for the 5 caches passed to Baileys (msgRetry,
 *     callOffer, placeholderResend, userDevices, media). Baileys's
 *     code does `await` on `.get/.set/.del` and feature-detects
 *     `.mget/.mset/.close` — node-cache satisfies all of that
 *     natively; the shim intentionally doesn't.
 *
 * v1.12.0:
 *   profilePicCache + parseCache migrated from node-cache → shim.
 *   The 5 Baileys-facing caches remain on node-cache (untouched).
 */
const { LRUCache } = require('lru-cache');
const NodeCache = require('node-cache');
const { LruCacheShim } = require('../lib/lruCacheShim');

// ─── Group metadata (the *single biggest* perf win for group sends) ──────
//    Baileys consults `cachedGroupMetadata` before every group message.
const groupMetadataCache = new LRUCache({
  max: 5_000,
  ttl: 1000 * 60 * 60, // 1 h
  updateAgeOnGet: true,
});

// ─── Message-retry counter (resolves "waiting for this message") ─────────
const msgRetryCounterCache = new NodeCache({ stdTTL: 60, useClones: false });

// ─── Call offer + placeholder resend caches (recommended in 7.x) ─────────
const callOfferCache = new NodeCache({ stdTTL: 60 * 5, useClones: false });
const placeholderResendCache = new NodeCache({ stdTTL: 60 * 60, useClones: false });

// ─── User devices cache (Baileys recomputes device list otherwise) ───────
const userDevicesCache = new NodeCache({ stdTTL: 60 * 5, useClones: false });

// ─── Media cache – prevents re-uploading same buffers (stickers, etc.) ──
const mediaCache = new NodeCache({ stdTTL: 60 * 30, useClones: false });

// --- profile picture URLs — 1h TTL, avoids repeated sock.profilePictureUrl() calls
// v1.12.0: NodeCache → LruCacheShim. App-only cache, bounded to 5k entries.
const profilePicCache = new LruCacheShim({ max: 5_000, stdTTL: 60 * 60 });

// ─── App-level command/argument parse cache (cheap micro-opt) ────────────
// v1.12.0: was a plain LRUCache; keep as LruCacheShim so its API matches
// profilePicCache (so future code that touches either gets a consistent surface).
const parseCache = new LruCacheShim({ max: 500, stdTTL: 30 });

module.exports = {
  groupMetadataCache,
  msgRetryCounterCache,
  callOfferCache,
  placeholderResendCache,
  userDevicesCache,
  mediaCache,
  profilePicCache,
  parseCache,
  clearAll() {
    groupMetadataCache.clear();
    msgRetryCounterCache.flushAll();
    callOfferCache.flushAll();
    placeholderResendCache.flushAll();
    userDevicesCache.flushAll();
    mediaCache.flushAll();
    profilePicCache.flushAll();
    parseCache.flushAll();
  },
};
