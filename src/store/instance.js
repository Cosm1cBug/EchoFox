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
  _store = store;
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

module.exports = { setStore, getStore, __resetForTests };
