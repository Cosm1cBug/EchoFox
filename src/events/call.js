/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { config } = require('../lib/configLoader');
const logger = require('../core/logger').child({ mod: 'call' });

// Optional: Import node-datachannel when you're ready for media handling
// const dc = require('node-datachannel');

module.exports = async function onCall({ sock, u }) {
  if (!Array.isArray(u)) return;

  for (const ev of u) {
    if (ev.status !== 'offer') continue;

    logger.info({ from: ev.from, isVideo: ev.isVideo }, 'Incoming call');

    // If anti-call is enabled, reject the call
    if (config.options?.antiCall) {
      try {
        await sock.rejectCall(ev.id, ev.from);
        await sock.sendMessage(ev.from, {
          text: '🚫 Calls are not accepted by this bot. Please send a message instead.',
        });
        logger.info({ from: ev.from }, 'Call rejected (antiCall enabled)');
      } catch (e) {
        logger.warn({ err: e, from: ev.from }, 'Failed to reject call');
      }
      continue;
    }

    // If antiCall is disabled, we can accept the call (advanced path)
    try {
      logger.info({ from: ev.from }, 'Accepting call (antiCall disabled)');

      // For now, we just accept the call signaling.
      // Full media handling with node-datachannel can be added later.
      await sock.sendMessage(ev.from, {
        text: '📞 Call accepted. Media handling is under development.',
      });

      // Future: Initialize node-datachannel peer connection here
      // const peer = new dc.PeerConnection(...);
    } catch (e) {
      logger.error({ err: e, from: ev.from }, 'Failed to accept call');
    }
  }
};