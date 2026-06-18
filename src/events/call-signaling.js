'use strict';

const logger = require('../core/logger').child({ mod: 'call-signaling' });

module.exports = async function onCallSignaling({ sock, m, data, callManager }) {
  if (!data || !callManager) return;

  const callId = data.callId;

  switch (data.type) {
    case 'answer':
      if (data.answer) {
        logger.info({ callId }, 'Received answer from remote peer');
        await callManager.handleAnswer(callId, data.answer);
      }
      break;

    case 'ice-candidate':
      if (data.candidate) {
        logger.debug({ callId }, 'Received ICE candidate from remote peer');
        await callManager.addRemoteCandidate(callId, data.candidate);
      }
      break;

    default:
      logger.debug({ type: data.type, callId }, 'Unknown call signaling type');
  }
};
