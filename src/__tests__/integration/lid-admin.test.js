/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Regression tests for LID-safe admin authorisation.
 *
 * Baileys 7.x defaults to LID addressing and this bot demonstrably receives
 * `@lid` senders (see its own logs: `cmd: "menu" sender: "32844286005291@lid"`).
 * `config.admins` is normally written in PN form, and the old check was a raw
 * `array.includes(senderJid)` — so the owner was silently locked out of every
 * admin command. These tests pin the resolved behaviour.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isConfiguredAdmin,
  resolvePnForLid,
  resolveLidForPn,
  _clearCache,
} = require('../../lib/jidResolve');

const PN = '919876543210@s.whatsapp.net';
const LID = '32844286005291@lid';
const ADMINS_PN = [PN];
const ADMINS_LID = [LID];

/** socket exposing Baileys 7.x lidMapping. */
function sockWithMapping() {
  return {
    signalRepository: {
      lidMapping: {
        getPNForLID: async (l) => (l === LID ? PN : null),
        getLIDForPN: async (p) => (p === PN ? LID : null),
      },
    },
  };
}

test('LID sender is authorised when config.admins is written in PN form', async () => {
  _clearCache();
  const ok = await isConfiguredAdmin(sockWithMapping(), {}, LID, ADMINS_PN);
  assert.equal(ok, true, 'PN-form admin entry must authorise a LID sender');
});

test('PN sender is authorised when config.admins is written in LID form', async () => {
  _clearCache();
  const ok = await isConfiguredAdmin(sockWithMapping(), {}, PN, ADMINS_LID);
  assert.equal(ok, true, 'LID-form admin entry must authorise a PN sender');
});

test('exact match still works without any mapping data', async () => {
  _clearCache();
  assert.equal(await isConfiguredAdmin({}, {}, PN, ADMINS_PN), true);
  assert.equal(await isConfiguredAdmin({}, {}, LID, ADMINS_LID), true);
});

test('non-admin is rejected', async () => {
  _clearCache();
  assert.equal(await isConfiguredAdmin(sockWithMapping(), {}, '99999999@lid', ADMINS_PN), false);
  assert.equal(await isConfiguredAdmin({}, {}, '15550001111@s.whatsapp.net', ADMINS_PN), false);
});

test('no mapping available falls back to exact match (never throws)', async () => {
  _clearCache();
  // unresolvable LID + PN-form admin list -> false, but no exception
  assert.equal(await isConfiguredAdmin({}, {}, LID, ADMINS_PN), false);
  assert.equal(await isConfiguredAdmin(null, null, LID, ADMINS_PN), false);
});

test('empty admins list authorises nobody', async () => {
  _clearCache();
  assert.equal(await isConfiguredAdmin(sockWithMapping(), {}, PN, []), false);
  assert.equal(await isConfiguredAdmin(sockWithMapping(), {}, PN, undefined), false);
});

test('persisted store mapping is used when the socket has no lidMapping (6.x path)', async () => {
  _clearCache();
  const store = { getLidMapping: async (l) => (l === LID ? PN : null) };
  assert.equal(await isConfiguredAdmin({}, store, LID, ADMINS_PN), true);
});

test('resolution guards against a null/undefined jid', async () => {
  _clearCache();
  assert.equal(await resolvePnForLid(sockWithMapping(), {}, null), null);
  assert.equal(await resolvePnForLid(sockWithMapping(), {}, PN), null, 'PN input is not a LID');
  assert.equal(await resolveLidForPn(sockWithMapping(), {}, LID), null, 'LID input is not a PN');
});

test('results are cached (second call does not re-resolve)', async () => {
  _clearCache();
  let calls = 0;
  const sock = {
    signalRepository: {
      lidMapping: {
        getPNForLID: async () => {
          calls += 1;
          return PN;
        },
      },
    },
  };
  await resolvePnForLid(sock, {}, LID);
  await resolvePnForLid(sock, {}, LID);
  assert.equal(calls, 1, 'LID->PN lookup should be memoised');
});
