'use strict';
const { config } = require('../lib/configLoader');
const logger = require('../core/logger').child({ mod: 'call' });

module.exports = async function onCall({ sock, u }) {
  if (!Array.isArray(u)) return;
  for (const ev of u) {
    if (ev.status !== 'offer') continue;
    logger.info({ from: ev.from, isVideo: ev.isVideo }, 'incoming call');
    if (!config.options.antiCall) continue;
    try {
      await sock.rejectCall(ev.id, ev.from);
      await sock.sendMessage(ev.from, {
        text: '🚫 Calls are not accepted by this bot. Please send a message instead.',
      });
    } catch (e) { logger.warn({ err: e }, 'reject failed'); }
  }
};
