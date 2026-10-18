/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.21.0 — helper for the generic change timeline (timeline_events).
 *
 * Event handlers call recordTimeline() alongside their snapshot writes so
 * every state change leaves a queryable history row (GET /api/history/:domain
 * → dashboard HistoryPanel). Logging must never break event handling: all
 * calls are best-effort and swallow errors.
 */

/** Append one timeline row. `ev`: {domain, entityId, field, oldValue, newValue, actor, source, ts?}. */
async function recordTimeline(store, ev) {
  try {
    if (!store || typeof store.recordTimelineEvent !== 'function') return null;
    return await store.recordTimelineEvent(ev);
  } catch {
    return null;
  }
}

/** Compact JSON snapshot for old_value/new_value (bounded). */
function snap(value, max = 1000) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return String(value).slice(0, max);
  }
}

/** getStore() that returns null instead of throwing before the singleton exists. */
function safeGetStore() {
  try {
    return require('../store/instance').getStore();
  } catch {
    return null;
  }
}

module.exports = { recordTimeline, snap, safeGetStore };
