/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .sendstory
 *
 * Reply to a quoted *Status* (story) image/video to receive the original
 * media in DM. Uses ctx.downloadMsg() which already handles the quoted-
 * media case.
 */

const { getContentType } = require('@whiskeysockets/baileys');

module.exports = {
  name: 'sendstory',
  alias: ['savestory', 'sst'],
  desc: 'Save a quoted Status (story) image/video',
  category: 'misc',
  cooldown: 5,
  timeout: 60,

  async start(sock, m, { ctx }) {
    if (!ctx.quoted) {
      return ctx.reply('↩️ Reply to a *Status* image/video with this command.');
    }

    // A status quote usually has contextInfo.remoteJid === 'status@broadcast'
    // OR contextInfo.participant pointing to the story author.
    const innerCtx =
      ctx.raw?.message?.extendedTextMessage?.contextInfo ||
      ctx.raw?.message?.[ctx.mtype]?.contextInfo;
    const fromStatus = innerCtx?.remoteJid === 'status@broadcast' || !!innerCtx?.participant;

    if (!fromStatus) {
      return ctx.reply('🚫 The quoted message does not look like a Status update.');
    }

    const quotedType = ctx.quoted.type;
    if (quotedType !== 'imageMessage' && quotedType !== 'videoMessage') {
      return ctx.reply(
        `⚠️ Unsupported status type: \`${quotedType}\`. Only image/video stories work.`,
      );
    }

    await ctx.react('⏳');

    let buf;
    try {
      buf = await ctx.downloadMsg();
    } catch (err) {
      throw new Error(`Could not download status media: ${err.message}`);
    }

    const caption = quotedType === 'imageMessage' ? '📸 Saved from status' : '🎞️ Saved from status';
    const payload =
      quotedType === 'imageMessage' ? { image: buf, caption } : { video: buf, caption };

    await sock.sendMessage(ctx.from, payload, { quoted: m });
    await ctx.react('✅');
  },
};
