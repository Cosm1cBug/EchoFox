/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .sendstory
 *
 * Reply to a WhatsApp Status (story) image/video with `.sendstory` (or
 * just `send` while quoting it in any private chat) to receive the
 * original media in DM. Useful for archiving stories without screenshots.
 *
 * Originally this was a passive listener inside messages.upsert; the new
 * router makes it a proper command for clarity.
 */
const { downloadMediaMessage, generateWAMessage, getContentType } =
  require('@whiskeysockets/baileys');
const pino = require('pino');

const quietLogger = pino({ level: 'silent' });

module.exports = {
  name: 'sendstory',
  alias: ['send', 'savestory'],
  desc: 'Reply to a quoted status (story) to get the media in DM',
  category: 'misc',

  async start(sock, m, { ctx }) {
    if (!ctx.quoted) {
      return ctx.reply(
        '↩️ Reply to a *Status* (story) image/video with this command to receive it.',
      );
    }

    // Must originate from status@broadcast (or have status participant)
    const fromStatus =
      ctx.raw?.message?.extendedTextMessage?.contextInfo?.remoteJid === 'status@broadcast' ||
      ctx.raw?.message?.extendedTextMessage?.contextInfo?.participant;

    if (!fromStatus) {
      return ctx.reply('🚫 The quoted message does not look like a Status.');
    }

    const quotedType = ctx.quoted.type;
    if (quotedType !== 'imageMessage' && quotedType !== 'videoMessage') {
      return ctx.reply(`⚠️ Unsupported status type: \`${quotedType}\`. Only image/video stories work.`);
    }

    await ctx.react('⏳');

    try {
      const ctxInfo = ctx.raw.message.extendedTextMessage.contextInfo;
      const fakeMsg = await generateWAMessage(
        ctxInfo.participant,
        {
          forward: {
            key: { id: ctxInfo.stanzaId, remoteJid: ctxInfo.participant },
            message: ctx.quoted.message,
          },
        },
        { logger: quietLogger },
      );

      const buffer = await downloadMediaMessage(
        fakeMsg,
        'buffer',
        {},
        {
          reuploadRequest: sock.updateMediaMessage,
          logger: quietLogger,
        },
      );

      const payload = quotedType === 'imageMessage'
        ? { image: buffer, caption: '📸 Saved from status' }
        : { video: buffer, caption: '🎞️ Saved from status' };

      await sock.sendMessage(ctx.from, payload, { quoted: m });
      await ctx.react('✅');
    } catch (err) {
      await ctx.react('❌');
      return ctx.reply(`Failed to fetch status media: ${err.message}`);
    }
  },
};
