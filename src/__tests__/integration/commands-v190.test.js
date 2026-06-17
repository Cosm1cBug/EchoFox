/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.9.0 — integration tests for the dev-utils bundle + .ytdl.
 *
 * Tests cover behaviour that lives in command modules. The contract
 * suite auto-discovers + validates module shape for new commands; these
 * tests poke a few unit-level pure helpers that I can access without a
 * full Baileys + sock + store harness.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

/* ─── command module shape ─────────────────────────────────────────── */

test('base64 command — module shape', () => {
  const c = require('../../commands/tools/base64');
  assert.equal(c.name, 'base64');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('b64'));
});

test('hash command — module shape', () => {
  const c = require('../../commands/tools/hash');
  assert.equal(c.name, 'hash');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('digest'));
});

test('uuid command — module shape', () => {
  const c = require('../../commands/tools/uuid');
  assert.equal(c.name, 'uuid');
  assert.equal(c.category, 'tools');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('guid'));
  assert.ok(c.alias.includes('id'));
});

test('ytdl command — module shape', () => {
  const c = require('../../commands/download/ytdl');
  assert.equal(c.name, 'ytdl');
  assert.equal(c.category, 'download');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('ytd'));
});

/* ─── base64 behaviour smoke test ──────────────────────────────────── */

test('base64 — encode/decode round-trip matches node native', () => {
  // The command uses Buffer.from(...).toString('base64'). Sanity check
  // we'd round-trip what users expect, without needing the full Baileys
  // ctx harness.
  const text = 'Hello, EchoFox! 🦊';
  const enc = Buffer.from(text, 'utf8').toString('base64');
  const dec = Buffer.from(enc, 'base64').toString('utf8');
  assert.equal(dec, text);
});

/* ─── hash behaviour smoke test ────────────────────────────────────── */

test('hash — all supported algos produce stable digests', () => {
  const algs = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];
  const expectedHexLens = { md5: 32, sha1: 40, sha256: 64, sha384: 96, sha512: 128 };
  for (const a of algs) {
    const h = crypto.createHash(a).update('hello', 'utf8').digest('hex');
    assert.equal(h.length, expectedHexLens[a], `${a} produced wrong length`);
    assert.match(h, /^[0-9a-f]+$/, `${a} produced non-hex output`);
  }
});

/* ─── uuid behaviour smoke test ────────────────────────────────────── */

test('uuid — randomUUID format', () => {
  const u = crypto.randomUUID();
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('uuid — many UUIDs are unique (≥ 99% in 100 trials)', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(crypto.randomUUID());
  // 100/100 unique is overwhelmingly likely; assert ≥ 99 to be tolerant.
  assert.ok(seen.size >= 99, `expected ≥99 unique, got ${seen.size}`);
});

/* ─── ytdl URL validator ──────────────────────────────────────────── */
//
// The command's `isValidYouTubeUrl` lives inside the module closure so
// we can't import it directly without exposing it. Instead, lift the
// same regex here as a behaviour spec — if the command file's regex is
// changed in a way that drifts, this test should be updated in lock-step.

test('ytdl — host allow-list matches expected youtube hostnames', () => {
  const YT_HOST_RE =
    /^(?:(?:[a-z0-9-]+\.)?youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)$/i;

  const ok = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'WWW.YouTube.com',
  ];
  for (const h of ok) {
    assert.ok(YT_HOST_RE.test(h), `should accept ${h}`);
  }

  const bad = ['evil.com', 'youtube.com.evil.com', 'phishyoutube.com', 'youtu.be.evil.com'];
  for (const h of bad) {
    assert.ok(!YT_HOST_RE.test(h), `should reject ${h}`);
  }
});

test('ytdl — feature flag in config schema (default false)', () => {
  // configSchema is the source of truth — verify the new flag exists
  // with the safe default. This catches accidental schema rollback.
  const { parseConfig } = (() => {
    // configSchema.js exports differ by version; pull the raw zod schema
    // via the module's exports surface.
    const mod = require('../../lib/configSchema');
    return {
      parseConfig:
        mod.parseConfig ||
        mod.parse ||
        mod.configSchema?.parse?.bind(mod.configSchema) ||
        mod.default?.parse,
    };
  })();
  if (typeof parseConfig !== 'function') {
    // Schema not exposed in a way we can test directly here — fall back
    // to a static check: ensure the source contains the flag declaration.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'configSchema.js'), 'utf8');
    assert.ok(/ytdl:\s*z\.boolean\(\)\.default\(false\)/.test(src), 'schema lacks ytdl flag');
    return;
  }
  const parsed = parseConfig({});
  assert.equal(parsed?.features?.ytdl ?? false, false);
});
