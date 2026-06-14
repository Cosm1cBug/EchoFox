/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';
/**
 * Outbound send queue – guarantees we never have more than N concurrent
 * sendMessage calls (default 4). WhatsApp WS handles parallelism poorly
 * past ~5 in-flight messages on the same socket; this caps it cleanly.
 *
 *   const safeSend = wrapSocketSend(sock);   // call once after connect
 *   await safeSend(jid, { text: 'hi' });
 */
const PQueue = require('p-queue').default;

function wrapSocketSend(sock, { concurrency = 4 } = {}) {
  const q = new PQueue({ concurrency });
  const original = sock.sendMessage.bind(sock);
  sock.sendMessage = (jid, content, options) => q.add(() => original(jid, content, options));
  sock.sendMessage.queueSize = () => q.size + q.pending;
  return sock.sendMessage;
}

module.exports = { wrapSocketSend };
