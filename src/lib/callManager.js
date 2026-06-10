/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const dc = require('node-datachannel');
const logger = require('../core/logger').child({ mod: 'call-manager' });

class CallManager {
  constructor(sock) {
    this.sock = sock;
    this.activeCalls = new Map(); // callId -> { peer, from, state }
  }

  // ==================== ACCEPT CALL ====================
  async acceptCall(callId, from, offer) {
    logger.info({ from, callId }, 'Accepting call');

    const peer = new dc.PeerConnection(`call-${callId}`, {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    this.activeCalls.set(callId, { peer, from, state: 'connecting' });

    // Handle incoming media tracks
    peer.onTrack = (track) => {
      logger.info({ callId, kind: track.kind }, 'Received media track');
      if (track.kind === 'audio') this.handleAudioTrack(track, callId);
      if (track.kind === 'video') this.handleVideoTrack(track, callId);
    };

    // Send ICE candidates to remote peer
    peer.onIceCandidate = (candidate) => {
      this.sendSignalingMessage(from, {
        type: 'ice-candidate',
        callId,
        candidate,
      });
    };

    try {
      // Set remote description (offer from caller)
      await peer.setRemoteDescription(offer, 'offer');

      // Create and set local description (answer)
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      // Send answer back to caller
      this.sendSignalingMessage(from, {
        type: 'answer',
        callId,
        answer,
      });

      this.activeCalls.get(callId).state = 'connected';
      logger.info({ callId, from }, 'Call accepted and answer sent');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to accept call');
      this.endCall(callId);
    }

    return peer;
  }

  // ==================== REJECT CALL ====================
  async rejectCall(callId, from) {
    try {
      await this.sock.rejectCall(callId, from);
      logger.info({ from, callId }, 'Call rejected');
      this.endCall(callId);
    } catch (err) {
      logger.error({ err, callId }, 'Failed to reject call');
    }
  }

  // ==================== HANDLE REMOTE ICE CANDIDATE ====================
  async addRemoteCandidate(callId, candidate) {
    const call = this.activeCalls.get(callId);
    if (!call || !call.peer) {
      logger.warn({ callId }, 'No active peer for ICE candidate');
      return;
    }

    try {
      await call.peer.addRemoteCandidate(candidate);
      logger.debug({ callId }, 'Added remote ICE candidate');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to add remote ICE candidate');
    }
  }

  // ==================== HANDLE ANSWER FROM REMOTE ====================
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

  // ==================== MEDIA TRACK HANDLERS ====================
  handleAudioTrack(track, callId) {
    logger.info({ callId }, 'Audio track ready for processing');
    // You can record, play, or process audio here
  }

  handleVideoTrack(track, callId) {
    logger.info({ callId }, 'Video track ready for processing');
    // You can record or process video here
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

  // ==================== END CALL ====================
  endCall(callId) {
    const call = this.activeCalls.get(callId);
    if (call?.peer) {
      call.peer.close();
      this.activeCalls.delete(callId);
      logger.info({ callId }, 'Call ended and peer closed');
    }
  }
}

module.exports = { CallManager };