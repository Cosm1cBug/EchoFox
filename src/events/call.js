/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'call' });
const { config } = require('../lib/configLoader');

/**
 * call — incoming WhatsApp call offers.
 *
 * Baileys 7.x payload: WACallEvent[] with
 *   { id, from, callerPn?, isGroup?, groupJid?, chatId, date, isVideo,
 *     status: 'offer'|'ringing'|'timeout'|'reject'|…, offline?, latencyMs? }
 * (verified: Types/Events.ts + Types/Call.ts — there is NO `offer`/SDP field).
 *
 * v1.20.2 (E7, product decision): EchoFox AUTO-DECLINES every call via the
 * working reject path (`sock.rejectCall`). The previous accept branch passed
 * `ev.offer` into the WebRTC peer — a field that does not exist — so
 * accepting always threw and the call kept ringing; that accept machinery
 * (CallManager.handleOffer) is gone.
 *
 * `config.options.antiCall` no longer gates WHETHER a call is declined — it
 * only controls the courtesy "please send a message" auto-reply.
 */
module.exports = async function onCall({ sock, u, callManager }) {
  if (!Array.isArray(u)) return;

  const { recordTimeline, safeGetStore } = require('../lib/timelineLog');

  for (const ev of u) {
    if (ev.status !== 'offer') continue;

    // v1.21.0 — call history (queryable via GET /api/history/call; shown on
    // the Diagnostics page). Every offer is recorded — accepted, declined or
    // errored — so missed-call attempts are auditable.
    await recordTimeline(safeGetStore(), {
      domain: 'call',
      entityId: ev.from,
      field: 'offer',
      newValue: `${ev.isVideo ? 'video' : 'voice'}${ev.isGroup ? ' group' : ''}`,
      source: 'call',
    });

    logger.info(
      { from: ev.from, isVideo: ev.isVideo, id: ev.id },
      'Incoming call offer — auto-declining',
    );

    if (!callManager) {
      logger.warn({ id: ev.id }, 'CallManager not available — cannot decline call');
      continue;
    }

    try {
      await callManager.rejectCall(ev.id, ev.from);
    } catch (err) {
      logger.error({ err, from: ev.from }, 'Error declining incoming call');
      continue;
    }

    if (config.options?.antiCall) {
      try {
        await sock.sendMessage(ev.from, {
          text: '🚫 Calls are not accepted by this bot. Please send a message instead.',
        });
      } catch (err) {
        logger.debug({ err, from: ev.from }, 'call auto-reply failed');
      }
    }
  }
};
