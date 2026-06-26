/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.16.0 — leveling + dashboard batch tests.
 *
 *   commands:    notify (user), leveling (admin)
 *   services:    levelingService (xpMultiplier + level-up DM),
 *                levelingDecayService (decay sweep)
 *   store:       getTopUsersByXp, getActiveUsersSince, applyXpDecay,
 *                getMostChangedGroupsSince, getGroupSettingsHistoryByField
 *   config:      config.leveling.{xpMultiplier, decay, notifications}
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
    `echofox_v1160_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
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

/* ─── command module shapes ────────────────────────────────────── */

test('.notify command — module shape', () => {
  const c = require('../../commands/user/notify');
  assert.equal(c.name, 'notify');
  assert.equal(c.category, 'user');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('notifications'));
});

test('$leveling admin command — module shape', () => {
  const c = require('../../commands/admin/leveling');
  assert.equal(c.name, 'leveling');
  assert.equal(c.category, 'admin');
  assert.equal(c.admin, true);
  assert.equal(typeof c.start, 'function');
});

/* ─── levelingService.xpForCommand — multiplier ────────────────── */

test('xpForCommand: multiplier 1.0 (default) preserves v1.12 behaviour', () => {
  const { __resetForTests } = require('../../lib/configLoader');
  __resetForTests();
  const { xpForCommand } = require('../../services/levelingService');
  assert.equal(xpForCommand({ name: 'help', category: 'general' }), 5);
  assert.equal(xpForCommand({ name: 'mute', category: 'admin' }), 10);
  assert.equal(xpForCommand({ name: 'ai' }), 15);
});

test('xpForCommand: multiplier 2.0 doubles all', () => {
  const { __testOverride, __resetForTests } = require('../../lib/configLoader');
  __resetForTests();
  __testOverride({ leveling: { xpMultiplier: 2.0 } });
  // Reload module — cached config is via require so we already pulled it
  // Actually levelingService reads config at call-time, so just re-require not needed
  // (but require.cache for the service module retains the reference)
  delete require.cache[require.resolve('../../services/levelingService')];
  const { xpForCommand } = require('../../services/levelingService');
  assert.equal(xpForCommand({ name: 'help', category: 'general' }), 10);
  assert.equal(xpForCommand({ name: 'mute', category: 'admin' }), 20);
  assert.equal(xpForCommand({ name: 'ai' }), 30);
  __resetForTests();
});

test('xpForCommand: multiplier 0.5 halves all (floor)', () => {
  const { __testOverride, __resetForTests } = require('../../lib/configLoader');
  __resetForTests();
  __testOverride({ leveling: { xpMultiplier: 0.5 } });
  delete require.cache[require.resolve('../../services/levelingService')];
  const { xpForCommand } = require('../../services/levelingService');
  assert.equal(xpForCommand({ name: 'help', category: 'general' }), 2);
  assert.equal(xpForCommand({ name: 'mute', category: 'admin' }), 5);
  assert.equal(xpForCommand({ name: 'ai' }), 7);
  __resetForTests();
});

/* ─── store: top-by-xp + active-since ──────────────────────────── */

test('store.getTopUsersByXp + getActiveUsersSince', async () => {
  const { store, path: p } = freshStore();
  try {
    await store.addUserXp('a@s.whatsapp.net', 50);
    await store.addUserXp('b@s.whatsapp.net', 200);
    await store.addUserXp('c@s.whatsapp.net', 120);
    await store.addUserXp('zero@s.whatsapp.net', 0);

    const top = await store.getTopUsersByXp(5);
    assert.equal(top.length, 3, 'zero-xp users excluded');
    assert.equal(top[0].jid, 'b@s.whatsapp.net');
    assert.equal(top[0].xp, 200);
    assert.equal(top[1].xp, 120);
    assert.equal(top[2].xp, 50);

    // Active since: only those updated >= sinceSec. All three updated at "now".
    const since = Math.floor(Date.now() / 1000) - 60;
    const active = await store.getActiveUsersSince(since, 10);
    assert.equal(active.length, 3);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── store: applyXpDecay ──────────────────────────────────────── */

test('store.applyXpDecay — decays inactive users only', async () => {
  const { store, path: p } = freshStore();
  try {
    // Insert two users at full XP, then back-date their last_at via raw SQL
    await store.addUserXp('inactive@s.whatsapp.net', 1000);
    await store.addUserXp('recent@s.whatsapp.net', 1000);
    // Back-date "inactive" user to 28 days ago
    const now = Math.floor(Date.now() / 1000);
    const oldTs = now - 28 * 86400;
    store.db
      .prepare('UPDATE user_levels SET last_at = ? WHERE jid = ?')
      .run(oldTs, 'inactive@s.whatsapp.net');

    // Decay: 14d grace, 5%/week. inactive is 14d past grace → 2 weeks of decay → 1000 * 0.95^2 ≈ 902
    const affected = await store.applyXpDecay(14 * 86400, 0.05);
    assert.equal(affected, 1, 'only inactive user should decay');

    const inactive = await store.getUserLevel('inactive@s.whatsapp.net');
    const recent = await store.getUserLevel('recent@s.whatsapp.net');
    assert.ok(inactive.xp < 1000, 'inactive xp should drop');
    assert.ok(inactive.xp >= 800, `decay should be modest: got ${inactive.xp}, expected ~902`);
    assert.equal(recent.xp, 1000, 'recent user untouched');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store.applyXpDecay — does NOT modify last_at (still considered inactive)', async () => {
  const { store, path: p } = freshStore();
  try {
    await store.addUserXp('user@s.whatsapp.net', 500);
    const now = Math.floor(Date.now() / 1000);
    const oldTs = now - 28 * 86400;
    store.db
      .prepare('UPDATE user_levels SET last_at = ? WHERE jid = ?')
      .run(oldTs, 'user@s.whatsapp.net');
    const before = await store.getUserLevel('user@s.whatsapp.net');
    await store.applyXpDecay(14 * 86400, 0.05);
    const after = await store.getUserLevel('user@s.whatsapp.net');
    assert.equal(after.last_at, before.last_at, 'last_at must not be reset by decay');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── store: most-changed-groups + field filter ────────────────── */

test('store.getMostChangedGroupsSince + getGroupSettingsHistoryByField', async () => {
  const { store, path: p } = freshStore();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Direct inserts since recordGroupSettingsEvent is a single-event API
    const insert = store.db.prepare(
      `INSERT INTO group_settings_events (jid, field, old_value, new_value, actor, ts) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run('a@g.us', 'subject', 'old', 'new', null, now - 86400);
    insert.run('a@g.us', 'subject', 'new', 'newer', null, now - 7200);
    insert.run('a@g.us', 'desc', 'x', 'y', null, now - 3600);
    insert.run('b@g.us', 'restrict', null, 'true', null, now - 1800);

    const top = await store.getMostChangedGroupsSince(now - 7 * 86400, 5);
    assert.equal(top.length, 2);
    assert.equal(top[0].jid, 'a@g.us');
    assert.equal(top[0].count, 3);
    assert.equal(top[1].jid, 'b@g.us');
    assert.equal(top[1].count, 1);

    const subjectOnly = await store.getGroupSettingsHistoryByField('a@g.us', 'subject', 50);
    assert.equal(subjectOnly.length, 2);
    assert.ok(subjectOnly.every((e) => e.field === 'subject'));
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── levelingDecayService ─────────────────────────────────────── */

test('levelingDecayService.runOnce — disabled by default → returns disabled', async () => {
  const { store, path: p } = freshStore();
  try {
    const { __testOverride, __resetForTests } = require('../../lib/configLoader');
    __resetForTests();
    resetSingleton(store);
    const decay = require('../../services/levelingDecayService');
    decay._resetForTests();
    const r = await decay.runOnce();
    assert.equal(r.ran, false);
    assert.equal(r.reason, 'disabled');
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

test('levelingDecayService.runOnce — enabled → returns affected count', async () => {
  const { store, path: p } = freshStore();
  try {
    const { __testOverride, __resetForTests } = require('../../lib/configLoader');
    __resetForTests();
    resetSingleton(store);

    // Seed an inactive user
    await store.addUserXp('inactive@s.whatsapp.net', 1000);
    const oldTs = Math.floor(Date.now() / 1000) - 28 * 86400;
    store.db
      .prepare('UPDATE user_levels SET last_at = ? WHERE jid = ?')
      .run(oldTs, 'inactive@s.whatsapp.net');

    __testOverride({
      leveling: { decay: { enabled: true, afterDays: 14, percentPerWeek: 0.05 } },
    });
    const decay = require('../../services/levelingDecayService');
    decay._resetForTests();
    const r = await decay.runOnce();
    assert.equal(r.ran, true);
    assert.equal(r.affected, 1);
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

/* ─── awardForCommand level-up DM ──────────────────────────────── */

test('awardForCommand — level transition computed correctly', async () => {
  const { store, path: p } = freshStore();
  try {
    const { __resetForTests } = require('../../lib/configLoader');
    __resetForTests();
    resetSingleton(store);
    delete require.cache[require.resolve('../../services/levelingService')];
    const leveling = require('../../services/levelingService');

    // First few commands — under threshold 100 → still level 1
    let r = await leveling.awardForCommand('u@s.whatsapp.net', {
      name: 'help',
      category: 'general',
    });
    assert.equal(r.awarded, 5);
    assert.equal(r.total, 5);
    assert.equal(r.leveledUp, false);

    // Force a level up by setting XP near threshold
    store.db.prepare('UPDATE user_levels SET xp = ? WHERE jid = ?').run(95, 'u@s.whatsapp.net');
    r = await leveling.awardForCommand('u@s.whatsapp.net', { name: 'help', category: 'general' });
    assert.equal(r.awarded, 5);
    assert.equal(r.total, 100);
    assert.equal(r.leveledUp, true);
    assert.equal(r.oldLevel, 1);
    assert.equal(r.newLevel, 2);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('isNotifyEnabled — explicit opt-in beats default; explicit opt-out beats default', async () => {
  const { store, path: p } = freshStore();
  try {
    const { __resetForTests } = require('../../lib/configLoader');
    __resetForTests();
    resetSingleton(store);
    delete require.cache[require.resolve('../../services/levelingService')];
    const { isNotifyEnabled, NOTIFY_SERVICE } = require('../../services/levelingService');

    // No row → false (default off)
    assert.equal(await isNotifyEnabled('a@s.whatsapp.net'), false);

    // Add row with optedIn: true
    await store.addSubscriber(NOTIFY_SERVICE, 'b@s.whatsapp.net', { optedIn: true });
    assert.equal(await isNotifyEnabled('b@s.whatsapp.net'), true);

    // Add row with optedIn: false
    await store.addSubscriber(NOTIFY_SERVICE, 'c@s.whatsapp.net', { optedIn: false });
    assert.equal(await isNotifyEnabled('c@s.whatsapp.net'), false);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});
