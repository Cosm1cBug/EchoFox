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

const handleMessage              = require('./messages.upsert');
const onGroupsUpdate             = require('./groups.update');
const onGroupParticipants        = require('./group-participants.update');
const onContactsUpsert           = require('./contacts.upsert');
const onCall                     = require('./call');
const onMessagesUpdate           = require('./messages.update');
const onMessagesDelete           = require('./messages.delete');
const onMessageReaction          = require('./messages.reaction');
const onMessageReceipt           = require('./message-receipt.update');
const onNewsletterUpsert         = require('./newsletter.upsert');
const onNewsletterReaction       = require('./newsletter.reaction');
const onNewsletterView           = require('./newsletter.view');
const onNewsletterSettingsUpdate = require('./newsletter-settings.update');
const onBlocklistSet             = require('./blocklist.set');
const onBlocklistUpdate          = require('./blocklist.update');
const onLidMappingUpdate         = require('./lid-mapping.update');
const onMessagingHistorySet      = require('./messaging-history.set');
const onMessagingHistoryStatus   = require('./messaging-history.status');
const onChatsUpsert              = require('./chats.upsert');
const onChatsUpdate              = require('./chats.update');
const onChatsDelete              = require('./chats.delete');
const onPresenceUpdate           = require('./presence.update');
const onLabelsAssociation        = require('./labels.association');
const onLabelsEdit               = require('./labels.edit');
const onMessageCappingUpdate     = require('./message-capping.update');

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
bus.on('newsletter.upsert',         (p) => Promise.resolve(onNewsletterUpsert(p)).catch(() => {}));
bus.on('newsletter.reaction',       (p) => Promise.resolve(onNewsletterReaction(p)).catch(() => {}));
bus.on('newsletter.view',           (p) => Promise.resolve(onNewsletterView(p)).catch(() => {}));
bus.on('newsletter-settings.update',(p) => Promise.resolve(onNewsletterSettingsUpdate(p)).catch(() => {}));
bus.on('blocklist.set',             (p) => Promise.resolve(onBlocklistSet(p)).catch(() => {}));
bus.on('blocklist.update',          (p) => Promise.resolve(onBlocklistUpdate(p)).catch(() => {}));
bus.on('lid-mapping.update',        (p) => Promise.resolve(onLidMappingUpdate(p)).catch(() => {}));
bus.on('messaging-history.set',     (p) => Promise.resolve(onMessagingHistorySet(p)).catch(() => {}));
bus.on('messaging-history.status',  (p) => Promise.resolve(onMessagingHistoryStatus(p)).catch(() => {}));
bus.on('chats.upsert',              (p) => Promise.resolve(onChatsUpsert(p)).catch(() => {}));
bus.on('chats.update',              (p) => Promise.resolve(onChatsUpdate(p)).catch(() => {}));
bus.on('chats.delete',              (p) => Promise.resolve(onChatsDelete(p)).catch(() => {}));
bus.on('presence.update',           (p) => Promise.resolve(onPresenceUpdate(p)).catch(() => {}));
bus.on('labels.association',        (p) => Promise.resolve(onLabelsAssociation(p)).catch(() => {}));
bus.on('labels.edit',               (p) => Promise.resolve(onLabelsEdit(p)).catch(() => {}));
bus.on('message-capping.update',    (p) => Promise.resolve(onMessageCappingUpdate(p)).catch(() => {}));

module.exports = {
  handleMessage,
  emit: (e, payload) => bus.emit(e, payload),
};
