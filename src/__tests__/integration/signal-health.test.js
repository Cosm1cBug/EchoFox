/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Integration tests for the v1.4.2 signal-health self-healing service.
 *
 *   Run:  node --test src/__tests__/integration/signal-health.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const signalHealth = require('../../services/signalHealth');

// Minimal mock sock — captures deleteSession calls so we can assert
function makeMockSock() {
  const deletions = [];
  return {
    deletions,
    signalRepository: {
      async deleteSession(jid) {
        deletions.push(jid);
      },
    },
  };
}

function badMacLogObj(participant) {
  return {
    err: new Error('Bad MAC'),
    key: {
      remoteJid: '120363324400552303@g.us',
      fromMe: false,
      id: 'TEST_ID',
      participant,
    },
    messageType: 'pkmsg',
    author: participant,
  };
}

function noSessionLogObj(participant) {
  return {
    err: new Error('No session found to decrypt message'),
    key: { remoteJid: 'x@g.us', participant },
    messageType: 'skmsg',
    author: participant,
  };
}

test('_isDecryptionFailure recognises known patterns', () => {
  assert.equal(signalHealth._isDecryptionFailure(new Error('Bad MAC')), true);
  assert.equal(
    signalHealth._isDecryptionFailure(new Error('No session found to decrypt message')),
    true,
  );
  assert.equal(signalHealth._isDecryptionFailure(new Error('No matching sessions found')), true);
  assert.equal(signalHealth._isDecryptionFailure(new Error('InvalidSignedPreKeyId')), true);
  assert.equal(signalHealth._isDecryptionFailure(new Error('Some other error')), false);
  assert.equal(signalHealth._isDecryptionFailure(null), false);
  assert.equal(signalHealth._isDecryptionFailure(undefined), false);
});

test('_normaliseJid strips device tags', () => {
  assert.equal(signalHealth._normaliseJid('262516991086663:74@lid'), '262516991086663@lid');
  assert.equal(
    signalHealth._normaliseJid('5511960847865:42@s.whatsapp.net'),
    '5511960847865@s.whatsapp.net',
  );
  assert.equal(
    signalHealth._normaliseJid('5511960847865@s.whatsapp.net'),
    '5511960847865@s.whatsapp.net',
  );
  assert.equal(signalHealth._normaliseJid('alice:1'), 'alice');
  assert.equal(signalHealth._normaliseJid(''), '');
  assert.equal(signalHealth._normaliseJid(null), '');
});

test('record() ignores non-decryption errors', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();
  const r = await signalHealth.record(sock, {
    err: new Error('something else'),
    key: { participant: 'x@lid' },
  });
  assert.equal(r.matched, false);
  assert.equal(sock.deletions.length, 0);
});

test('record() counts decryption failures per JID without auto-recovering below threshold', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();

  const r1 = await signalHealth.record(sock, badMacLogObj('alice:1@lid'));
  assert.equal(r1.matched, true);
  assert.equal(r1.jid, 'alice@lid');
  assert.equal(r1.count, 1);
  assert.equal(r1.willRecover, false);

  const r2 = await signalHealth.record(sock, badMacLogObj('alice:1@lid'));
  assert.equal(r2.count, 2);
  assert.equal(r2.willRecover, false);

  assert.equal(sock.deletions.length, 0, 'must not delete session below threshold');
});

test('record() triggers deleteSession at threshold (3 failures)', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();

  for (let i = 0; i < 2; i += 1) {
    await signalHealth.record(sock, badMacLogObj('bob:5@lid'));
  }
  assert.equal(sock.deletions.length, 0);

  const r3 = await signalHealth.record(sock, badMacLogObj('bob:5@lid'));
  assert.equal(r3.count, 3);
  assert.equal(r3.willRecover, true);
  assert.equal(r3.recovered, true);
  assert.deepEqual(sock.deletions, ['bob@lid']);
});

test('record() respects cooldown — no double-recovery within 30min window', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();

  // First 3 failures → recovery
  for (let i = 0; i < 3; i += 1) {
    await signalHealth.record(sock, badMacLogObj('carol:1@lid'));
  }
  assert.equal(sock.deletions.length, 1);

  // Another 3 failures immediately → cooldown blocks the second recovery
  for (let i = 0; i < 3; i += 1) {
    await signalHealth.record(sock, badMacLogObj('carol:1@lid'));
  }
  const r = await signalHealth.record(sock, badMacLogObj('carol:1@lid'));
  assert.equal(sock.deletions.length, 1, 'cooldown should suppress second recovery');
  assert.ok(r.onCooldown === true || r.willRecover === false);
});

test('record() does not bleed counts across different JIDs', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();

  // 2 from alice, 2 from bob — neither should trigger
  await signalHealth.record(sock, badMacLogObj('alice:1@lid'));
  await signalHealth.record(sock, badMacLogObj('bob:5@lid'));
  await signalHealth.record(sock, badMacLogObj('alice:1@lid'));
  await signalHealth.record(sock, badMacLogObj('bob:5@lid'));
  assert.equal(sock.deletions.length, 0);

  // One more from each — both trigger independently
  await signalHealth.record(sock, badMacLogObj('alice:1@lid'));
  await signalHealth.record(sock, badMacLogObj('bob:5@lid'));
  assert.equal(sock.deletions.length, 2);
  assert.deepEqual(sock.deletions.sort(), ['alice@lid', 'bob@lid']);
});

test('record() recognises both Bad MAC and No session errors', async () => {
  signalHealth._resetForTests();
  const sock = makeMockSock();

  // 2 bad-mac + 1 no-session = same JID, should still trip threshold
  await signalHealth.record(sock, badMacLogObj('dan:2@lid'));
  await signalHealth.record(sock, badMacLogObj('dan:2@lid'));
  const r = await signalHealth.record(sock, noSessionLogObj('dan:2@lid'));
  assert.equal(r.count, 3);
  assert.equal(r.willRecover, true);
  assert.deepEqual(sock.deletions, ['dan@lid']);
});

test('record() handles missing signalRepository gracefully', async () => {
  signalHealth._resetForTests();
  const sock = {}; // no signalRepository

  for (let i = 0; i < 3; i += 1) {
    await signalHealth.record(sock, badMacLogObj('ed:1@lid'));
  }
  // Last call should report we tried to recover but couldn't
  const r = await signalHealth.record(sock, badMacLogObj('ed:1@lid'));
  // After threshold trigger, counter resets, so this is count=1 again
  assert.equal(r.count, 1);
});

test('snapshot() exposes current tracking state', () => {
  signalHealth._resetForTests();
  const snap = signalHealth.snapshot();
  assert.equal(snap.trackedFailureJids, 0);
  assert.equal(snap.cooldownJids, 0);
  assert.equal(snap.thresholds.failureThreshold, 3);
  assert.equal(snap.thresholds.failureWindowMs, 5 * 60 * 1000);
  assert.equal(snap.thresholds.recoveryCooldownMs, 30 * 60 * 1000);
});
