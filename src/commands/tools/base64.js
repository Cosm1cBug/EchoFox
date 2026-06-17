/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .base64 — encode/decode base64. Reply-aware.
 *
 *   .base64 enc Hello world
 *   .base64 dec SGVsbG8gd29ybGQ=
 *   .base64 enc           (replying to a text message)
 *   .base64 dec           (replying to a base64 string)
 *
 * Modes:
 *   enc | encode | e        → utf8 → base64
 *   dec | decode | d        → base64 → utf8
 *
 * Soft cap on input: 8 KB. Validates base64 alphabet on decode.
 */

const MAX_INPUT_BYTES = 8 * 1024;
const ENC_VERBS = new Set(['enc', 'encode', 'e']);
const DEC_VERBS = new Set(['dec', 'decode', 'd']);
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

module.exports = {
  name: 'base64',
  alias: ['b64'],
  desc: 'Base64 encode / decode.',
  category: 'tools',
  type: 'tools',
  usage: '<enc|dec> [text] | reply',
  cooldown: 2,

  async start(sock, m, { ctx, text }) {
    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const verb = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const inline = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
    const quoted = ctx.quoted?.text || '';

    if (!ENC_VERBS.has(verb) && !DEC_VERBS.has(verb)) {
      return ctx.reply(
        '🔣 *Base64*\n\n' +
          'Usage:\n' +
          '• `.base64 enc <text>` — encode\n' +
          '• `.base64 dec <b64>` — decode\n' +
          '• reply + `.base64 enc` / `.base64 dec`',
      );
    }

    const payload = inline || quoted;
    if (!payload) {
      return ctx.reply(`Provide some text after \`${verb}\` or reply to a message.`);
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_INPUT_BYTES) {
      return ctx.reply(`❌ Input too large (max ${MAX_INPUT_BYTES} bytes).`);
    }

    await ctx.react('🔣');

    if (ENC_VERBS.has(verb)) {
      const out = Buffer.from(payload, 'utf8').toString('base64');
      return ctx.reply(`🔣 *Base64 encoded* (${out.length} chars)\n\n\`\`\`\n${out}\n\`\`\``);
    }

    // decode
    const trimmed = payload.replace(/\s+/g, '');
    if (!B64_RE.test(trimmed)) {
      return ctx.reply("❌ That doesn't look like valid base64.");
    }
    let out;
    try {
      out = Buffer.from(trimmed, 'base64').toString('utf8');
    } catch (err) {
      return ctx.reply(`❌ Decode failed: ${err.message}`);
    }
    return ctx.reply(`🔣 *Base64 decoded* (${out.length} chars)\n\n\`\`\`\n${out}\n\`\`\``);
  },
};
