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
 *   • LRU for bounded memory pressure (group metadata, message keys)
 *   • node-cache for TTL-only structures (retry counters, call offers)
 */
const { LRUCache } = require('lru-cache');
const NodeCache = require('node-cache');

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
const profilePicCache = new NodeCache({ stdTTL: 60 * 60, useClones: false });

// ─── App-level command/argument parse cache (cheap micro-opt) ────────────
const parseCache = new LRUCache({ max: 500, ttl: 1000 * 30 });

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
    parseCache.clear();
  },
};
