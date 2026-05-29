/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .sticker  (alias: .s, .stiker)
 *
 * Convert a quoted image or short video into a WhatsApp sticker.
 *
 *   • Uses `ctx.downloadMsg()` — it auto-detects quoted vs direct media.
 *   • Sticker pack name / author come from `config.sticker.{packName,packAuthor}`.
 *   • Animated stickers (video → webp) require ffmpeg.
 */

const { Sticker, StickerTypes } = require('wa-sticker-formatter');

const ALLOWED_TYPES = new Set(['imageMessage', 'videoMessage', 'stickerMessage']);

module.exports = {
  name: 'sticker',
  alias: ['s', 'stiker'],
  desc: 'Convert quoted image/short video to a WhatsApp sticker',
  category: 'convert',
  cooldown: 5,
  timeout: 45,

  async start(sock, m, { ctx, config }) {
    // Choose source: quoted message wins, else the current message itself
    const srcType = ctx.quoted?.type || ctx.mtype;

    if (!ALLOWED_TYPES.has(srcType)) {
      return ctx.reply('↩️ Reply to an *image* or *short video* with `.sticker`.');
    }

    await ctx.react('🎨');

    let buf;
    try {
      buf = await ctx.downloadMsg();
    } catch (err) {
      throw new Error(`Could not download source media: ${err.message}`);
    }

    const sticker = new Sticker(buf, {
      pack:     config.sticker.packName   || 'EchoFox',
      author:   config.sticker.packAuthor || 'COSM1CBUG',
      type:     StickerTypes.FULL,        // FULL keeps aspect ratio
      categories: ['🤖'],
      id:       'echofox',
      quality:  60,                       // good balance between size and clarity
    });

    let webp;
    try {
      webp = await sticker.toBuffer();
    } catch (err) {
      throw new Error(`Sticker conversion failed (ffmpeg installed?): ${err.message}`);
    }

    await sock.sendMessage(ctx.from, { sticker: webp }, { quoted: m });
    await ctx.react('✅');
  },
};
