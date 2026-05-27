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
