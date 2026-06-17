/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.7.0 — integration tests for the 5 new commands:
 *   tools/shorten.js, general/summarize.js, admin/purge.js,
 *   group/welcome.js, general/imagine.js
 *
 * Tests cover:
 *   • module-shape (name, category, start) so the contract suite picks them up
 *   • sentMessageTracker public surface
 *   • greetingService template rendering + validation
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* ─── sentMessageTracker ───────────────────────────────────────────── */

test('sentMessageTracker — recent() returns recent-first slice', () => {
  const t = require('../../services/sentMessageTracker');
  t._resetForTests();
  // Simulate a wrapped sock manually using the internal push by wrapping a fake sock.
  const fakeSock = {
    sendMessage: async (jid, _content) => ({
      key: { id: 'm' + Date.now() + Math.random(), remoteJid: jid },
    }),
  };
  t.wrap(fakeSock);
  return Promise.resolve()
    .then(() => fakeSock.sendMessage('chat@g.us', { text: 'a' }))
    .then(() => fakeSock.sendMessage('chat@g.us', { text: 'b' }))
    .then(() => fakeSock.sendMessage('chat@g.us', { text: 'c' }))
    .then(() => {
      const r = t.recent('chat@g.us', 10);
      assert.equal(r.length, 3);
      assert.ok(r[0].key.id);
      assert.equal(r[0].chat, 'chat@g.us');
    });
});

test('sentMessageTracker — recentSince filters by age', async () => {
  const t = require('../../services/sentMessageTracker');
  t._resetForTests();
  const fakeSock = {
    sendMessage: async (jid, _content) => ({ key: { id: 'k' + Math.random(), remoteJid: jid } }),
  };
  t.wrap(fakeSock);
  await fakeSock.sendMessage('c@g.us', { text: 'x' });
  const all = t.recentSince('c@g.us', 10_000);
  assert.equal(all.length, 1);
  // Add a small wait so 'since -1ms ago' excludes our entry.
  // (Using exactly 0ms produces a cutoff equal to the entry's ts which
  // would pass the >= filter; this is intentional behaviour.)
  await new Promise((r) => setTimeout(r, 2));
  const none = t.recentSince('c@g.us', 1);
  assert.equal(none.length, 0);
});

test('sentMessageTracker — wrap is idempotent', () => {
  const t = require('../../services/sentMessageTracker');
  const fakeSock = { sendMessage: async () => ({ key: { id: 'x', remoteJid: 'c@g.us' } }) };
  const before = fakeSock.sendMessage;
  t.wrap(fakeSock);
  const after1 = fakeSock.sendMessage;
  t.wrap(fakeSock);
  const after2 = fakeSock.sendMessage;
  assert.notEqual(before, after1, 'should wrap on first call');
  assert.equal(after1, after2, 'second wrap call is a no-op');
});

test('sentMessageTracker — forget removes an entry', async () => {
  const t = require('../../services/sentMessageTracker');
  t._resetForTests();
  const fakeSock = {
    sendMessage: async (jid) => ({ key: { id: 'specific-id', remoteJid: jid } }),
  };
  t.wrap(fakeSock);
  await fakeSock.sendMessage('c@g.us', {});
  assert.equal(t.recent('c@g.us').length, 1);
  assert.equal(t.forget({ id: 'specific-id', remoteJid: 'c@g.us' }), true);
  assert.equal(t.recent('c@g.us').length, 0);
  assert.equal(t.forget({ id: 'no-such', remoteJid: 'c@g.us' }), false);
});

/* ─── greetingService ──────────────────────────────────────────────── */

test('greetingService.renderTemplate — substitutes {user}/{group}/{count}', () => {
  const g = require('../../services/greetingService');
  const out = g.renderTemplate('hi {user} in {group} (#{count})', {
    userJid: '12345@s.whatsapp.net',
    groupName: 'My Group',
    count: 42,
  });
  assert.equal(out, 'hi @12345 in My Group (#42)');
});

test('greetingService.renderTemplate — handles missing values', () => {
  const g = require('../../services/greetingService');
  const out = g.renderTemplate('hi {user} in {group} (#{count})', {});
  assert.equal(out, 'hi @ in this group (#?)');
});

test('greetingService.validateTemplate — rejects empty + oversize', () => {
  const g = require('../../services/greetingService');
  assert.ok(g.validateTemplate(''));
  assert.ok(g.validateTemplate('   '));
  assert.ok(g.validateTemplate('x'.repeat(g.MAX_TEMPLATE_CHARS + 1)));
  assert.equal(g.validateTemplate('hello {user}'), null);
});

test('greetingService.defaults are sane', () => {
  const g = require('../../services/greetingService');
  assert.ok(g.DEFAULT_WELCOME.includes('{user}'));
  assert.ok(g.DEFAULT_GOODBYE.includes('{user}'));
});

/* ─── command module shape ─────────────────────────────────────────── */

test('shorten command — module shape', () => {
  const c = require('../../commands/tools/shorten');
  assert.equal(c.name, 'shorten');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('short'));
});

test('summarize command — module shape', () => {
  const c = require('../../commands/general/summarize');
  assert.equal(c.name, 'summarize');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('tldr'));
});

test('purge command — module shape + admin gate', () => {
  const c = require('../../commands/admin/purge');
  assert.equal(c.name, 'purge');
  assert.equal(c.category, 'admin');
  assert.equal(c.admin, true);
  assert.equal(typeof c.start, 'function');
});

test('welcome command — module shape + group gate', () => {
  const c = require('../../commands/group/welcome');
  assert.equal(c.name, 'welcome');
  assert.equal(c.category, 'group');
  assert.equal(c.group, true);
  assert.equal(c.needsMetadata, true);
  assert.equal(typeof c.start, 'function');
});

test('imagine command — module shape', () => {
  const c = require('../../commands/general/imagine');
  assert.equal(c.name, 'imagine');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('img'));
});
