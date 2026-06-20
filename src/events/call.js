/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'call' });
const { config } = require('../lib/configLoader');

module.exports = async function onCall({ sock, u, callManager }) {
  if (!Array.isArray(u)) return;

  for (const ev of u) {
    if (ev.status !== 'offer') continue;

    logger.info({ from: ev.from, isVideo: ev.isVideo }, 'Incoming call offer');

    if (!callManager) {
      logger.warn('CallManager not available');
      return;
    }

    try {
      if (config.options?.antiCall) {
        await callManager.rejectCall(ev.id, ev.from);
        await sock.sendMessage(ev.from, {
          text: '🚫 Calls are not accepted by this bot. Please send a message instead.',
        });
        continue;
      }

      logger.info({ from: ev.from }, 'Accepting call');
      await callManager.handleOffer(ev.id, ev.from, ev.offer);
    } catch (err) {
      logger.error({ err, from: ev.from }, 'Error handling incoming call');
    }
  }
};
