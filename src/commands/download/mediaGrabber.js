/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .dwnlod  (alias: .fetchmedia, .grab)
 *
 * Reply to any media message (image / video / audio / document / sticker)
 * to receive a clean copy back in the same chat.
 *
 *   Uses ctx.downloadMsg() so it automatically picks up the quoted
 *   message (most common case) or the direct media on the invoking
 *   message itself.
 */

const ALLOWED = new Set([
  'imageMessage', 'videoMessage', 'audioMessage',
  'documentMessage', 'stickerMessage',
]);

module.exports = {
  name: 'dwnlod',
  alias: ['fetchmedia', 'grab', 'savemedia'],
  desc: 'Save a quoted media message back to the chat',
  category: 'download',
  cooldown: 5,
  timeout: 60,

  async start(sock, m, { ctx }) {
    const srcType = ctx.quoted?.type || ctx.mtype;
    if (!ALLOWED.has(srcType)) {
      return ctx.reply('↩️ Reply to a *media* message (image / video / audio / document / sticker).');
    }

    await ctx.react('⬇️');

    let buf;
    try {
      buf = await ctx.downloadMsg();
    } catch (err) {
      throw new Error(`Could not download media: ${err.message}`);
    }

    // Pick the right send-shape per media type
    const quotedMsg = ctx.quoted?.message?.[srcType] || ctx.raw.message?.[srcType] || {};
    const mimetype  = quotedMsg.mimetype;
    const fileName  = quotedMsg.fileName;
    const caption   = quotedMsg.caption || '✅ Saved';

    const kind = srcType.replace('Message', '');
    const payload =
      kind === 'image'    ? { image:    buf, mimetype: mimetype || 'image/jpeg', caption } :
      kind === 'video'    ? { video:    buf, mimetype: mimetype || 'video/mp4',  caption } :
      kind === 'audio'    ? { audio:    buf, mimetype: mimetype || 'audio/mpeg', ptt: !!quotedMsg.ptt } :
      kind === 'document' ? { document: buf, mimetype: mimetype || 'application/octet-stream',
                              fileName: fileName || 'file' } :
      kind === 'sticker'  ? { sticker:  buf } :
                            { document: buf, mimetype: 'application/octet-stream',
                              fileName: 'media' };

    await sock.sendMessage(ctx.from, payload, { quoted: m });
    await ctx.react('✅');
  },
};
