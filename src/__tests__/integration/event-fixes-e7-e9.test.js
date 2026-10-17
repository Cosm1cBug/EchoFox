/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Event + store fixes batch 2 (v1.20.2): E7 (auto-decline calls),
 * E8 (newsletter.view counter value), E9 (bind the five unobserved
 * events), M1 (filtered admin-audit counts).
 *
 * Payload shapes verified against Baileys 7.0.0-rc14
 * (Types/Events.ts, Types/GroupMetadata.d.ts, Socket/messages-recv.js).
 *
 * Run:  node --test src/__tests__/integration/event-fixes-e7-e9.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const instance = require('../../store/instance');
const { makeSQLiteStore } = require('../../store/sqliteStore');

const onCall = require('../../events/call');
const newsletterView = require('../../events/newsletter.view');
const onJoinRequest = require('../../events/group.join-request');
const onChatsLock = require('../../events/chats.lock');
const onSettingsUpdate = require('../../events/settings.update');
const onMediaUpdate = require('../../events/messages.media-update');
const onMemberTag = require('../../events/group.member-tag.update');

function stubStore(extra = {}) {
  const calls = [];
  const rec =
    (name) =>
    (...args) =>
      void calls.push([name, ...args]);
  instance.__resetForTests();
  instance.setStore({
    setNewsletterViewCount: rec('setNewsletterViewCount'),
    incrementNewsletterView: rec('incrementNewsletterView'),
    recordParticipantEvent: rec('recordParticipantEvent'),
    ...extra,
  });
  return calls;
}

test.beforeEach(() => instance.__resetForTests());
test.after(() => instance.__resetForTests());

// ── E7: calls are auto-declined via the working reject path ─────────────

test('E7: an offer is declined via callManager.rejectCall — never accepted', async () => {
  const calls = [];
  const sock = { sendMessage: async (...a) => void calls.push(['sendMessage', ...a]) };
  const callManager = {
    rejectCall: async (...a) => void calls.push(['rejectCall', ...a]),
    handleOffer: async (...a) => void calls.push(['handleOffer', ...a]),
  };
  await onCall({
    sock,
    callManager,
    u: [{ id: 'CALL1', from: '62812@s.whatsapp.net', status: 'offer', isVideo: false }],
  });
  assert.deepEqual(calls, [['rejectCall', 'CALL1', '62812@s.whatsapp.net']]);
});

test('E7: antiCall=true adds the courtesy reply; non-offer events are ignored', () => {
  // config is frozen by design — the supported knob is the env override
  // ECHOFOX_FEATURES_ANTI_CALL (segments after _ are camelCased: ANTI_CALL →
  // antiCall), so this branch runs in a child process.
  const script = `
    const assert = require('node:assert/strict');
    const { config } = require('${path.join(__dirname, '..', '..', 'lib', 'configLoader')}');
    assert.equal(config.options.antiCall, true, 'env override must reach config.options.antiCall');
    const onCall = require('${path.join(__dirname, '..', '..', 'events', 'call')}');
    (async () => {
      const calls = [];
      const sock = { sendMessage: async (...a) => void calls.push(['sendMessage', ...a]) };
      const callManager = {
        rejectCall: async (...a) => void calls.push(['rejectCall', ...a]),
        handleOffer: async (...a) => void calls.push(['handleOffer', ...a]),
      };
      await onCall({
        sock,
        callManager,
        u: [
          { id: 'CALL1', from: '62812@s.whatsapp.net', status: 'offer' },
          { id: 'CALL2', from: '62813@s.whatsapp.net', status: 'timeout' },
        ],
      });
      assert.deepEqual(calls.map((c) => c[0]), ['rejectCall', 'sendMessage']);
      assert.ok(calls[1][2].text.includes('Calls are not accepted'), 'courtesy text');
      console.log('CHILD-OK');
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, ECHOFOX_FEATURES_ANTI_CALL: 'true' },
    encoding: 'utf8',
  });
  assert.match(out, /CHILD-OK/);
});

// ── E8: newsletter.view uses the counter value ──────────────────────────

test('E8: count is applied as the absolute counter value', async () => {
  const calls = stubStore();
  await newsletterView({
    u: { id: '12345@newsletter', server_id: '1', count: 42 },
  });
  assert.deepEqual(calls, [['setNewsletterViewCount', '12345@newsletter', '1', 42]]);
});

test('E8: missing/unparsable count falls back to +1; no ev.id fallback as message id', async () => {
  const calls = stubStore();
  await newsletterView({ u: { id: '12345@newsletter', server_id: '1' } });
  await newsletterView({ u: { id: '12345@newsletter', server_id: '2', count: 'x' } });
  // no server_id at all → skipped entirely (would have written garbage before)
  await newsletterView({ u: { id: '12345@newsletter', count: 5 } });
  assert.deepEqual(calls, [
    ['incrementNewsletterView', '12345@newsletter', '1'],
    ['incrementNewsletterView', '12345@newsletter', '2'],
  ]);
});

test('E8: sqlite setNewsletterViewCount is monotonic (dup/out-of-order safe)', async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `echofox-views-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  const stub = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: function () {
      return this;
    },
  };
  const store = makeSQLiteStore({
    dbPath,
    logger: stub,
    groupCache: { get: () => null, set: () => null },
  });
  try {
    await store.setNewsletterViewCount('123@newsletter', 'm1', 42);
    await store.setNewsletterViewCount('123@newsletter', 'm1', 10); // out-of-order
    let rows = await store.getNewsletterViews('123@newsletter', 'm1');
    assert.equal(rows[0].view_count, 42, 'older value must not regress the tally');
    await store.setNewsletterViewCount('123@newsletter', 'm1', 50);
    rows = await store.getNewsletterViews('123@newsletter', 'm1');
    assert.equal(rows[0].view_count, 50);
  } finally {
    store.close();
    ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(dbPath + ext, { force: true }));
  }
});

// ── E9: the five previously-unobserved events ───────────────────────────

test('E9: group.join-request maps lifecycle verbs onto the participant-event vocabulary', async () => {
  const calls = stubStore();
  await onJoinRequest({
    u: [
      {
        id: '120363@g.us',
        author: '62811@s.whatsapp.net',
        participant: '62899@s.whatsapp.net',
        action: 'created',
        method: 'invite_link',
      },
      {
        id: '120363@g.us',
        author: '62811@s.whatsapp.net',
        participant: '62898@s.whatsapp.net',
        action: 'rejected',
      },
      {
        id: '120363@g.us',
        author: '62897@s.whatsapp.net',
        participant: '62897@s.whatsapp.net',
        action: 'revoked',
      },
    ],
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 4), [
    'recordParticipantEvent',
    '120363@g.us',
    '62899@s.whatsapp.net',
    'request',
  ]);
  assert.deepEqual(calls[1].slice(0, 4), [
    'recordParticipantEvent',
    '120363@g.us',
    '62898@s.whatsapp.net',
    'reject',
  ]);
  assert.deepEqual(calls[2].slice(0, 4), [
    'recordParticipantEvent',
    '120363@g.us',
    '62897@s.whatsapp.net',
    'revoked',
  ]);
  // actor + timestamp supplied
  assert.equal(calls[0][4], '62811@s.whatsapp.net');
  assert.ok(Number.isFinite(calls[0][5]));
});

test('E9: join-request without participant/action is dropped, not invented', async () => {
  const calls = stubStore();
  await onJoinRequest({
    u: [
      { id: '120363@g.us', author: 'a@s.whatsapp.net', action: 'created' }, // no participant
      { id: '120363@g.us', participant: 'b@s.whatsapp.net' }, // no action
    ],
  });
  assert.deepEqual(calls, []);
});

test('E9: chats.lock / settings.update / media-update / member-tag run without store calls', async () => {
  const calls = stubStore();
  await onChatsLock({ u: { id: 'x@s.whatsapp.net', locked: true } });
  await onSettingsUpdate({
    u: { setting: 'unarchiveChats', value: true },
  });
  await onMediaUpdate({
    u: [
      {
        key: { remoteJid: 'x@s.whatsapp.net', id: 'M1' },
        media: { ciphertext: new Uint8Array(1), iv: new Uint8Array(1) },
      },
      { key: { remoteJid: 'x@s.whatsapp.net', id: 'M2' }, error: new Error('boom') },
    ],
  });
  await onMemberTag({
    u: {
      groupId: '120363@g.us',
      participant: '62812@s.whatsapp.net',
      label: 'L1',
      messageTimestamp: 1728000000,
    },
  });
  // log-only by design — nothing must touch the store
  assert.deepEqual(calls, []);
});

// ── M1: filtered admin-audit counts ─────────────────────────────────────

test('M1: countAdminAudit honours actor/cmd/window filters (sqlite)', async () => {
  const dbPath = path.join(
    os.tmpdir(),
    `echofox-audit-count-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.db`,
  );
  const stub = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: function () {
      return this;
    },
  };
  const store = makeSQLiteStore({
    dbPath,
    logger: stub,
    groupCache: { get: () => null, set: () => null },
  });
  try {
    const now = Math.floor(Date.now() / 1000);
    await store.recordAdminAudit({
      ts: now,
      actor_jid: 'a@s.whatsapp.net',
      cmd_name: 'ping',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      ts: now,
      actor_jid: 'a@s.whatsapp.net',
      cmd_name: 'help',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      ts: now - 30 * 86400,
      actor_jid: 'b@s.whatsapp.net',
      cmd_name: 'ping',
      kind: 'admin',
      outcome: 'failure',
    });

    assert.equal(await store.countAdminAudit(), 3, 'global count');
    assert.equal(
      await store.countAdminAudit({ sinceSec: now - 86400 }),
      2,
      'window filters out old rows',
    );
    assert.equal(
      await store.countAdminAudit({ sinceSec: now - 86400, actor: 'a@s.whatsapp.net' }),
      2,
      'actor filter',
    );
    assert.equal(
      await store.countAdminAudit({ sinceSec: 0, actor: 'b@s.whatsapp.net' }),
      1,
      'actor filter (no window)',
    );
    assert.equal(await store.countAdminAudit({ sinceSec: 0, cmd: 'ping' }), 2, 'cmd filter');
    assert.equal(
      await store.countAdminAudit({ sinceSec: now - 86400, cmd: 'ping' }),
      1,
      'cmd filter + window',
    );
    // precedence: actor wins over cmd, matching the list queries
    assert.equal(
      await store.countAdminAudit({ sinceSec: 0, actor: 'a@s.whatsapp.net', cmd: 'ping' }),
      2,
    );
  } finally {
    store.close();
    ['', '-shm', '-wal'].forEach((ext) => fs.rmSync(dbPath + ext, { force: true }));
  }
});
