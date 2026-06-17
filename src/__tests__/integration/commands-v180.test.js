/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.8.0 — integration tests for the new commands + services:
 *
 *   commands: ask, explain, warn, antilink, define, timezone, convert
 *   services: warnService, antilinkService
 *
 * The contract.test.js suite auto-discovers the new command files and
 * validates their module shape; these tests cover behaviour that lives
 * in the services + a few module-shape assertions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

/* ─── antilinkService ──────────────────────────────────────────────── */

test('antilinkService.containsLink — positive cases', () => {
  const a = require('../../services/antilinkService');
  assert.equal(a.containsLink('check this http://example.com out'), true);
  assert.equal(a.containsLink('https://github.com/Cosm1cBug/EchoFox'), true);
  assert.equal(a.containsLink('go to www.google.com'), true);
});

test('antilinkService.containsLink — negative / edge cases', () => {
  const a = require('../../services/antilinkService');
  assert.equal(a.containsLink(''), false);
  assert.equal(a.containsLink(null), false);
  assert.equal(a.containsLink('just plain text'), false);
  assert.equal(a.containsLink('node.js is fine'), false);
  assert.equal(a.containsLink('a.b and x.y arent urls'), false);
});

test('antilinkService.findFirstHost', () => {
  const a = require('../../services/antilinkService');
  assert.equal(a.findFirstHost('see https://Github.com/User/Repo'), 'github.com');
  assert.equal(a.findFirstHost('go to www.Example.COM/path'), 'example.com');
  assert.equal(a.findFirstHost('no urls here'), null);
});

test('antilinkService.isWhitelisted — exact + suffix match', () => {
  const a = require('../../services/antilinkService');
  assert.equal(a.isWhitelisted('github.com', ['github.com']), true);
  assert.equal(a.isWhitelisted('api.github.com', ['github.com']), true);
  assert.equal(a.isWhitelisted('notgithub.com', ['github.com']), false);
  assert.equal(a.isWhitelisted('GitHub.com', ['github.com']), true);
  assert.equal(a.isWhitelisted('', ['github.com']), false);
});

/* ─── warnService.parseDuration-style behaviour ────────────────────── */

test('warnService — exports + threshold bounds', () => {
  const w = require('../../services/warnService');
  assert.equal(w.DEFAULT_THRESHOLD, 3);
  assert.equal(w.MAX_THRESHOLD, 20);
  assert.ok(typeof w.addWarn === 'function');
  assert.ok(typeof w.removeWarn === 'function');
  assert.ok(typeof w.setThreshold === 'function');
});

/* ─── command module shape ─────────────────────────────────────────── */

test('ask command — module shape', () => {
  const c = require('../../commands/general/ask');
  assert.equal(c.name, 'ask');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('askme'));
});

test('explain command — module shape', () => {
  const c = require('../../commands/general/explain');
  assert.equal(c.name, 'explain');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('eli5'));
});

test('warn command — module shape + group gate', () => {
  const c = require('../../commands/group/warn');
  assert.equal(c.name, 'warn');
  assert.equal(c.category, 'group');
  assert.equal(c.group, true);
  assert.equal(c.needsMetadata, true);
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('warnings'));
});

test('antilink command — module shape + group gate', () => {
  const c = require('../../commands/group/antilink');
  assert.equal(c.name, 'antilink');
  assert.equal(c.category, 'group');
  assert.equal(c.group, true);
  assert.equal(c.needsMetadata, true);
  assert.equal(typeof c.start, 'function');
});

test('define command — module shape', () => {
  const c = require('../../commands/tools/define');
  assert.equal(c.name, 'define');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
});

test('timezone command — module shape', () => {
  const c = require('../../commands/tools/timezone');
  assert.equal(c.name, 'timezone');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('tz'));
  assert.ok(c.alias.includes('worldclock'));
});

test('convert command — module shape', () => {
  const c = require('../../commands/tools/convert');
  assert.equal(c.name, 'convert');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('fx'));
});
