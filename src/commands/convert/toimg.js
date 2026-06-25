/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .toimg  (alias: .toimage, .sticker2img)
 *
 * Convert a quoted WebP sticker into an image.
 *
 * v1.15.0 — new optional flags (default behaviour unchanged):
 *
 *   .toimg                                  → PNG, original size, lossless
 *   .toimg -f jpg                           → JPEG instead of PNG
 *   .toimg -q 80                            → JPEG quality 1-100 (only with -f jpg)
 *   .toimg -s 1024                          → resize so longest side = 1024px
 *   .toimg -g                               → greyscale
 *   .toimg -f jpg -q 85 -s 512 -g           → all four combined
 *
 * Pipeline:
 *   • ffmpeg path (default): webp → png via stream pipe, no extra deps
 *   • jimp path (when any flag is set): webp → jimp → optional ops → out
 *     Flags trigger the jimp path; otherwise we keep the fast/simple
 *     ffmpeg path for backwards compatibility with v1.0–v1.14.
 *
 * Flags are parsed permissively — unknown flags fall through to default
 * behaviour rather than erroring (low-friction UX in a chat).
 */

const ffmpeg = require('fluent-ffmpeg');
const { PassThrough, Readable } = require('node:stream');

const VALID_FORMATS = new Set(['png', 'jpg', 'jpeg']);
const MAX_DIM = 4096;
const MIN_DIM = 64;

function parseFlags(text) {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const opts = { format: 'png', quality: null, size: null, greyscale: false };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if ((t === '-f' || t === '--format') && tokens[i + 1]) {
      const f = tokens[i + 1].toLowerCase();
      if (VALID_FORMATS.has(f)) opts.format = f === 'jpeg' ? 'jpg' : f;
      i++;
    } else if ((t === '-q' || t === '--quality') && tokens[i + 1]) {
      const q = parseInt(tokens[i + 1], 10);
      if (Number.isInteger(q) && q >= 1 && q <= 100) opts.quality = q;
      i++;
    } else if ((t === '-s' || t === '--size') && tokens[i + 1]) {
      const s = parseInt(tokens[i + 1], 10);
      if (Number.isInteger(s) && s >= MIN_DIM && s <= MAX_DIM) opts.size = s;
      i++;
    } else if (t === '-g' || t === '--grey' || t === '--gray' || t === '--greyscale') {
      opts.greyscale = true;
    }
  }
  return opts;
}

function webpBufferToPng(buf) {
  return new Promise((resolve, reject) => {
    const inStream = Readable.from(buf);
    const outStream = new PassThrough();
    const chunks = [];
    outStream.on('data', (c) => chunks.push(c));
    outStream.on('end', () => resolve(Buffer.concat(chunks)));
    outStream.on('error', reject);
    ffmpeg(inStream)
      .inputFormat('webp_pipe')
      .outputFormat('image2')
      .outputOptions('-vcodec', 'png')
      .on('error', reject)
      .pipe(outStream, { end: true });
  });
}

async function processWithJimp(buf, opts) {
  const { Jimp } = require('jimp');

  // Step 1: webp → PNG via ffmpeg (jimp doesn't read webp natively in all versions)
  const pngBuf = await webpBufferToPng(buf);

  // Step 2: load into jimp
  const img = await Jimp.read(pngBuf);

  // Step 3: optional resize (preserves aspect ratio — longest side caps at `size`)
  if (opts.size) {
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    if (w > opts.size || h > opts.size) {
      const ratio = opts.size / Math.max(w, h);
      img.resize({ w: Math.round(w * ratio) });
    }
  }

  // Step 4: optional greyscale
  if (opts.greyscale) {
    img.greyscale();
  }

  // Step 5: encode out
  if (opts.format === 'jpg') {
    const quality = opts.quality ?? 85;
    return {
      buf: await img.getBuffer('image/jpeg', { quality }),
      mime: 'image/jpeg',
      ext: 'jpg',
    };
  }
  return {
    buf: await img.getBuffer('image/png'),
    mime: 'image/png',
    ext: 'png',
  };
}

module.exports = {
  name: 'toimg',
  alias: ['toimage', 'sticker2img'],
  desc: 'Convert a quoted sticker into a PNG/JPG image (with optional resize/greyscale).',
  category: 'convert',
  type: 'convert',
  usage: '[-f png|jpg] [-q 1-100] [-s 64-4096] [-g] (reply to sticker)',
  cooldown: 5,
  timeout: 30,

  async start(sock, m, { ctx, text }) {
    if (ctx.quoted?.type !== 'stickerMessage') {
      return ctx.reply('↩️ Reply to a *sticker* with `.toimg` to convert it back into an image.');
    }

    const opts = parseFlags(text);
    const hasFlags =
      opts.format !== 'png' || opts.quality !== null || opts.size !== null || opts.greyscale;

    await ctx.react('🎨');

    let buffer;
    try {
      buffer = await ctx.downloadMsg();
    } catch (err) {
      return ctx.reply(`❌ Couldn't download the sticker: ${err.message}`);
    }
    if (!buffer || !buffer.length) {
      return ctx.reply('❌ Quoted sticker is empty.');
    }

    let outBuf;
    let mimetype;
    let ext;
    let label;

    try {
      if (hasFlags) {
        // Jimp path — has resize/quality/greyscale support
        const result = await processWithJimp(buffer, opts);
        outBuf = result.buf;
        mimetype = result.mime;
        ext = result.ext;
        const bits = [];
        if (opts.format === 'jpg') bits.push(`jpg q=${opts.quality ?? 85}`);
        if (opts.size) bits.push(`max ${opts.size}px`);
        if (opts.greyscale) bits.push('greyscale');
        label = bits.length ? ` _(${bits.join(' · ')})_` : '';
      } else {
        // Fast default path — ffmpeg pipe, lossless PNG (backwards compat)
        outBuf = await webpBufferToPng(buffer);
        mimetype = 'image/png';
        ext = 'png';
        label = '';
      }
    } catch (err) {
      return ctx.reply(`❌ Conversion failed: ${err.message.slice(0, 200)}`);
    }

    if (!outBuf || !outBuf.length) {
      return ctx.reply('❌ Conversion produced an empty output.');
    }

    await sock.sendMessage(
      ctx.chat || ctx.from,
      {
        image: outBuf,
        mimetype,
        caption: `🎨 sticker → ${ext}${label}`,
      },
      { quoted: m.raw || m },
    );
  },
};
