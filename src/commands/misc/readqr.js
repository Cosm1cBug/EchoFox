/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .readqr — decode a QR code from a quoted image.
 *
 *   (reply to an image with a QR in it) .readqr
 *
 * Pipeline:
 *   1. ctx.downloadMsg() pulls the quoted image as a Buffer.
 *   2. Jimp decodes it to RGBA pixel data + dimensions.
 *   3. jsqr scans the pixel buffer.
 *   4. Reply with the decoded payload (formatted by detected type:
 *      URL, plain text, WiFi creds, vCard hint, etc.).
 *
 * Hard limits:
 *   • Max image size: MAX_IMAGE_BYTES (10 MB).
 *   • Max image dimension: 4096px (jimp scales larger ones down).
 *   • 30s command timeout (jsqr is fast, but big images get slow in
 *     jimp's pure-JS decoder).
 *
 * Privacy:
 *   QR contents are returned verbatim — including WiFi passwords if
 *   the QR encodes one. That's by design (the whole point of the
 *   command), but be aware in groups.
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

let jsQR;
let Jimp;

function _loadDeps() {
  if (!jsQR) {
    try {
      jsQR = require('jsqr');
      // jsqr's default export shape varies — accept either
      if (typeof jsQR === 'object' && typeof jsQR.default === 'function') {
        jsQR = jsQR.default;
      }
    } catch {
      jsQR = null;
    }
  }
  if (!Jimp) {
    try {
      Jimp = require('jimp').Jimp;
    } catch {
      Jimp = null;
    }
  }
  return { jsQR, Jimp };
}

/**
 * Format the decoded payload by detected schema. Returns a short
 * preamble + the raw payload (truncated to 800 chars for chat safety).
 */
function formatPayload(raw) {
  const s = String(raw || '').trim();
  if (!s) return { kind: 'empty', formatted: '_(empty payload)_' };

  const trunc = (txt) => (txt.length > 800 ? txt.slice(0, 800) + '…(truncated)' : txt);

  // URL
  if (/^https?:\/\//i.test(s)) {
    return { kind: 'url', formatted: `🔗 *URL detected*\n\n${trunc(s)}` };
  }
  // WiFi: WIFI:T:WPA;S:<ssid>;P:<pass>;;
  const wifi = /^WIFI:(?:T:([^;]*);)?(?:S:([^;]*);)?(?:P:([^;]*);)?/i.exec(s);
  if (wifi) {
    const [, t, ssid, pass] = wifi;
    return {
      kind: 'wifi',
      formatted:
        `📶 *WiFi credentials detected*\n\n` +
        `*Network:* ${ssid || '_(unknown)_'}\n` +
        `*Type:* ${t || '_(unknown)_'}\n` +
        `*Password:* \`${pass || '_(open network)_'}\``,
    };
  }
  // vCard / MeCard
  if (/^BEGIN:VCARD/i.test(s) || /^MECARD:/i.test(s)) {
    return {
      kind: 'vcard',
      formatted: `📇 *Contact card detected*\n\n\`\`\`\n${trunc(s)}\n\`\`\``,
    };
  }
  // SMS / mailto / tel
  if (/^(sms|mailto|tel|geo):/i.test(s)) {
    return { kind: 'uri', formatted: `📲 *URI detected*\n\n${trunc(s)}` };
  }
  // Plain text fallback
  return { kind: 'text', formatted: `📝 *Decoded*\n\n\`\`\`\n${trunc(s)}\n\`\`\`` };
}

module.exports = {
  name: 'readqr',
  alias: ['qrread', 'scanqr'],
  desc: 'Decode a QR code from a quoted image.',
  category: 'misc',
  type: 'misc',
  usage: '(reply to an image with a QR)',
  cooldown: 5,
  timeout: 30,

  async start(sock, m, { ctx }) {
    const { jsQR, Jimp } = _loadDeps();

    if (!jsQR) {
      return ctx.reply(
        '❌ `jsqr` package is not installed on this host. ' +
          'Run `npm install jsqr` to enable QR decoding.',
      );
    }
    if (!Jimp) {
      return ctx.reply('❌ `jimp` package is not available on this host.');
    }

    // Require quoted message with image
    if (!ctx.quoted || ctx.quoted.type !== 'imageMessage') {
      return ctx.reply(
        '📷 *Read QR*\n\n' +
          'Reply to an image containing a QR code, then send `.readqr`.\n\n' +
          'Aliases: `.qrread`, `.scanqr`',
      );
    }

    await ctx.react('🔍');

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

    // Downscale very large images (jsqr is faster on smaller buffers,
    // and most camera-shot QRs decode fine at 1024px wide).
    if (image.bitmap.width > 2048 || image.bitmap.height > 2048) {
      const ratio = 2048 / Math.max(image.bitmap.width, image.bitmap.height);
      image.resize({ w: Math.floor(image.bitmap.width * ratio) });
    }

    const { data, width, height } = image.bitmap;
    // jsQR expects Uint8ClampedArray of RGBA bytes
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);

    const code = jsQR(clamped, width, height, { inversionAttempts: 'attemptBoth' });
    if (!code || !code.data) {
      return ctx.reply(
        '❓ No QR code detected in this image. Try:\n' +
          '• Cropping closer to the QR\n' +
          "• Ensuring it's well-lit and in focus\n" +
          '• Saving as PNG instead of JPEG (less compression artefacts)',
      );
    }

    const { kind, formatted } = formatPayload(code.data);
    await ctx.react('✅');
    return ctx.reply(`${formatted}\n\n_Type: ${kind} · ${code.data.length} chars_`);
  },
};
