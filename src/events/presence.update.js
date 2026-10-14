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
  const meaningfulStates = ['unavailable', 'offline', 'available'];

  for (const p of list) {
    if (!p?.id) continue;

    // `p.id` is the CHAT jid. `p.presences` is a map of PARTICIPANT jid ->
    // presence. The previous implementation read only `Object.keys(presences)[0]`
    // and stored it against `p.id`, so:
    //   • for a 1:1 chat it happened to work (chat jid === participant jid)
    //   • for a GROUP it recorded ONE arbitrary participant's state against the
    //     GROUP jid, and silently dropped everyone else
    // The dashboard's per-contact presence dots need the participant, so we
    // now iterate every entry and key both the cache and the store by it.
    const presences = p.presences || {};
    const entries = Object.entries(presences);
    if (!entries.length) continue;

    for (const [participantJid, data] of entries) {
      if (!participantJid) continue;
      try {
        const state = data?.lastKnownPresence || null;
        const lastSeen = Number(data?.lastSeen) || null;

        // Update in-memory cache (fast path) — keyed by the PERSON.
        presenceCache.set(participantJid, {
          state: state || 'unknown',
          lastSeen: lastSeen || Date.now(),
        });

        // Persist only meaningful states. chatJid is recorded alongside so the
        // dashboard can scope presence to a conversation when it wants to.
        if (meaningfulStates.includes(state)) {
          await store.recordPresence(participantJid, state, lastSeen, p.id || null);
        }
      } catch (err) {
        logger.debug({ err, jid: participantJid }, 'presence update failed');
      }
    }
  }
};

// Export cache so other modules (Contacts page) can read from it
module.exports.getPresenceCache = () => presenceCache;
