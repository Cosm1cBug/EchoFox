/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.17.0 — observability batch tests.
 *
 *   service:   adminAuditService (shouldAudit, record, pruneOnce, getStatus)
 *   store:     recordAdminAudit, listAdminAudit{,ByActor,ByCmd},
 *              pruneAdminAuditOlderThan, countAdminAudit
 *   service:   connectionState (set / get / isConnected)
 *   service:   metrics — new typed wrappers
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pino = require('pino');

function freshStore() {
  const tmp = path.join(
    os.tmpdir(),
    `echofox_v1170_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
  );
  try {
    fs.rmSync(tmp, { force: true });
  } catch (_) {}
  const { LRUCache } = require('lru-cache');
  const { makeSQLiteStore } = require('../../store/sqliteStore');
  return {
    store: makeSQLiteStore({
      dbPath: tmp,
      logger: pino({ level: 'silent' }),
      groupCache: new LRUCache({ max: 100 }),
    }),
    path: tmp,
  };
}

function resetSingleton(store) {
  const instance = require('../../store/instance');
  instance.__resetForTests();
  instance.setStore(store);
}

/* ─── connectionState ─────────────────────────────────────────── */

test('connectionState — initial state is pending; isConnected false', () => {
  const cs = require('../../services/connectionState');
  cs._resetForTests();
  assert.equal(cs.get().connection, 'pending');
  assert.equal(cs.isConnected(), false);
});

test('connectionState — set open → isConnected true; tracks lastOpenAt', () => {
  const cs = require('../../services/connectionState');
  cs._resetForTests();
  cs.set({ connection: 'open', reconnectAttempts: 0 });
  assert.equal(cs.isConnected(), true);
  const s = cs.get();
  assert.equal(s.connection, 'open');
  assert.ok(s.lastOpenAt > 0);
  assert.equal(s.reconnectAttempts, 0);
});

test('connectionState — set close → tracks code/reason; isConnected false', () => {
  const cs = require('../../services/connectionState');
  cs._resetForTests();
  cs.set({ connection: 'open' });
  cs.set({ connection: 'close', code: 401, reason: 'unauthorized' });
  assert.equal(cs.isConnected(), false);
  const s = cs.get();
  assert.equal(s.lastCloseCode, 401);
  assert.equal(s.lastCloseReason, 'unauthorized');
});

/* ─── adminAuditService.shouldAudit ───────────────────────────── */

test('adminAuditService.shouldAudit — $-prefix admin call → true', () => {
  const a = require('../../services/adminAuditService');
  assert.equal(a.shouldAudit({ name: 'x' }, true, false), true);
});

test('adminAuditService.shouldAudit — cmd.admin true → true', () => {
  const a = require('../../services/adminAuditService');
  assert.equal(a.shouldAudit({ name: 'x', admin: true }, false, false), true);
});

test('adminAuditService.shouldAudit — groupAdminOnly + isGroupAdmin true → true', () => {
  const a = require('../../services/adminAuditService');
  assert.equal(a.shouldAudit({ name: 'x', groupAdminOnly: true }, false, true), true);
});

test('adminAuditService.shouldAudit — plain user command → false', () => {
  const a = require('../../services/adminAuditService');
  assert.equal(a.shouldAudit({ name: 'x' }, false, false), false);
});

test('adminAuditService.shouldAudit — groupAdminOnly cmd, NOT group admin → false', () => {
  const a = require('../../services/adminAuditService');
  assert.equal(a.shouldAudit({ name: 'x', groupAdminOnly: true }, false, false), false);
});

/* ─── store recordAdminAudit + listAdminAudit ─────────────────── */

test('store.recordAdminAudit → store.listAdminAudit round-trip', async () => {
  const { store, path: p } = freshStore();
  try {
    const id = await store.recordAdminAudit({
      actor_jid: 'admin@s.whatsapp.net',
      chat_jid: 'chat@g.us',
      cmd_name: 'leveling',
      prefix: '$',
      args: 'decay on',
      kind: 'admin',
      outcome: 'success',
      latency_ms: 42,
    });
    assert.ok(id, 'recordAdminAudit should return id');
    const events = await store.listAdminAudit();
    assert.equal(events.length, 1);
    assert.equal(events[0].cmd_name, 'leveling');
    assert.equal(events[0].args, 'decay on');
    assert.equal(events[0].outcome, 'success');
    assert.equal(events[0].latency_ms, 42);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.listAdminAuditByActor + ByCmd filter correctly', async () => {
  const { store, path: p } = freshStore();
  try {
    await store.recordAdminAudit({
      actor_jid: 'a@s.whatsapp.net',
      cmd_name: 'leveling',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      actor_jid: 'b@s.whatsapp.net',
      cmd_name: 'leveling',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      actor_jid: 'a@s.whatsapp.net',
      cmd_name: 'mute',
      kind: 'group_admin',
      outcome: 'success',
    });
    const byA = await store.listAdminAuditByActor('a@s.whatsapp.net');
    assert.equal(byA.length, 2);
    const byCmdLeveling = await store.listAdminAuditByCmd('leveling');
    assert.equal(byCmdLeveling.length, 2);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.pruneAdminAuditOlderThan deletes only rows past cutoff', async () => {
  const { store, path: p } = freshStore();
  try {
    const now = Math.floor(Date.now() / 1000);
    await store.recordAdminAudit({
      ts: now - 1000,
      actor_jid: 'a',
      cmd_name: 'old',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      ts: now,
      actor_jid: 'a',
      cmd_name: 'new',
      kind: 'admin',
      outcome: 'success',
    });
    const cutoff = now - 500;
    const pruned = await store.pruneAdminAuditOlderThan(cutoff);
    assert.equal(pruned, 1, 'one row should be pruned');
    const remaining = await store.listAdminAudit();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].cmd_name, 'new');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.countAdminAudit returns row count', async () => {
  const { store, path: p } = freshStore();
  try {
    assert.equal(await store.countAdminAudit(), 0);
    await store.recordAdminAudit({
      actor_jid: 'a',
      cmd_name: 'x',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      actor_jid: 'b',
      cmd_name: 'y',
      kind: 'admin',
      outcome: 'failure',
    });
    assert.equal(await store.countAdminAudit(), 2);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── adminAuditService.pruneOnce ─────────────────────────────── */

test('adminAuditService.pruneOnce — uses config.audit.retentionDays', async () => {
  const { store, path: p } = freshStore();
  try {
    const { __testOverride, __resetForTests } = require('../../lib/configLoader');
    __resetForTests();
    __testOverride({ audit: { retentionDays: 1 } });
    resetSingleton(store);
    const audit = require('../../services/adminAuditService');
    audit._resetForTests();

    const now = Math.floor(Date.now() / 1000);
    await store.recordAdminAudit({
      ts: now - 2 * 86400,
      actor_jid: 'a',
      cmd_name: 'old',
      kind: 'admin',
      outcome: 'success',
    });
    await store.recordAdminAudit({
      ts: now,
      actor_jid: 'a',
      cmd_name: 'new',
      kind: 'admin',
      outcome: 'success',
    });

    const r = await audit.pruneOnce();
    assert.equal(r.ran, true);
    assert.equal(r.deleted, 1);
    assert.equal(r.retentionDays, 1);
    __resetForTests();
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('adminAuditService.record — async fire-and-forget write', async () => {
  const { store, path: p } = freshStore();
  try {
    resetSingleton(store);
    const audit = require('../../services/adminAuditService');
    audit.record({
      actor_jid: 'a@s.whatsapp.net',
      cmd_name: 'leveling',
      kind: 'admin',
      outcome: 'success',
    });
    // Wait for the async fire-and-forget to complete
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
    const events = await store.listAdminAudit();
    assert.equal(events.length, 1);
    assert.equal(events[0].actor_jid, 'a@s.whatsapp.net');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── metrics — new typed wrappers exist ──────────────────────── */

test('metrics — new v1.17.0 wrappers are exported + callable', () => {
  const m = require('../../services/metrics');
  // Should not throw even before init() — they all check _ensureStore.
  m.incXpAwarded(5);
  m.incLevelUp();
  m.incDecaySweep('success');
  m.incDecaySweep('failure');
  m.incDecayUsersDecayed(3);
  m.incNotifyDmSent();
  m.incNotifyDmFailed();
  m.setLevelXpMultiplier(1.5);
  m.setLevelDecayEnabled(true);
  m.setLevelDecayLastRun(1700000000, 5);
  m.incMuteSet();
  m.incMuteUnmuted();
  m.incMuteFiltered();
  m.setActiveMutes(7);
  m.incOcrCall('success');
  m.incOcrCall('failure');
  m.incOcrChars(120);
  m.incAdminAudit();
  m.incAdminAuditPrune(3);
  m.setAdminAuditRows(42);
  // No assertion — just verifying the public surface doesn't crash.
  assert.ok(true);
});

test('metrics — counters/gauges schema includes v1.17.0 keys', () => {
  const { COUNTERS, GAUGES } = require('../../store/schema/stats');
  for (const k of [
    'level_xp_awarded_total',
    'level_levelups_total',
    'level_decay_sweeps_total',
    'level_decay_sweep_failures_total',
    'level_decay_users_decayed_total',
    'level_notify_dm_sent_total',
    'level_notify_dm_failed_total',
    'mutes_set_total',
    'mutes_unmuted_total',
    'mutes_filtered_total',
    'ocr_calls_total',
    'ocr_calls_failed_total',
    'ocr_chars_recognised_total',
    'admin_audit_events_total',
    'admin_audit_prune_total',
  ]) {
    assert.ok(COUNTERS.includes(k), `missing counter: ${k}`);
  }
  for (const k of [
    'level_active_mutes',
    'level_xp_multiplier',
    'level_decay_enabled',
    'level_decay_last_run_at',
    'level_decay_last_run_affected',
    'admin_audit_rows',
  ]) {
    assert.ok(GAUGES.includes(k), `missing gauge: ${k}`);
  }
});
