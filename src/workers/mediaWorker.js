/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Media worker — runs CPU-heavy ffmpeg / sticker / TTS conversions off
 * the main event loop.
 *
 * Protocol:
 *   Inbound  postMessage({ id, op, ...args })
 *   Outbound postMessage({ id, result }) or ({ id, error: { message, code } })
 *
 * Supported ops:
 *   • 'sticker'  args: { buf: ArrayBuffer, pack, author, quality? }
 *                returns: ArrayBuffer (webp)
 *
 *   • 'toimg'    args: { buf: ArrayBuffer }      (webp → png)
 *                returns: ArrayBuffer (png)
 *
 *   • 'tts'      args: { chunks: string[], lang, format='mp3' }
 *                returns: ArrayBuffer (audio)
 *
 * All buffers cross the thread boundary as ArrayBuffer (transferable)
 * to avoid copy overhead. Workers re-wrap into Buffer internally.
 */

const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const fs   = require('node:fs');
const os   = require('node:os');
const { Readable, PassThrough } = require('node:stream');

const WORKER_LABEL = `media#${workerData?.index ?? '?'}`;

function reply(id, result, transfer) {
  parentPort.postMessage({ id, result }, transfer);
}
function fail(id, err) {
  parentPort.postMessage({
    id,
    error: { message: err?.message || String(err), code: err?.code, stack: err?.stack },
  });
}

/** Convert any Buffer/ArrayBuffer/typed-array into a transferable ArrayBuffer slice. */
function toTransferable(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  // ensure underlying ArrayBuffer is exactly the buffer's bytes (not the pool)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ──────────────────────────────────────────────────────────────────────
// op: sticker
// ──────────────────────────────────────────────────────────────────────
async function opSticker({ buf, pack, author, quality }) {
  const { Sticker, StickerTypes } = require('wa-sticker-formatter');
  const input = Buffer.from(buf);
  const s = new Sticker(input, {
    pack:     pack   || 'EchoFox',
    author:   author || 'COSM1CBUG',
    type:     StickerTypes.FULL,
    categories: ['🤖'],
    id:       'echofox',
    quality:  quality || 60,
  });
  const out = await s.toBuffer();
  return toTransferable(out);
}

// ──────────────────────────────────────────────────────────────────────
// op: toimg  (webp → png via ffmpeg)
// ──────────────────────────────────────────────────────────────────────
function opToimg({ buf }) {
  return new Promise((resolve, reject) => {
    const ffmpeg = require('fluent-ffmpeg');
    const inStream  = Readable.from(Buffer.from(buf));
    const outStream = new PassThrough();
    const chunks    = [];
    outStream.on('data', (c) => chunks.push(c));
    outStream.on('end',  () => resolve(toTransferable(Buffer.concat(chunks))));
    outStream.on('error', reject);

    ffmpeg(inStream)
      .inputFormat('webp_pipe')
      .outputFormat('image2')
      .outputOptions('-vcodec', 'png')
      .on('error', reject)
      .pipe(outStream, { end: true });
  });
}

// ──────────────────────────────────────────────────────────────────────
// op: tts  (multi-chunk synth + ffmpeg merge)
// ──────────────────────────────────────────────────────────────────────
async function opTts({ chunks, lang, format }) {
  const gtts   = require('node-gtts');
  const ffmpeg = require('fluent-ffmpeg');
  const tmpDir = path.join(os.tmpdir(), 'echofox-tts-w');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const ts    = Date.now();
  const parts = [];

  const synth = (text, lang, out) => new Promise((resolve, reject) => {
    try {
      const stream = gtts(lang).stream(text);
      const file = fs.createWriteStream(out);
      stream.pipe(file);
      file.on('finish', () => resolve(out));
      file.on('error', reject);
      stream.on('error', reject);
    } catch (e) { reject(e); }
  });
  const merge = (inputs, out) => new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    inputs.forEach((f) => cmd.input(f));
    cmd.on('end', () => resolve(out)).on('error', reject)
       .mergeToFile(out, path.dirname(out));
  });

  try {
    for (let i = 0; i < chunks.length; i++) {
      const p = path.join(tmpDir, `tts-${ts}-${i}.${format || 'mp3'}`);
      await synth(chunks[i], lang, p);
      parts.push(p);
    }
    let final = parts[0];
    if (parts.length > 1) {
      final = path.join(tmpDir, `tts-${ts}-final.${format || 'mp3'}`);
      await merge(parts, final);
      parts.forEach((p) => fs.promises.unlink(p).catch(() => {}));
    }
    const out = fs.readFileSync(final);
    fs.promises.unlink(final).catch(() => {});
    return toTransferable(out);
  } catch (err) {
    parts.forEach((p) => fs.promises.unlink(p).catch(() => {}));
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
parentPort.on('message', async (msg) => {
  const { id, op } = msg || {};
  if (!id || !op) return;
  try {
    let result, transfer;
    switch (op) {
      case 'sticker': result = await opSticker(msg); transfer = [result]; break;
      case 'toimg':   result = await opToimg(msg);   transfer = [result]; break;
      case 'tts':     result = await opTts(msg);     transfer = [result]; break;
      case 'ping':    result = `pong from ${WORKER_LABEL}`; transfer = undefined; break;
      default:
        return fail(id, new Error(`unknown op: ${op}`));
    }
    reply(id, result, transfer);
  } catch (err) {
    fail(id, err);
  }
});

// Soft heartbeat — useful for diagnostics if needed later.
process.on('uncaughtException',  (e) => console.error(`[${WORKER_LABEL}]`, 'uncaught', e));
process.on('unhandledRejection', (e) => console.error(`[${WORKER_LABEL}]`, 'unhandled', e));
