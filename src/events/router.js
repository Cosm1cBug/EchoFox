/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Event router – thin dispatcher.
 *
 * Keeps the worker file lean; each event type lives in its own handler.
 * Async handlers are invoked but not awaited at the bus level — the
 * underlying handler is responsible for its own error handling.
 */
const { EventEmitter } = require('node:events');

const handleMessage        = require('./messages.upsert');
const onGroupsUpdate       = require('./groups.update');
const onGroupParticipants  = require('./group-participants.update');
const onContactsUpsert     = require('./contacts.upsert');
const onCall               = require('./call');
const onMessagesUpdate     = require('./messages.update');
const onMessagesDelete     = require('./messages.delete');
const onMessageReaction    = require('./messages.reaction');
const onMessageReceipt     = require('./message-receipt.update');

const bus = new EventEmitter();
bus.setMaxListeners(50);

bus.on('groups.update',             (p) => Promise.resolve(onGroupsUpdate(p)).catch(() => {}));
bus.on('group-participants.update', (p) => Promise.resolve(onGroupParticipants(p)).catch(() => {}));
bus.on('contacts.upsert',           (p) => Promise.resolve(onContactsUpsert(p)).catch(() => {}));
bus.on('call',                      (p) => Promise.resolve(onCall(p)).catch(() => {}));
bus.on('messages.update',           (p) => Promise.resolve(onMessagesUpdate(p)).catch(() => {}));
bus.on('messages.delete',           (p) => Promise.resolve(onMessagesDelete(p)).catch(() => {}));
bus.on('messages.reaction',         (p) => Promise.resolve(onMessageReaction(p)).catch(() => {}));
bus.on('message-receipt.update',    (p) => Promise.resolve(onMessageReceipt(p)).catch(() => {}));

module.exports = {
  handleMessage,                                 // direct, called per-message for back-pressure
  emit: (e, payload) => bus.emit(e, payload),
};
