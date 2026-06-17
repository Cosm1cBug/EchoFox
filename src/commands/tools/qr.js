/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .qr — generate a QR-code image from arbitrary text.
 *
 *   .qr https://example.com
 *   .qr WIFI:T:WPA;S:MyNet;P:hunter2;;
 *   .qr Hello world — this becomes a QR
 *
 * Uses the lightweight `qrcode` package (no native deps) to render PNG
 * buffers fully offline. Renders at 512×512 with a generous quiet zone
 * so the result scans cleanly even after WhatsApp's lossy re-encode.
 *
 * Soft caps:
 *   • max 2 KB of input text (QR spec hard-limit is ~2.9 KB at L-EC, but
 *     anything over ~700 chars becomes unreadable on a phone screen).
 *   • Single command rate-limited to once per 5 s per user via cooldown.
 */

const QRCode = require('qrcode');

const MAX_INPUT_BYTES = 2048;

module.exports = {
  name: 'qr',
  alias: ['qrcode', 'qrgen'],
  desc: 'Generate a QR-code image from text or a URL.',
  category: 'tools',
  type: 'tools',
  usage: '<text or url>',
  cooldown: 5,

  async start(sock, m, { ctx, text }) {
    const payload = String(text || '').trim();
    if (!payload) {
      return ctx.reply(
        '🔳 *QR generator*\n\n' +
          'Usage: `.qr <text or url>`\n\n' +
          'Examples:\n' +
          '• `.qr https://github.com/Cosm1cBug/EchoFox`\n' +
          '• `.qr WIFI:T:WPA;S:MyNet;P:hunter2;;`',
      );
    }

    if (Buffer.byteLength(payload, 'utf8') > MAX_INPUT_BYTES) {
      return ctx.reply(`❌ Input too large (max ${MAX_INPUT_BYTES} bytes).`);
    }

    await ctx.react('🔳');

    const png = await QRCode.toBuffer(payload, {
      errorCorrectionLevel: 'M',
      type: 'png',
      margin: 2,
      width: 512,
      color: { dark: '#000000ff', light: '#ffffffff' },
    });

    await sock.sendMessage(
      ctx.chat,
      {
        image: png,
        caption: `🔳 *QR code* (${payload.length} chars · EC=M · 512×512)`,
        mimetype: 'image/png',
      },
      { quoted: m.raw || m },
    );
  },
};
