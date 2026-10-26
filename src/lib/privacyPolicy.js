/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('./configLoader');

function isExcluded(jid) {
  return !jid || (config.privacy?.excludeFromStore || []).includes(jid);
}
function canStoreMessageBodies(jid) {
  return !isExcluded(jid) && config.privacy?.storeMessageBodies !== false;
}
function canStoreAiMemory(jid) {
  return canStoreMessageBodies(jid) && Number(config.ai?.memoryTurns ?? 20) > 0;
}

/** Apply the SAME content policy to all adapter entry points (including direct
 * adapter users, not just events). Re-check on every call so old cache/database
 * content is not exposed after policy changes. Does not silently purge old data.
 */
function withPrivacyPolicy(store) {
  const methods = {
    getMessage: { jid: (key) => key?.remoteJid, empty: () => undefined },
    recordMessageEdit: {},
    updateMessageBody: {},
    getMessageEdits: { empty: () => [] },
    getRecentMessages: { empty: () => [] },
    listMessages: { empty: () => [] },
    appendAiTurn: { allowed: canStoreAiMemory, empty: () => false },
    getRecentAiTurns: { allowed: canStoreAiMemory, empty: () => [] },
  };
  for (const [name, policy] of Object.entries(methods)) {
    if (typeof store[name] !== 'function') continue;
    const original = store[name];
    store[name] = function (...args) {
      if (name === 'getRecentAiTurns' && args[1] !== undefined && Number(args[1]) <= 0) return [];
      const jid = policy.jid ? policy.jid(args[0]) : args[0];
      if (!(policy.allowed || canStoreMessageBodies)(jid)) return policy.empty?.();
      return original.apply(this, args);
    };
  }
  // Excluded chats must not enter the timeline through AI/metadata wrappers.
  if (typeof store.recordTimelineEvent === 'function') {
    const original = store.recordTimelineEvent;
    store.recordTimelineEvent = function (event) {
      if (event?.entityId && isExcluded(event.entityId)) return;
      return original.call(this, event);
    };
  }
  return store;
}

module.exports = { isExcluded, canStoreMessageBodies, canStoreAiMemory, withPrivacyPolicy };
