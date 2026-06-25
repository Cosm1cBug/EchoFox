/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * v1.15.0 — commands batch tests.
 *
 *   commands:  ocr, hn, toimg-enhancements, ytdl-improvements
 *   service:   muteService with persistence + hydration
 *   store:     recordMute / markMuteUnmuted / getActiveMutes /
 *              getMuteHistoryByChat / getMuteHistoryByUser
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
    `echofox_mutes_v1150_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`,
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

/* ─── command module shape ─────────────────────────────────────── */

test('ocr command — module shape', () => {
  const c = require('../../commands/misc/ocr');
  assert.equal(c.name, 'ocr');
  assert.equal(c.category, 'misc');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('scan'));
});

test('hn command — module shape', () => {
  const c = require('../../commands/general/hn');
  assert.equal(c.name, 'hn');
  assert.equal(c.category, 'general');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('ycombinator'));
});

test('toimg (enhanced) command — module shape preserved', () => {
  const c = require('../../commands/convert/toimg');
  assert.equal(c.name, 'toimg');
  assert.equal(c.category, 'convert');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('toimage'));
});

test('ytdl (improved) command — module shape preserved', () => {
  const c = require('../../commands/download/ytdl');
  assert.equal(c.name, 'ytdl');
  assert.equal(c.category, 'download');
  assert.equal(typeof c.start, 'function');
  assert.ok(c.alias.includes('ytd'));
});

/* ─── muteService persistence + hydration ──────────────────────── */

test('muteService — hydrateFromStore populates LRU from active mutes', async () => {
  const { store, path: p } = freshStore();
  try {
    // Insert an active mute directly via the store
    const now = Math.floor(Date.now() / 1000);
    await store.recordMute('c@g.us', 'u@s.whatsapp.net', {
      expiresAt: now + 3600,
      byJid: 'admin@s.whatsapp.net',
      reason: 'test mute',
    });

    // Make muteService use this store
    const instance = require('../../store/instance');
    instance.__resetForTests();
    instance.setStore(store);

    const muteService = require('../../services/muteService');
    muteService._resetForTests();
    assert.equal(muteService.isMuted('c@g.us', 'u@s.whatsapp.net'), false);

    const n = await muteService.hydrateFromStore();
    assert.equal(n, 1);
    assert.equal(muteService.isMuted('c@g.us', 'u@s.whatsapp.net'), true);

    const entry = muteService.get('c@g.us', 'u@s.whatsapp.net');
    assert.equal(entry.by, 'admin@s.whatsapp.net');
    assert.equal(entry.reason, 'test mute');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('muteService — mute() writes to store, unmute() marks unmuted_at', async () => {
  const { store, path: p } = freshStore();
  try {
    const instance = require('../../store/instance');
    instance.__resetForTests();
    instance.setStore(store);

    const muteService = require('../../services/muteService');
    muteService._resetForTests();

    // Mute for 60s
    const until = muteService.mute('c2@g.us', 'u2@s.whatsapp.net', 60_000, {
      by: 'a@s.whatsapp.net',
      reason: 'rapid-fire bot spam',
    });
    assert.ok(until > Date.now(), 'mute should set a future until');

    // Give the async write a tick to land
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    let hist = await store.getMuteHistoryByChat('c2@g.us', 10);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].user_jid, 'u2@s.whatsapp.net');
    assert.equal(hist[0].unmuted_at, null);

    // Unmute and confirm unmuted_at gets stamped
    const was = muteService.unmute('c2@g.us', 'u2@s.whatsapp.net');
    assert.equal(was, true);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    hist = await store.getMuteHistoryByChat('c2@g.us', 10);
    assert.equal(hist.length, 1, 'history is append-only — should still be 1 entry');
    assert.ok(hist[0].unmuted_at != null, 'unmuted_at should be stamped');
    assert.ok(hist[0].unmuted_at <= Math.floor(Date.now() / 1000) + 1);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store: getMuteHistoryByUser cross-chat aggregation', async () => {
  const { store, path: p } = freshStore();
  try {
    const now = Math.floor(Date.now() / 1000);
    await store.recordMute('chatA@g.us', 'spammer@s.whatsapp.net', {
      expiresAt: now + 3600,
      reason: 'A',
    });
    await store.recordMute('chatB@g.us', 'spammer@s.whatsapp.net', {
      expiresAt: now + 7200,
      reason: 'B',
    });
    await store.recordMute('chatA@g.us', 'other@s.whatsapp.net', {
      expiresAt: now + 3600,
      reason: 'C',
    });
    const hist = await store.getMuteHistoryByUser('spammer@s.whatsapp.net');
    assert.equal(hist.length, 2);
    const chats = hist.map((h) => h.chat_jid).sort();
    assert.deepEqual(chats, ['chatA@g.us', 'chatB@g.us']);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('store: getActiveMutes excludes expired and unmuted entries', async () => {
  const { store, path: p } = freshStore();
  try {
    const now = Math.floor(Date.now() / 1000);
    // Active
    await store.recordMute('chat@g.us', 'active@s.whatsapp.net', { expiresAt: now + 3600 });
    // Expired
    await store.recordMute('chat@g.us', 'expired@s.whatsapp.net', { expiresAt: now - 60 });
    // Active, then unmuted
    await store.recordMute('chat@g.us', 'unmuted@s.whatsapp.net', { expiresAt: now + 3600 });
    await store.markMuteUnmuted('chat@g.us', 'unmuted@s.whatsapp.net');

    const active = await store.getActiveMutes();
    const jids = active.map((a) => a.user_jid).sort();
    assert.deepEqual(jids, ['active@s.whatsapp.net']);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

test('muteService.hydrateFromStore — skips expired entries', async () => {
  const { store, path: p } = freshStore();
  try {
    const instance = require('../../store/instance');
    instance.__resetForTests();
    instance.setStore(store);
    const muteService = require('../../services/muteService');
    muteService._resetForTests();

    const now = Math.floor(Date.now() / 1000);
    // Inject an active + an expired entry directly
    await store.recordMute('c@g.us', 'live@s.whatsapp.net', { expiresAt: now + 3600 });
    await store.recordMute('c@g.us', 'dead@s.whatsapp.net', { expiresAt: now - 60 });

    const n = await muteService.hydrateFromStore();
    assert.equal(n, 1);
    assert.equal(muteService.isMuted('c@g.us', 'live@s.whatsapp.net'), true);
    assert.equal(muteService.isMuted('c@g.us', 'dead@s.whatsapp.net'), false);
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});

/* ─── store: recordMute fallback when no opts ──────────────────── */

test('store.recordMute — handles missing opts gracefully', async () => {
  const { store, path: p } = freshStore();
  try {
    const id = await store.recordMute('c@g.us', 'u@s.whatsapp.net', {});
    assert.ok(id, 'recordMute should return an id even with empty opts');
    const hist = await store.getMuteHistoryByChat('c@g.us');
    assert.equal(hist.length, 1);
    assert.equal(hist[0].by_jid, null);
    assert.equal(hist[0].reason, null);
    assert.equal(hist[0].expires_at, 0, '0 = "never" sentinel for missing expiresAt');
  } finally {
    try {
      store.close();
    } catch (_) {}
    try {
      fs.rmSync(p, { force: true });
    } catch (_) {}
  }
});
