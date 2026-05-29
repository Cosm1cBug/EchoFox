/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details. @license AGPL-3.0
 *
 * You should have received a copy of the GNU AGPL along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 */
'use strict';
/**
 * Event router – thin dispatcher.
 * Keeps the worker file lean; each event type is in its own handler module.
 */
const { EventEmitter } = require('node:events');
const handleMessage = require('./messages.upsert');
const onGroupsUpdate = require('./groups.update');
const onGroupParticipants = require('./group-participants.update');
const onContactsUpsert = require('./contacts.upsert');
const onCall = require('./call');

const bus = new EventEmitter();
bus.setMaxListeners(50);

bus.on('groups.update', onGroupsUpdate);
bus.on('group-participants.update', onGroupParticipants);
bus.on('contacts.upsert', onContactsUpsert);
bus.on('call', onCall);

module.exports = {
  handleMessage,           // called directly from worker for back-pressure
  emit: (e, payload) => bus.emit(e, payload),
};