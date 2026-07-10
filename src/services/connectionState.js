/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * connectionState — single source of truth for the Baileys connection
 * status (v1.17.0).
 *
 * Updated by worker.js on every `connection.update` event. Read by:
 *   • /api/health (returns 503 when disconnected)
 *   • $healthcheck admin command (future)
 *   • dashboard health badges (future)
 *
 * State is process-local. Not persisted — losing it on restart is fine
 * because boot quickly re-establishes it.
 */

let _state = {
  connection: 'pending', // 'pending' | 'connecting' | 'open' | 'close'
  lastChangedAt: 0,
  lastOpenAt: 0,
  lastCloseAt: 0,
  lastCloseCode: null,
  lastCloseReason: null,
  reconnectAttempts: 0,
};

function set({ connection, code, reason, reconnectAttempts } = {}) {
  const now = Math.floor(Date.now() / 1000);
  if (connection && connection !== _state.connection) {
    _state.lastChangedAt = now;
    if (connection === 'open') _state.lastOpenAt = now;
    if (connection === 'close') {
      _state.lastCloseAt = now;
      if (code != null) _state.lastCloseCode = code;
      if (reason != null) _state.lastCloseReason = String(reason).slice(0, 200);
    }
    _state.connection = connection;
  }
  if (typeof reconnectAttempts === 'number') _state.reconnectAttempts = reconnectAttempts;
}

function get() {
  return { ..._state };
}

function isConnected() {
  return _state.connection === 'open';
}

function _resetForTests() {
  _state = {
    connection: 'pending',
    lastChangedAt: 0,
    lastOpenAt: 0,
    lastCloseAt: 0,
    lastCloseCode: null,
    lastCloseReason: null,
    reconnectAttempts: 0,
  };
}

module.exports = { set, get, isConnected, _resetForTests };
