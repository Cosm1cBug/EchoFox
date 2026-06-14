/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { CallManager } = require('../lib/callManager');

let callManager = null;

module.exports = async ({ sock, u }) => {
  if (!callManager) callManager = new CallManager(sock);

  for (const ev of u) {
    if (ev.status === 'offer') {
      // When you receive an offer, pass it to the manager
      await callManager.handleOffer(ev.id, ev.from, ev.offer);
    }
  }
};
