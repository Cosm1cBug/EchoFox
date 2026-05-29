/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .vv  (a.k.a. .avv, .antiviewonce)
 *
 * Reply to a *view-once* image/video/audio with this command — bot
 * re-sends the media to the chat as a regular (non-view-once) message.
 *
 * Cleanups from the original:
 *   • Uses ctx.downloadMsg() (the helper from messages.upsert.js) instead
 *     of the manual `downloadContentFromMessage` + chunk-concat loop.
 *   • Uses `sock.sendMessage` properly (no `sock.sendFile` which doesn't
 *     exist by default in Baileys 7.x).
 *   • Doesn't crash if mtype/mimetype is missing.
 */

const { extractMessageContent, getContentType } = require('@whiskeysockets/baileys');

const ZONE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});

function humanBytes(b) {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(1)} ${u[i]}`;
}

module.exports = {
  name: 'antiviewonce',
  alias: ['vv', 'avv'],
  desc: 'Re-send a quoted view-once media as a regular message',
  category: 'misc',
  cooldown: 5,
  timeout: 60,

  async start(sock, m, { ctx }) {
    // Find the view-once wrapper either on the current message or the quoted one.
    const sourceMsg = ctx.quoted?.message || m.message;
    const inner = extractMessageContent(sourceMsg) || {};
    const innerType = getContentType(inner);

    // The actual media payload inside a viewOnceMessage{V2}
    const mediaMsg = inner?.viewOnceMessage?.message
                  || inner?.viewOnceMessageV2?.message
                  || inner?.viewOnceMessageV2Extension?.message
                  || (innerType?.startsWith('view') ? inner[innerType]?.message : null);

    if (!mediaMsg) {
      return ctx.reply('↩️ Reply to a *view-once* media message with this command.');
    }

    const mediaType = getContentType(mediaMsg);                  // imageMessage / videoMessage / audioMessage
    const media     = mediaMsg[mediaType];
    if (!mediaType || !media) {
      return ctx.reply('⚠️ That message does not contain image / video / audio media.');
    }

    await ctx.react('🔓');

    let buf;
    try {
      buf = await ctx.downloadMsg();   // works because ctx wires up the quoted/current detection
    } catch (err) {
      throw new Error(`Could not download media: ${err.message}`);
    }

    const kind = mediaType.replace('Message', '');               // image / video / audio
    const tsRaw = Number(media.mediaKeyTimestamp || media.fileEncSha256Timestamp || ctx.timestamp);
    const ts    = tsRaw ? ZONE_FORMATTER.format(new Date(tsRaw * 1000)) : '—';

    const caption =
      `🔓 *Anti View-Once*\n` +
      `*Type:*    ${kind}\n` +
      `*Caption:* ${media.caption || '_(none)_'}\n` +
      `*Size:*    ${humanBytes(Number(media.fileLength || buf.length))}\n` +
      `*When:*    ${ts}\n` +
      `*Sender:*  @${ctx.sender.split('@')[0]}`;

    const payload =
      kind === 'image' ? { image: buf, caption, mimetype: media.mimetype || 'image/jpeg' } :
      kind === 'video' ? { video: buf, caption, mimetype: media.mimetype || 'video/mp4' } :
      kind === 'audio' ? { audio: buf, mimetype: media.mimetype || 'audio/ogg', ptt: !!media.ptt } :
                         { document: buf, mimetype: media.mimetype || 'application/octet-stream',
                           fileName: `viewonce.${kind}` };

    await sock.sendMessage(ctx.from, {
      ...payload,
      mentions: [ctx.sender],
    }, { quoted: m });

    // Audio messages don't carry captions — send the info separately
    if (kind === 'audio') {
      await ctx.reply(caption);
    }
  },
};
