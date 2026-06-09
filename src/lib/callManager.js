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
    this.activeCalls = new Map(); // callId -> { peer, from }
  }

  async handleOffer(callId, from, offer) {
    logger.info({ from, callId }, 'Received call offer');

    const peer = new dc.PeerConnection(`call-${callId}`, {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    this.activeCalls.set(callId, { peer, from });

    // Handle incoming media tracks
    peer.onTrack = (track) => {
      logger.info({ callId, kind: track.kind }, 'Received media track');
      if (track.kind === 'audio') this.handleAudioTrack(track, callId);
      if (track.kind === 'video') this.handleVideoTrack(track, callId);
    };

    // Send local ICE candidates to the remote peer
    peer.onIceCandidate = (candidate) => {
      logger.debug({ callId, candidate }, 'Generated ICE candidate');
      // TODO: Send this candidate to the caller via WhatsApp signaling
      this.sendIceCandidate(callId, from, candidate);
    };

    try {
      // Set remote description (offer)
      await peer.setRemoteDescription(offer, 'offer');

      // Create answer
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      // Send answer back to caller
      this.sendAnswer(callId, from, answer);

      logger.info({ callId, from }, 'Answer sent');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to handle offer');
    }

    return peer;
  }

  // Send Answer via WhatsApp (you'll implement signaling here)
  async sendAnswer(callId, from, answer) {
    try {
      // Example: Send answer as a message or custom signaling
      await this.sock.sendMessage(from, {
        text: JSON.stringify({ type: 'answer', callId, answer }),
      });
      logger.info({ callId, from }, 'Answer sent to caller');
    } catch (err) {
      logger.error({ err, callId }, 'Failed to send answer');
    }
  }

  // Send ICE Candidate via WhatsApp
  async sendIceCandidate(callId, from, candidate) {
    try {
      await this.sock.sendMessage(from, {
        text: JSON.stringify({ type: 'ice-candidate', callId, candidate }),
      });
    } catch (err) {
      logger.error({ err, callId }, 'Failed to send ICE candidate');
    }
  }

  handleAudioTrack(track, callId) {
    logger.info({ callId }, 'Audio track ready');
  }

  handleVideoTrack(track, callId) {
    logger.info({ callId }, 'Video track ready');
  }

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