/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .toimg  (alias: .toimage)
 *
 * Convert a quoted WebP sticker into a PNG. Uses ffmpeg (via fluent-
 * ffmpeg) to do the actual transcode — no shell exec, no temp-file
 * dance, results stream straight back as a Buffer.
 */

const ffmpeg = require('fluent-ffmpeg');
const { PassThrough, Readable } = require('node:stream');

function webpBufferToPng(buf) {
  return new Promise((resolve, reject) => {
    const inStream  = Readable.from(buf);
    const outStream = new PassThrough();
    const chunks    = [];
    outStream.on('data', (c) => chunks.push(c));
    outStream.on('end',  () => resolve(Buffer.concat(chunks)));
    outStream.on('error', reject);

    ffmpeg(inStream)
      .inputFormat('webp_pipe')
      .outputFormat('image2')
      .outputOptions('-vcodec', 'png')
      .on('error', reject)
      .pipe(outStream, { end: true });
  });
}

module.exports = {
  name: 'toimg',
  alias: ['toimage', 'sticker2img'],
  desc: 'Convert a quoted sticker into a PNG image',
  category: 'convert',
  cooldown: 5,
  timeout: 30,

  async start(sock, m, { ctx }) {
    if (ctx.quoted?.type !== 'stickerMessage') {
      return ctx.reply('↩️ Reply to a *sticker* with `.toimg` to convert it back into an image.');
    }

    await ctx.react('🎨');

    let webpBuf;
    try {
      webpBuf = await ctx.downloadMsg();
    } catch (err) {
      throw new Error(`Could not download sticker: ${err.message}`);
    }

    // v0.4.5: cap source size — ffmpeg conversion is memory-intensive
    const MAX_BYTES = 4 * 1024 * 1024;
    if (webpBuf.length > MAX_BYTES) {
      return ctx.reply(`🚫 Sticker too large (${(webpBuf.length/1e6).toFixed(1)}MB). Max is 4MB.`);
    }

    let pngBuf;
    try {
      pngBuf = await webpBufferToPng(webpBuf);
      if (!pngBuf.length) throw new Error('empty conversion output');
    } catch (err) {
      throw new Error(`Conversion failed (ffmpeg installed?): ${err.message}`);
    }

    await sock.sendMessage(ctx.from, {
      image: pngBuf,
      mimetype: 'image/png',
      caption: '✅ Converted to image',
    }, { quoted: m });
  },
};
