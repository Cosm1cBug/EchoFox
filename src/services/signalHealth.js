/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Signal-protocol self-healing for Baileys decryption failures (v1.4.2).
 *
 * Background:
 *   Every WhatsApp conversation maintains a Signal session (a chain of
 *   cryptographic ratchets) per sender device. When a sender's device
 *   state drifts (reinstall, new device pair, key rotation), decryption
 *   fails with one of:
 *     - "Bad MAC"                       → libsignal MAC verification failed
 *     - "No session found to decrypt"   → ratchet completely missing
 *
 *   Baileys logs these at ERROR and waits for natural recovery on the
 *   next message exchange. This module accelerates recovery by:
 *
 *     1. Counting consecutive failures per (sender JID, message-type).
 *     2. When a JID hits FAILURE_THRESHOLD within FAILURE_WINDOW_MS,
 *        invoking sock.signalRepository.deleteSession(jid). The next
 *        message from that sender triggers a fresh prekey exchange,
 *        which usually restores decryption.
 *     3. Honouring a per-JID cooldown so we never thrash the session
 *        store more than once per RECOVERY_COOLDOWN_MS.
 *     4. Emitting metrics so you can watch the situation in Grafana.
 *
 * Ban risk:
 *   deleteSession() is a LOCAL filesystem operation. No WhatsApp
 *   servers are contacted; no traffic crosses the wire. Recovery is
 *   driven by the next inbound message triggering Signal's standard
 *   prekey-fetch flow — the same flow that runs millions of times a
 *   day for every reinstall/key-rotation on the platform. Safe.
 *
 * Defaults (per-JID):
 *   FAILURE_THRESHOLD       = 3      consecutive failures
 *   FAILURE_WINDOW_MS       = 5min   counting window
 *   RECOVERY_COOLDOWN_MS    = 30min  cap recoveries to ~2/hr per JID
 *   MAP_PRUNE_INTERVAL_MS   = 10min  bound memory
 *
 *   These are static for v1.4.2 — can be lifted to config in a later
 *   release if anyone needs to tune them.
 */
const logger  = require('../core/logger').child({ mod: 'signal-health' });
const metrics = require('./metrics');

const FAILURE_THRESHOLD     = 3;
const FAILURE_WINDOW_MS     = 5  * 60 * 1000;
const RECOVERY_COOLDOWN_MS  = 30 * 60 * 1000;
const MAP_PRUNE_INTERVAL_MS = 10 * 60 * 1000;

// jid -> { count, firstFailureTs, lastFailureTs }
const _failures  = new Map();
// jid -> lastRecoveryTs
const _recoveries = new Map();

// Static recognisers — matched against Error.message
const KNOWN_PATTERNS = [
  /Bad MAC/i,
  /No session found to decrypt/i,
  /No matching sessions found/i,
  /InvalidSignedPreKeyId/i,
  /No identity key/i,
];

function _isDecryptionFailure(err) {
  if (!err) return false;
  const msg = String(err.message || err);
  return KNOWN_PATTERNS.some((re) => re.test(msg));
}

/**
 * Normalise a JID to its base form so '5511...@s.whatsapp.net' and
 * '262516...:74@lid' both bucket correctly. We strip ':device' tags
 * but keep the @lid vs @s.whatsapp.net distinction (different domains
 * map to different sessions in libsignal).
 */
function _normaliseJid(jid) {
  if (!jid) return '';
  const s = String(jid);
  const colon = s.indexOf(':');
  if (colon < 0) return s;
  const at = s.indexOf('@', colon);
  if (at < 0) return s.slice(0, colon);
  return s.slice(0, colon) + s.slice(at);
}

/**
 * Public entry. Call from your Baileys logger hook with the original
 * log object — same shape Baileys passes to its pino instance.
 *
 *   record(logObj)
 *     logObj.err          required — the libsignal/Baileys error
 *     logObj.key          required — { remoteJid, participant, ... }
 *     logObj.author       optional — falls back to key.participant or key.remoteJid
 *     logObj.messageType  optional — 'pkmsg' | 'msg' | 'skmsg'
 *
 *   returns { matched: boolean, jid?: string, count?: number,
 *             willRecover?: boolean, recovered?: boolean }
 *
 *   matched=false means it wasn't a known decryption failure pattern;
 *   the caller should keep the original ERROR-level log.
 *   matched=true means we've handled it (counted + maybe triggered
 *   recovery) and the caller should demote the log to debug.
 */
async function record(sock, logObj) {
  if (!logObj || !_isDecryptionFailure(logObj.err)) {
    return { matched: false };
  }

  metrics.incDecryptionFailure();

  const rawJid =
        logObj.author
     || logObj.key?.participant
     || logObj.key?.participantAlt
     || logObj.key?.remoteJid
     || '';
  const jid = _normaliseJid(rawJid);
  if (!jid) return { matched: true, jid: '', count: 0 };

  const now = Date.now();
  const cur = _failures.get(jid);

  // Outside the counting window? reset.
  if (!cur || (now - cur.firstFailureTs) > FAILURE_WINDOW_MS) {
    _failures.set(jid, { count: 1, firstFailureTs: now, lastFailureTs: now });
    return { matched: true, jid, count: 1, willRecover: false };
  }

  cur.count += 1;
  cur.lastFailureTs = now;

  if (cur.count < FAILURE_THRESHOLD) {
    return { matched: true, jid, count: cur.count, willRecover: false };
  }

  // Threshold hit — check cooldown
  const lastRec = _recoveries.get(jid) || 0;
  if ((now - lastRec) < RECOVERY_COOLDOWN_MS) {
    return { matched: true, jid, count: cur.count, willRecover: false, onCooldown: true };
  }

  // Trigger recovery
  return _triggerRecovery(sock, jid, cur);
}

async function _triggerRecovery(sock, jid, cur) {
  const now = Date.now();
  _recoveries.set(jid, now);
  // Reset counter so we don't immediately re-trigger
  _failures.delete(jid);

  try {
    if (sock?.signalRepository?.deleteSession) {
      await sock.signalRepository.deleteSession(jid);
    } else if (sock?.authState?.keys?.set) {
      // Older Baileys: clear session keys directly
      await sock.authState.keys.set({ session: { [jid]: null } });
    } else {
      logger.warn({ jid }, 'no signalRepository.deleteSession available; recovery skipped');
      return { matched: true, jid, count: cur.count, willRecover: false, recovered: false };
    }

    metrics.incDecryptionRecovery();
    logger.warn({ jid, failuresInWindow: cur.count },
      '🩹 signal-health: session reset for sender after consecutive decryption failures');
    return { matched: true, jid, count: cur.count, willRecover: true, recovered: true };
  } catch (e) {
    logger.warn({ err: e, jid }, 'signal-health: deleteSession failed');
    return { matched: true, jid, count: cur.count, willRecover: true, recovered: false, error: e.message };
  }
}

// Periodic prune so the Maps don't grow unbounded in a bot that's been
// running for weeks. Drops entries older than FAILURE_WINDOW_MS or
// RECOVERY_COOLDOWN_MS respectively.
const _pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [jid, v] of _failures) {
    if ((now - v.lastFailureTs) > FAILURE_WINDOW_MS) _failures.delete(jid);
  }
  for (const [jid, ts] of _recoveries) {
    if ((now - ts) > RECOVERY_COOLDOWN_MS) _recoveries.delete(jid);
  }
}, MAP_PRUNE_INTERVAL_MS);
if (typeof _pruneTimer.unref === 'function') _pruneTimer.unref();

function snapshot() {
  return {
    trackedFailureJids: _failures.size,
    cooldownJids:       _recoveries.size,
    thresholds: {
      failureThreshold:     FAILURE_THRESHOLD,
      failureWindowMs:      FAILURE_WINDOW_MS,
      recoveryCooldownMs:   RECOVERY_COOLDOWN_MS,
    },
  };
}

function _resetForTests() {
  _failures.clear();
  _recoveries.clear();
}

module.exports = {
  record,
  snapshot,
  // exported for tests + tuning
  _isDecryptionFailure,
  _normaliseJid,
  _resetForTests,
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  RECOVERY_COOLDOWN_MS,
};
