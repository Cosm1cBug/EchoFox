/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Presence-on-send middleware.
 *
 *   Wraps sock.sendMessage so every outbound message is preceded by an
 *   appropriate presence update ("typing…" / "recording…") with a small
 *   randomised human-like delay, then "paused" after sending.
 *
 *   Strategy (A+B hybrid):
 *     • Text body > config.antiBan.shortReplyChars  → 'composing' + delay
 *     • Audio / voice payload                       → 'recording' + delay
 *     • Sticker, image, video (no caption)          → no presence  (humans don't "type" these)
 *     • Reaction send (react: …)                    → no presence  (instant)
 *     • Caller passes { skipPresence: true }        → no presence  (system / crash channels)
 *     • Short text reply                            → no presence  (immediate, matches human reflex)
 *
 *   After sending, we always send 'paused' so the chat doesn't get
 *   stuck showing "typing…" forever if WhatsApp drops the close packet.
 *
 *   Failures of presence updates NEVER fail the actual send — presence
 *   is best-effort and silently logged at debug level.
 */

const { sleep } = require('../lib/Func');
const logger = require('../core/logger').child({ mod: 'presence' });

// ─── Helpers ─────────────────────────────────────────────────────────────
function randomInRange(min, max) {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

/**
 * Classify outbound `content` into a presence intent.
 *   Returns { kind: 'composing'|'recording'|null, textLen: number }
 */
function classifySend(content, opts) {
  if (opts?.skipPresence) return { kind: null, textLen: 0 };

  // Reactions are instant — humans don't typing-indicator a thumbs-up.
  if (content?.react) return { kind: null, textLen: 0 };

  // Audio (voice notes, songs)
  if (content?.audio || content?.ptt) {
    return { kind: 'recording', textLen: 0 };
  }

  // Pure-media (no caption) — sticker/image/video by themselves
  if (content?.sticker) return { kind: null, textLen: 0 };
  const textyMedia = content?.image || content?.video || content?.document;
  const caption    = content?.caption || '';
  if (textyMedia && !caption) return { kind: null, textLen: 0 };

  // Anything with body text
  const body = content?.text || caption || '';
  return { kind: 'composing', textLen: body.length };
}

// ─── Main wrap ──────────────────────────────────────────────────────────
function wrapWithPresence(sock, config) {
  if (sock._presenceWrapped) return sock.sendMessage;
  sock._presenceWrapped = true;

  const cfg = config.antiBan || {};
  const enabled        = cfg.typingIndicator !== false;
  const shortChars     = Math.max(1, cfg.shortReplyChars   ?? 40);
  const delayMin       = Math.max(0, cfg.typingDelayMs?.min ?? 800);
  const delayMax       = Math.max(delayMin, cfg.typingDelayMs?.max ?? 2500);
  const pauseAfter     = cfg.pauseAfterSend !== false;

  if (!enabled) {
    logger.info('presence-on-send disabled by config.antiBan.typingIndicator=false');
    return sock.sendMessage;
  }

  const original = sock.sendMessage.bind(sock);

  sock.sendMessage = async function(jid, content, options = {}) {
    const { kind, textLen } = classifySend(content, options);
    const shouldShow = kind !== null && (kind === 'recording' || textLen > shortChars);

    if (!shouldShow) {
      // Fast path — no presence, no delay
      return original(jid, content, options);
    }

    // Show typing/recording
    try {
      await sock.sendPresenceUpdate(kind, jid);
    } catch (e) {
      logger.debug({ err: e, jid, kind }, 'sendPresenceUpdate failed (continuing)');
    }

    // Randomised human-like delay (capped by textLen for very long replies
    // so a 4000-char reply still gets <3s typing — beyond that feels fake).
    const wait = Math.min(
      delayMax,
      randomInRange(delayMin, delayMax) + Math.min(2000, Math.floor(textLen / 5)),
    );
    await sleep(wait);

    let sent;
    try {
      sent = await original(jid, content, options);
    } finally {
      if (pauseAfter) {
        sock.sendPresenceUpdate('paused', jid).catch(() => {});
      }
    }
    return sent;
  };

  // expose for diagnostics
  sock.sendMessage._wrappedByPresence = true;
  logger.info({ shortChars, delayMin, delayMax }, 'presence-on-send wired');
  return sock.sendMessage;
}

module.exports = { wrapWithPresence, classifySend };
