/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

const { LRUCache } = require('lru-cache');
const logger = require('../core/logger').child({ mod: 'presence.update' });
const { getStore } = require('../store/instance');

// In-memory cache for real-time presence (5 minute TTL)
const presenceCache = new LRUCache({
  max: 10_000,
  ttl: 1000 * 60 * 5, // 5 minutes
});

module.exports = async ({ u }) => {
  if (!u) return;

  const store = getStore();
  if (!store?.recordPresence) return;

  const list = Array.isArray(u) ? u : [u];

  for (const p of list) {
    if (!p?.id) continue;

    try {
      const presences = p.presences || {};
      const firstKey = Object.keys(presences)[0];
      const state = firstKey ? presences[firstKey]?.lastKnownPresence : null;

      // Update in-memory cache (fast path)
      presenceCache.set(p.id, {
        state: state || 'unknown',
        lastSeen: Date.now(),
      });

      // Only persist to database for meaningful states
      // (offline, unavailable, or when user was previously online)
      const meaningfulStates = ['unavailable', 'offline', 'available'];
      if (meaningfulStates.includes(state)) {
        await store.recordPresence(p.id, state, null, null);
      }
    } catch (err) {
      logger.debug({ err, jid: p.id }, 'presence update failed');
    }
  }
};

// Export cache so other modules (Contacts page) can read from it
module.exports.getPresenceCache = () => presenceCache;
