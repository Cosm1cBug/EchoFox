/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'call-manager' });

class CallManager {
  constructor(sock) {
    this.sock = sock;
    this.activeCalls = new Map(); // callId -> { peer, from, state }
  }

  // ==================== REJECT CALL ====================
  // v1.20.2 (E7): EchoFox auto-declines every call (product decision). The
  // previous handleOffer() accept path — which called setRemoteDescription
  // with a non-existent `ev.offer` and therefore always threw — has been
  // removed. Only the working reject path is used (src/events/call.js).
  async rejectCall(callId, from) {
    try {
      await this.sock.rejectCall(callId, from);
      logger.info({ from, callId }, 'Call rejected');
      this.endCall(callId);
    } catch (err) {
      logger.error({ err, callId }, 'Failed to reject call');
    }
  }

  // ==================== HANDLE REMOTE ANSWER ====================
  async handleAnswer(callId, answer) {
    const call = this.activeCalls.get(callId);
    if (!call || !call.peer) return;

    try {
      await call.peer.setRemoteDescription(answer, 'answer');
      logger.info({ callId }, 'Remote answer set');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to set remote answer');
    }
  }

  // ==================== HANDLE REMOTE ICE CANDIDATE ====================
  async addRemoteCandidate(callId, candidate) {
    const call = this.activeCalls.get(callId);
    if (!call || !call.peer) return;

    try {
      await call.peer.addRemoteCandidate(candidate);
      logger.debug({ callId }, 'Added remote ICE candidate');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to add remote ICE candidate');
    }
  }

  // ==================== SEND SIGNALING MESSAGES ====================
  async sendSignalingMessage(to, message) {
    try {
      await this.sock.sendMessage(to, {
        text: JSON.stringify(message),
      });
    } catch (err) {
      logger.error({ err, to }, 'Failed to send signaling message');
    }
  }

  // ==================== MEDIA TRACK HANDLERS ====================
  handleAudioTrack(track, callId) {
    logger.info({ callId }, 'Audio track ready for processing');
  }

  handleVideoTrack(track, callId) {
    logger.info({ callId }, 'Video track ready for processing');
  }

  // ==================== END CALL ====================
  endCall(callId) {
    const call = this.activeCalls.get(callId);
    if (call?.peer) {
      call.peer.close();
      this.activeCalls.delete(callId);
      logger.info({ callId }, 'Call ended');
    }
  }
}

module.exports = { CallManager };
