/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.12.0 — integration tests for new commands + services + cache shim
 * + leveling system.
 *
 *   commands:  reddit, readqr, mute
 *   services:  muteService, levelingService
 *   infra:     lruCacheShim, profilePicCache + parseCache migration
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* ─── lruCacheShim ─────────────────────────────────────────────── */

test('lruCacheShim — NodeCache-compatible API', () => {
  const { LruCacheShim } = require('../../lib/lruCacheShim');
  const c = new LruCacheShim({ max: 10, stdTTL: 60 });

  // set/get
  assert.equal(c.set('k', 'v'), true);
  assert.equal(c.get('k'), 'v');

  // has / del / delete
  assert.equal(c.has('k'), true);
  assert.equal(c.del('k'), true);
  assert.equal(c.has('k'), false);
  c.set('x', 1);
  assert.equal(c.delete('x'), true);

  // flushAll / clear / keys / size / getStats
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.size, 2);
  assert.deepEqual(c.keys().sort(), ['a', 'b']);
  assert.deepEqual(c.getStats(), { keys: 2 });
  c.flushAll();
  assert.equal(c.size, 0);
});

test('lruCacheShim — bounds enforce max entries', () => {
  const { LruCacheShim } = require('../../lib/lruCacheShim');
  const c = new LruCacheShim({ max: 3 });
  c.set('a', 1);
  c.set('b', 2);
  c.set('c', 3);
  c.set('d', 4); // evicts 'a'
  assert.equal(c.size, 3);
  assert.equal(c.has('a'), false);
  assert.equal(c.has('d'), true);
});

test('lruCacheShim — TTL converted from stdTTL seconds → ms', async () => {
  const { LruCacheShim } = require('../../lib/lruCacheShim');
  // stdTTL = 0.05s (50ms). Wait 80ms and confirm expiry.
  const c = new LruCacheShim({ max: 10, stdTTL: 0.05 });
  c.set('k', 'v');
  assert.equal(c.get('k'), 'v');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(c.get('k'), undefined, 'should have expired');
});

test('caches.js — profilePicCache + parseCache use the shim', () => {
  const caches = require('../../core/caches');
  const { LruCacheShim } = require('../../lib/lruCacheShim');
  assert.ok(caches.profilePicCache instanceof LruCacheShim);
  assert.ok(caches.parseCache instanceof LruCacheShim);
});

/* ─── levelingService — pure helpers ───────────────────────────── */

test('levelingService.describe — level 1 at 0 xp', () => {
  const l = require('../../services/levelingService');
  const d = l.describe(0);
  assert.equal(d.level, 1);
  assert.equal(d.xp, 0);
  assert.equal(d.intoLevelXp, 0);
  assert.equal(d.neededForNext, l.BASE_THRESHOLD);
  assert.equal(d.percentToNext, 0);
});

test('levelingService.describe — level 2 boundary', () => {
  const l = require('../../services/levelingService');
  assert.equal(l.describe(99).level, 1);
  assert.equal(l.describe(100).level, 2);
});

test('levelingService.describe — partial progress percent', () => {
  const l = require('../../services/levelingService');
  // At 50 xp into a 100 xp level: 50%
  const d = l.describe(50);
  assert.equal(d.level, 1);
  assert.equal(d.intoLevelXp, 50);
  assert.equal(d.percentToNext, 50);
});

test('levelingService.describe — high levels behave (no infinite loops)', () => {
  const l = require('../../services/levelingService');
  // 1 million xp should give a finite level somewhere in the mid-teens
  const d = l.describe(1_000_000);
  assert.ok(d.level >= 10 && d.level <= 30, `unexpected level: ${d.level}`);
  assert.ok(d.intoLevelXp >= 0);
  assert.ok(d.neededForNext > 0);
});

test('levelingService.xpFloorForLevel — growth factor 1.5 verified', () => {
  const l = require('../../services/levelingService');
  // Level 1 → 0 xp floor (you START at L1)
  assert.equal(l.xpFloorForLevel(1), 0);
  // Level 2 → 100 xp floor (need 100 to enter L2)
  assert.equal(l.xpFloorForLevel(2), 100);
  // Level 3 → 100 + 150 = 250
  assert.equal(l.xpFloorForLevel(3), 250);
  // Level 4 → 250 + round(150*1.5=225) = 475
  assert.equal(l.xpFloorForLevel(4), 475);
});

test('levelingService.xpForCommand — category + AI rules', () => {
  const l = require('../../services/levelingService');
  assert.equal(l.xpForCommand({ name: 'weather', category: 'tools' }), 5);
  assert.equal(l.xpForCommand({ name: 'menu', category: 'main' }), 10);
  assert.equal(l.xpForCommand({ name: 'warn', category: 'group' }), 10);
  assert.equal(l.xpForCommand({ name: 'ai', category: 'general' }), 15);
  assert.equal(l.xpForCommand({ name: 'summarize', category: 'general' }), 15);
  assert.equal(l.xpForCommand({ name: 'imagine', category: 'general' }), 15);
  // Unknown category → default 5
  assert.equal(l.xpForCommand({ name: 'unknown', category: 'mystery' }), 5);
  // No category → default 5
  assert.equal(l.xpForCommand({ name: 'bare' }), 5);
  // No cmd → 0
  assert.equal(l.xpForCommand(null), 0);
});

/* ─── muteService ──────────────────────────────────────────────── */

test('muteService.parseDuration — bare integer = minutes', () => {
  const m = require('../../services/muteService');
  assert.equal(m.parseDuration('30'), 30 * 60_000);
  assert.equal(m.parseDuration('1'), 60_000);
});

test('muteService.parseDuration — unit suffixes', () => {
  const m = require('../../services/muteService');
  assert.equal(m.parseDuration('60s'), 60_000);
  assert.equal(m.parseDuration('30m'), 30 * 60_000);
  assert.equal(m.parseDuration('2h'), 2 * 3_600_000);
  assert.equal(m.parseDuration('1d'), 86_400_000);
});

test('muteService.parseDuration — bounds + invalid', () => {
  const m = require('../../services/muteService');
  assert.equal(m.parseDuration('0'), null);
  assert.equal(m.parseDuration('0m'), null);
  assert.equal(m.parseDuration('30d'), null, '> 7d should reject');
  assert.equal(m.parseDuration('xyz'), null);
  assert.equal(m.parseDuration(''), null);
  assert.equal(m.parseDuration('5y'), null, 'y not supported');
});

test('muteService — mute + isMuted + unmute round trip', () => {
  const m = require('../../services/muteService');
  m._resetForTests();
  const chat = 'c@g.us';
  const user = '99@s.whatsapp.net';
  assert.equal(m.isMuted(chat, user), false);
  m.mute(chat, user, 60_000, { by: 'admin@s.whatsapp.net', reason: 'test' });
  assert.equal(m.isMuted(chat, user), true);
  assert.equal(m.unmute(chat, user), true);
  assert.equal(m.isMuted(chat, user), false);
});

test('muteService — list returns only entries for the queried chat', () => {
  const m = require('../../services/muteService');
  m._resetForTests();
  m.mute('a@g.us', 'u1@s.whatsapp.net', 60_000);
  m.mute('a@g.us', 'u2@s.whatsapp.net', 60_000);
  m.mute('b@g.us', 'u3@s.whatsapp.net', 60_000);
  assert.equal(m.list('a@g.us').length, 2);
  assert.equal(m.list('b@g.us').length, 1);
  assert.equal(m.list('z@g.us').length, 0);
});

test('muteService — expired entries auto-clear on get', async () => {
  const m = require('../../services/muteService');
  m._resetForTests();
  const chat = 'c@g.us';
  const user = 'expiry@s.whatsapp.net';
  // Below MIN_DURATION_MS the service clamps up to 1m — so we test via the
  // raw `mute()` and then mutate _internal_ entry to expire it quickly.
  m.mute(chat, user, 60_000);
  assert.equal(m.isMuted(chat, user), true);
  // Force expiry by direct entry tweak via the internal cache:
  const entry = m.get(chat, user);
  entry.until = Date.now() - 1;
  assert.equal(m.isMuted(chat, user), false);
});

/* ─── command module shape ─────────────────────────────────────── */

test('reddit command — module shape', () => {
  const c = require('../../commands/general/reddit');
  assert.equal(c.name, 'reddit');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('sub'));
});

test('readqr command — module shape', () => {
  const c = require('../../commands/misc/readqr');
  assert.equal(c.name, 'readqr');
  assert.equal(c.category, 'misc');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('qrread'));
});

test('mute command — module shape + group gate', () => {
  const c = require('../../commands/group/mute');
  assert.equal(c.name, 'mute');
  assert.equal(c.category, 'group');
  assert.equal(c.group, true);
  assert.equal(c.needsMetadata, true);
  assert.equal(typeof c.start, 'function');
});

test('profile command — still loads + exposes start (leveling-aware)', () => {
  const c = require('../../commands/user/profile');
  assert.equal(c.name, 'profile');
  assert.equal(typeof c.start, 'function');
});
