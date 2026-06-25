/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ocr — extract text from a quoted image via Tesseract.js.
 *
 *   (reply to an image containing text) .ocr
 *   .ocr eng                              (force language; default = eng)
 *   .ocr eng+hin                           (multi-lang OCR)
 *
 * Pipeline:
 *   1. ctx.downloadMsg() pulls the quoted image as a Buffer.
 *   2. Jimp decodes + (optionally) downscales for OCR speed.
 *   3. Tesseract.js scans for text using the requested language pack(s).
 *   4. Reply with the recognised text (trimmed, code-blocked if multi-line).
 *
 * Languages: tesseract.js supports ~100 language packs out of the box.
 * Common: eng, fra, deu, spa, ita, jpn, kor, chi_sim, chi_tra, hin,
 * ara, rus, por. Language packs download on first use (~5 MB each)
 * and cache locally.
 *
 * Hard limits:
 *   • Max image size: MAX_IMAGE_BYTES (10 MB) — same as .readqr
 *   • Auto-downscale anything wider than 2048px (faster + similar accuracy)
 *   • 60s command timeout (Tesseract.js is slow on big/dense images)
 *   • Max recognised-text length: 4000 chars (WhatsApp message limit-ish)
 *
 * Privacy:
 *   The image is processed locally — no third-party API. Tesseract.js
 *   runs entirely in-process. Language packs download from
 *   https://tessdata.projectnaptha.com on first use only.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 4000;
const DEFAULT_LANG = 'eng';
const VALID_LANG_RE = /^[a-z]{3}(?:\+[a-z]{3})*$/;

let createWorker;
let Jimp;

function _loadDeps() {
  if (!createWorker) {
    try {
      createWorker = require('tesseract.js').createWorker;
    } catch {
      createWorker = null;
    }
  }
  if (!Jimp) {
    try {
      Jimp = require('jimp').Jimp;
    } catch {
      Jimp = null;
    }
  }
  return { createWorker, Jimp };
}

module.exports = {
  name: 'ocr',
  alias: ['scan', 'readtext'],
  desc: 'Extract text from a quoted image (Tesseract.js).',
  category: 'misc',
  type: 'misc',
  usage: '[lang=eng] (reply to an image)',
  cooldown: 10,
  timeout: 60,

  async start(sock, m, { ctx, text }) {
    const { createWorker, Jimp } = _loadDeps();
    if (!createWorker) {
      return ctx.reply(
        '❌ `tesseract.js` is not installed on this host.\n' +
          'Install with: `npm install tesseract.js`',
      );
    }
    if (!Jimp) {
      return ctx.reply('❌ `jimp` package is not available on this host.');
    }

    // Require quoted image
    if (!ctx.quoted || ctx.quoted.type !== 'imageMessage') {
      return ctx.reply(
        '📷 *OCR — extract text from image*\n\n' +
          'Reply to an image with `.ocr`. Optionally add a 3-letter language code:\n' +
          '• `.ocr` — English (default)\n' +
          '• `.ocr fra` — French\n' +
          '• `.ocr eng+hin` — English + Hindi\n\n' +
          '_Aliases: `.scan`, `.readtext`_',
      );
    }

    // Parse language argument (default eng)
    const langArg =
      String(text || '')
        .trim()
        .toLowerCase() || DEFAULT_LANG;
    if (!VALID_LANG_RE.test(langArg)) {
      return ctx.reply(
        '❌ Invalid language code. Use 3-letter codes like `eng`, `fra`, ' +
          '`hin`, or combine with `+` (e.g. `eng+hin`).',
      );
    }

    await ctx.react('🔍');

    // Download + decode + downscale
    let buffer;
    try {
      buffer = await ctx.downloadMsg();
    } catch (err) {
      return ctx.reply(`❌ Couldn't download the quoted image: ${err.message}`);
    }
    if (!buffer || !buffer.length) {
      return ctx.reply('❌ Quoted image is empty.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return ctx.reply(`❌ Image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
    }

    let image;
    try {
      image = await Jimp.read(buffer);
    } catch (err) {
      return ctx.reply(`❌ Couldn't decode the image: ${err.message}`);
    }

    // Downscale wide images for OCR speed (similar accuracy <=2048px)
    if (image.bitmap.width > 2048 || image.bitmap.height > 2048) {
      const ratio = 2048 / Math.max(image.bitmap.width, image.bitmap.height);
      image.resize({ w: Math.floor(image.bitmap.width * ratio) });
    }

    // Re-encode as PNG for Tesseract (it accepts PNG/JPEG buffer)
    const pngBuf = await image.getBuffer('image/png');

    // Run Tesseract
    let worker;
    let recognised;
    try {
      worker = await createWorker(langArg);
      const result = await worker.recognize(pngBuf);
      recognised = (result?.data?.text || '').trim();
    } catch (err) {
      try {
        await worker?.terminate();
      } catch (_) {}
      return ctx.reply(
        `❌ OCR failed: ${err.message.slice(0, 200)}\n\n` +
          "Most often this means the language pack couldn't be downloaded " +
          '(check your bot host has internet on first use) or the image is ' +
          'too noisy for recognition. Try cropping to just the text region.',
      );
    }
    try {
      await worker.terminate();
    } catch (_) {}

    if (!recognised) {
      return ctx.reply(
        '❓ No text recognised in this image. Tips:\n' +
          '• Crop tightly around the text\n' +
          '• Use a clean, high-contrast image\n' +
          '• If non-English, specify the language: `.ocr fra` / `.ocr hin` / etc.',
      );
    }

    // Format the output
    const truncated = recognised.length > MAX_OUTPUT_CHARS;
    const body = truncated ? recognised.slice(0, MAX_OUTPUT_CHARS) + '\n…(truncated)' : recognised;
    const isMultiline = body.includes('\n');

    await ctx.react('✅');
    return ctx.reply(
      `📝 *OCR result* (${langArg}, ${recognised.length} chars)\n\n` +
        (isMultiline ? '```\n' + body + '\n```' : body),
    );
  },
};
