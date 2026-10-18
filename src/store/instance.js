/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Process-wide store singleton accessor.
 *
 * The store instance is created exactly once by lifecycle.selectStore()
 * during boot, and registered here via setStore(). Commands and services
 * that need DB access call getStore() at *invocation time* — not at
 * require time — so the singleton is guaranteed to be set by then.
 *
 *   const { getStore } = require('../../store/instance');
 *
 *   module.exports.start = async (sock, m) => {
 *     const store = getStore();
 *     await store.addSubscriber('alienvault', m.sender);
 *   };
 *
 * NEVER call getStore() at module top-level — that would run during
 * require() and throw because lifecycle hasn't selected the store yet.
 */

let _store = null;

function setStore(store) {
  if (_store) throw new Error('store singleton already set');
  if (!store || typeof store !== 'object') {
    throw new Error('setStore() requires a store object');
  }
  _store = withTimelineHooks(store);
}

function getStore() {
  if (!_store) {
    throw new Error('store singleton not set — getStore() called before lifecycle.selectStore()');
  }
  return _store;
}

/** Test-only: clear the singleton between test cases. */
function __resetForTests() {
  _store = null;
}

// ─── v1.21.0 — subscription timeline hooks ──────────────────────────────────
// addSubscriber/removeSubscriber/recordSentItem/recordSentArticle are the
// single funnel every subscribe command and feed service goes through, so
// wrapping them here (once, all backends) lands the Subscriptions history
// without touching 12+ call sites. Rows land in the generic change timeline
// (GET /api/history/subscription → Subscriptions page HistoryPanel).
const _TIMELINE_HOOKS = {
  async addSubscriber(store, [service, jid]) {
    await store.recordTimelineEvent({
      domain: 'subscription',
      entityId: jid,
      field: 'subscribe',
      newValue: service,
      source: 'command',
    });
  },
  async removeSubscriber(store, [service, jid]) {
    await store.recordTimelineEvent({
      domain: 'subscription',
      entityId: jid,
      field: 'unsubscribe',
      oldValue: service,
      source: 'command',
    });
  },
  async recordSentItem(store, [service, jid, itemUrl]) {
    await store.recordTimelineEvent({
      domain: 'subscription',
      entityId: jid,
      field: `sent:${service}`,
      newValue: itemUrl,
      source: service,
    });
  },
  async recordSentArticle(store, [service, jid, itemUrl]) {
    await store.recordTimelineEvent({
      domain: 'subscription',
      entityId: jid,
      field: `sent:${service}`,
      newValue: itemUrl,
      source: service,
    });
  },
  async setAiChatOptIn(store, [chatJid, opts]) {
    await store.recordTimelineEvent({
      domain: 'ai',
      entityId: chatJid,
      field: 'config',
      newValue: JSON.stringify(opts || {}).slice(0, 1000),
      source: 'ai command',
    });
  },
};

function withTimelineHooks(store) {
  for (const [name, hook] of Object.entries(_TIMELINE_HOOKS)) {
    const orig = store[name];
    if (typeof orig !== 'function') continue;
    store[name] = async function (...args) {
      const result = await orig.apply(this, args);
      try {
        if (typeof store.recordTimelineEvent === 'function') await hook(store, args);
      } catch {
        /* timeline must never break the store call */
      }
      return result;
    };
  }
  return store;
}

module.exports = { setStore, getStore, __resetForTests };
