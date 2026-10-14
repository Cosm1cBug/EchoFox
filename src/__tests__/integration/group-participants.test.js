/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Regression tests for the group-participants.update handler.
 *
 * Baileys 7.x emits `participants: GroupParticipant[]` — OBJECTS shaped like
 * { id, phoneNumber, admin }. The handler used to pass that object straight
 * through, which caused three failures at once:
 *
 *   1. `recordParticipantEvent(groupJid, p, …)` bound an object into SQLite
 *      → RangeError "Too few parameter values were provided" → caught and
 *      logged at WARN → the event table stayed EMPTY, so the dashboard's
 *      participant history was permanently blank.
 *   2. `classifyAction(raw, author, p)` compared a string to an object, so
 *      the comparison was always false and EVERY removal was labelled 'kick'
 *      — voluntary leaves included.
 *   3. `participant.split('@')` in the channel notice threw, so the
 *      groupUpdates post and greeting dispatch never ran.
 *
 * These tests pin the corrected behaviour.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { LRUCache } = require('lru-cache');

const { makeSQLiteStore } = require('../../store/sqliteStore');
const { classifyAction, _participantId } = require('../../store/schema/participants');

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return this;
  },
};

function makeStore() {
  return makeSQLiteStore({
    dbPath: ':memory:',
    logger,
    groupCache: new LRUCache({ max: 10 }),
  });
}

const sock = {
  groupMetadata: async () => ({ subject: 'Test Group', participants: [] }),
  sendMessage: async () => {},
};

/** A payload in the exact shape the production logs showed. */
const userPayload = {
  id: '120363369772785326@g.us',
  author: '210058713501749@lid',
  action: 'remove',
  participants: [
    { id: '210058713501749@lid', phoneNumber: '94771014973@s.whatsapp.net', admin: null },
  ],
};

test('_participantId extracts the JID from a GroupParticipant object', () => {
  assert.equal(
    _participantId({ id: '210058713501749@lid', phoneNumber: '94771014973@s.whatsapp.net' }),
    '210058713501749@lid',
  );
  // must NOT stringify the object
  assert.notEqual(String(_participantId(userPayload.participants[0])), '[object Object]');
  // plain strings still pass through (older payloads / callers)
  assert.equal(_participantId('1234@s.whatsapp.net'), '1234@s.whatsapp.net');
  assert.equal(_participantId(null), null);
});

test('classifyAction compares against the extracted id, not the object', () => {
  const obj = { id: 'a@lid', phoneNumber: 'b@s.whatsapp.net', admin: null };
  // author === participant → voluntary leave (this returned 'kick' before)
  assert.equal(classifyAction('remove', 'a@lid', obj), 'leave');
  // author !== participant → admin removal
  assert.equal(classifyAction('remove', 'admin@lid', obj), 'kick');
  assert.equal(classifyAction('remove', null, obj), 'kick');
  assert.equal(classifyAction('add', 'admin@lid', obj), 'add');
  assert.equal(classifyAction('promote', 'admin@lid', obj), 'promote');
});

test('handler persists an event for a GroupParticipant object payload', async () => {
  const store = makeStore();
  const handler = require('../../events/group-participants.update');

  await handler({ sock, store, u: userPayload });

  const history = await store.getParticipantHistory(userPayload.id, 10);
  assert.equal(history.length, 1, 'the event must actually be written (was 0)');

  const row = history[0];
  assert.equal(row.participant, '210058713501749@lid');
  assert.equal(typeof row.participant, 'string', 'participant column must hold a JID string');
  // author === participant in this payload → a voluntary leave
  assert.equal(row.action, 'leave');
  assert.equal(row.actor, '210058713501749@lid');
  assert.ok(Number.isInteger(row.ts) && row.ts > 0);

  store.close();
});

test('handler classifies an admin removal as a kick', async () => {
  const store = makeStore();
  const handler = require('../../events/group-participants.update');

  await handler({
    sock,
    store,
    u: {
      id: 'kickgroup@g.us',
      author: '9999999999@lid',
      action: 'remove',
      participants: [{ id: '5555555555@lid', phoneNumber: '915555555555@s.whatsapp.net' }],
    },
  });

  const history = await store.getParticipantHistory('kickgroup@g.us', 5);
  assert.equal(history.length, 1);
  assert.equal(history[0].action, 'kick');
  assert.equal(history[0].participant, '5555555555@lid');
  assert.equal(history[0].actor, '9999999999@lid');

  store.close();
});

test('handler persists one row per participant in a multi-participant event', async () => {
  const store = makeStore();
  const handler = require('../../events/group-participants.update');

  await handler({
    sock,
    store,
    u: {
      id: 'multi@g.us',
      author: 'admin@lid',
      action: 'remove',
      participants: [{ id: 'p1@lid' }, { id: 'p2@lid' }, { id: 'p3@lid' }],
    },
  });

  const history = await store.getParticipantHistory('multi@g.us', 10);
  assert.equal(history.length, 3, 'every participant must produce a row');
  assert.deepEqual(history.map((r) => r.participant).sort(), ['p1@lid', 'p2@lid', 'p3@lid']);

  store.close();
});

test('handler tolerates a plain-string participant (older payload shape)', async () => {
  const store = makeStore();
  const handler = require('../../events/group-participants.update');

  await handler({
    sock,
    store,
    u: { id: 'legacy@g.us', author: 'a@lid', action: 'remove', participants: ['b@lid'] },
  });

  const history = await store.getParticipantHistory('legacy@g.us', 5);
  assert.equal(history.length, 1);
  assert.equal(history[0].participant, 'b@lid');

  store.close();
});

test('handler ignores a participant with no resolvable id', async () => {
  const store = makeStore();
  const handler = require('../../events/group-participants.update');

  await handler({
    sock,
    store,
    u: { id: 'bad@g.us', author: 'a@lid', action: 'remove', participants: [{}] },
  });

  const history = await store.getParticipantHistory('bad@g.us', 5);
  assert.equal(history.length, 0, 'no id → nothing to record, and no crash');

  store.close();
});
