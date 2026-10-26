/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { stickerInput, MAX_STICKER_BYTES } = require('../../lib/stickerInput');

function malformedAsf() {
  const input = Buffer.alloc(100);
  Buffer.from('3026b2758e66cf11a6d9', 'hex').copy(input);
  // Header/sub-header sizes remain zero. Match the dependency's actual
  // ten-byte probe even if the rest of the supposed GUID is malformed.
  return input;
}

test('sticker guard rejects ASF, paths/URLs and oversized media, preserving bounded binary views', () => {
  const bad = malformedAsf();
  for (const input of [
    bad,
    new Uint8Array(bad),
    new Uint8Array(bad).buffer,
    'https://example.invalid/media',
  ]) {
    assert.throws(() => stickerInput(input), { code: 'EUNSUPPORTED_MEDIA' });
  }
  assert.throws(() => stickerInput(Buffer.alloc(MAX_STICKER_BYTES + 1)), { code: 'EMEDIA_SIZE' });
  const wrapped = Uint8Array.from([9, 0x89, 0x50, 0x4e, 0x47, 9]);
  assert.deepEqual(stickerInput(wrapped.subarray(1, 5)), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

test('sticker command refuses hostile ASF before entering the dependency parser', () => {
  // OS-enforced deadline also catches a future regression into a parser that
  // starves the JS event loop. Do not depend on an in-process timeout alone.
  const script = `
    const cmd = require('./src/commands/convert/sticker');
    const buf = Buffer.alloc(100); Buffer.from('3026b2758e66cf11a6d9', 'hex').copy(buf);
    const ctx = { mtype: 'imageMessage', react: async () => {}, downloadMsg: async () => buf };
    cmd.start({}, {}, { ctx, config: { sticker: {} } }).then(
      () => { process.exitCode = 1; },
      error => { if (error.code !== 'EUNSUPPORTED_MEDIA') { console.error(error); process.exitCode = 1; } }
    );
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../../..'),
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('media worker applies the same ASF guard before conversion', async (t) => {
  const worker = new Worker(path.resolve(__dirname, '../../workers/mediaWorker.js'), {
    workerData: { index: 0 },
  });
  t.after(() => worker.terminate());
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.postMessage({ id: 1, op: 'sticker', buf: new Uint8Array(malformedAsf()).buffer });
  });
  assert.equal(result.id, 1);
  assert.equal(result.error.code, 'EUNSUPPORTED_MEDIA');
});
