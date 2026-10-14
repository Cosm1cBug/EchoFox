/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * disconnectReasons — a complete classification of the codes WhatsApp can
 * put on a closed connection, and what the bot should DO about each one.
 *
 * Why this exists
 * ---------------
 * Baileys' own `DisconnectReason` enum only covers ten codes
 * (401/403/408/411/428/440/500/503/515). WhatsApp sends more than that, and
 * when it does Baileys passes the raw server code through untouched:
 *
 *   src/Socket/socket.js
 *     ws.on('CB:stream:error', (node) => {
 *       const { reason, statusCode } = getErrorCodeFromStreamError(node);
 *       end(new Boom(`Stream Errored (${reason})`, { statusCode, data: node }));
 *     });
 *
 * and `getErrorCodeFromStreamError` computes
 *     statusCode = +(node.attrs.code || CODE_MAP[reason] || badSession)
 * — i.e. whatever `code` attribute the server put on the <stream:error>
 * stanza becomes `lastDisconnect.error.output.statusCode` verbatim.
 *
 * So a bot that only knows the Baileys enum has no idea what to do with
 * e.g. 516, and typically falls through to its generic "reconnect" branch.
 * For 516 that is exactly backwards — see below.
 *
 * Two distinct namespaces
 * -----------------------
 *   515/516  → `<stream:error code="…">`  stream-level signalling
 *   400..503 → `<failure reason="…">`     connection-level failure
 * Both end up in the same `statusCode` slot, which is why they are mapped
 * together here.
 *
 * Mapping verified against the `zapo` WhatsApp protocol implementation
 * (src/protocol/stream.ts + src/client/coordinators/WaStreamControlCoordinator.ts),
 * which encodes this table and tests it against a fake WhatsApp server.
 */

/** `stream:error` code attributes. */
const WA_STREAM_SIGNALING = Object.freeze({
  /** 515 — server wants the client to *reconnect*. NORMAL after QR pairing. */
  FORCE_LOGIN_CODE: 515,
  /** 516 — server has *unlinked this session*. Credentials are dead. */
  FORCE_LOGOUT_CODE: 516,
});

/** `<failure reason="…">` codes. */
const WA_FAILURE_REASONS = Object.freeze({
  400: 'generic_failure',
  401: 'not_authorized',
  402: 'temp_banned',
  403: 'locked',
  405: 'client_too_old',
  406: 'banned',
  409: 'bad_user_agent',
  500: 'internal_server_error',
  501: 'experimental',
  503: 'service_unavailable',
});

/**
 * What to do about a disconnect.
 *   'reconnect' — transient; retry with the SAME credentials.
 *   're-pair'   — session is dead; wipe credentials and require a new scan.
 *   'stop'      — retrying is pointless or harmful; stop and alert a human.
 */
const ACTIONS = Object.freeze({
  RECONNECT: 'reconnect',
  REPAIR: 're-pair',
  STOP: 'stop',
});

/**
 * @param {number|undefined|null} code  lastDisconnect.error.output.statusCode
 * @returns {{
 *   code: number|null,
 *   action: string,
 *   reason: string,
 *   known: boolean,
 *   clearCredentials: boolean,
 *   advice: string|null,
 * }}
 */
function classifyDisconnect(code) {
  const n = Number(code);
  const has = Number.isFinite(n);

  // ── Stream-level signalling ───────────────────────────────────────────
  if (has && n === WA_STREAM_SIGNALING.FORCE_LOGIN_CODE) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'stream_error_force_login',
      known: true,
      clearCredentials: false,
      advice:
        'Server asked for a reconnect — expected right after QR/pairing. Reusing existing credentials.',
    };
  }

  if (has && n === WA_STREAM_SIGNALING.FORCE_LOGOUT_CODE) {
    return {
      code: n,
      action: ACTIONS.REPAIR,
      reason: 'stream_error_force_logout',
      known: true,
      clearCredentials: true,
      advice:
        'Server FORCED a logout — this session has been unlinked and its credentials are dead. ' +
        'Reconnecting with them cannot succeed and just hammers the server (which risks a ' +
        'temporary ban). Credentials are wiped so the next start offers a fresh QR / pairing code. ' +
        'Common underlying causes: an outdated WA Web client_revision, the device being removed ' +
        'from Linked Devices, an account lock, or a primary-identity-key change.',
    };
  }

  // ── Connection-level failures ─────────────────────────────────────────
  if (has && n === 401) {
    return {
      code: n,
      action: ACTIONS.REPAIR,
      reason: 'not_authorized',
      known: true,
      clearCredentials: true,
      advice: 'Session revoked (logout / device unlinked). Re-pair required.',
    };
  }

  if (has && n === 402) {
    return {
      code: n,
      action: ACTIONS.STOP,
      reason: 'temp_banned',
      known: true,
      clearCredentials: false,
      advice:
        'Account is temporarily banned. Credentials are KEPT — re-pairing will not help and ' +
        'retrying makes it worse. Stop the bot and wait it out.',
    };
  }

  if (has && n === 403) {
    return {
      code: n,
      action: ACTIONS.STOP,
      reason: 'locked',
      known: true,
      clearCredentials: false,
      advice:
        'Account is LOCKED. Credentials are deliberately KEPT: wiping them loses a session that ' +
        'is still valid once the lock lifts, and re-pairing will also fail while locked. ' +
        'Resolve the lock in the WhatsApp app first, then restart.',
    };
  }

  if (has && n === 405) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'client_too_old',
      known: true,
      clearCredentials: false,
      advice:
        'CLIENT_TOO_OLD — the WA Web client_revision this bot advertises is being rejected. ' +
        'Credentials are KEPT (they are fine). Fix the version, not the session: see ' +
        'lifecycle.fetchVersion() / config.network.waWebVersion.',
    };
  }

  if (has && n === 406) {
    return {
      code: n,
      action: ACTIONS.STOP,
      reason: 'banned',
      known: true,
      clearCredentials: false,
      advice: 'Account is BANNED. Credentials kept for the record; retrying will not help.',
    };
  }

  if (has && n === 409) {
    return {
      code: n,
      action: ACTIONS.STOP,
      reason: 'bad_user_agent',
      known: true,
      clearCredentials: false,
      advice:
        'BAD_USER_AGENT — the browser/device string is unacceptable to the server. ' +
        'Fix the socket `browser` option; reconnecting unchanged will be rejected again.',
    };
  }

  if (has && n === 500) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'internal_server_error',
      known: true,
      clearCredentials: false,
      advice: 'Server-side error. Safe to retry with backoff.',
    };
  }

  if (has && n === 501) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'experimental',
      known: true,
      clearCredentials: false,
      advice: 'Server is in an experimental state. Safe to retry with backoff.',
    };
  }

  if (has && n === 503) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'service_unavailable',
      known: true,
      clearCredentials: false,
      advice: 'Service unavailable. Safe to retry with backoff.',
    };
  }

  // ── Baileys-known codes worth naming explicitly ───────────────────────
  if (has && n === 440) {
    return {
      code: n,
      action: ACTIONS.RECONNECT,
      reason: 'connection_replaced',
      known: true,
      clearCredentials: false,
      advice:
        'Another client took over with the same credentials — usually a SECOND instance of this ' +
        'bot running. Check for a duplicate process before letting the reconnect loop run.',
    };
  }

  if (has && n === 411) {
    return {
      code: n,
      action: ACTIONS.REPAIR,
      reason: 'multidevice_mismatch',
      known: true,
      clearCredentials: true,
      advice: 'Multi-device mismatch — the stored session is not usable. Re-pair.',
    };
  }

  if ((has && n === 500) || (has && n === 0)) {
    // (already handled above; kept for clarity)
  }

  // ── Unknown ───────────────────────────────────────────────────────────
  return {
    code: has ? n : null,
    action: ACTIONS.RECONNECT,
    reason: 'unknown',
    known: false,
    clearCredentials: false,
    advice:
      'Unrecognised disconnect code. Treated as transient with backoff. If this repeats while ' +
      'linking a device, it is most likely a rejected WA Web client_revision — check ' +
      'config.network.waWebVersion and the logged waVersion.',
  };
}

module.exports = { WA_STREAM_SIGNALING, WA_FAILURE_REASONS, ACTIONS, classifyDisconnect };
