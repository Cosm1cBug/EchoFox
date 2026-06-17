/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .hash — hash arbitrary text with one of several algorithms.
 *
 *   .hash md5 hello
 *   .hash sha256 the quick brown fox
 *   .hash sha1            (replying to a message)
 *   .hash                 → show supported algorithms
 *
 * Supported algorithms (delegated to Node's crypto.createHash):
 *   md5, sha1, sha256, sha384, sha512
 *
 * Soft cap on input: 64 KB.
 *
 * Outputs hex-encoded digest. Note: MD5 and SHA-1 are cryptographically
 * broken — they're included for compatibility/checksums, not security.
 */

const crypto = require('node:crypto');

const ALGS = new Set(['md5', 'sha1', 'sha256', 'sha384', 'sha512']);
const MAX_INPUT_BYTES = 64 * 1024;

module.exports = {
  name: 'hash',
  alias: ['digest'],
  desc: 'Hash text with md5/sha1/sha256/sha384/sha512.',
  category: 'tools',
  type: 'tools',
  usage: '<algo> [text] | reply',
  cooldown: 2,

  async start(sock, m, { ctx, text }) {
    const raw = String(text || '').trim();
    const firstSpace = raw.indexOf(' ');
    const algo = (firstSpace === -1 ? raw : raw.slice(0, firstSpace)).toLowerCase();
    const inline = firstSpace === -1 ? '' : raw.slice(firstSpace + 1).trim();
    const quoted = ctx.quoted?.text || '';

    if (!algo || !ALGS.has(algo)) {
      return ctx.reply(
        '🔐 *Hash*\n\n' +
          `Usage: \`.hash <algo> <text>\`  (or reply + \`.hash <algo>\`)\n\n` +
          `*Algorithms:* ${[...ALGS].join(', ')}\n\n` +
          'Examples:\n' +
          '• `.hash sha256 hello world`\n' +
          '• `.hash md5` (reply to a message)\n\n' +
          '_Note: md5 and sha1 are broken; use for checksums only, not security._',
      );
    }

    const payload = inline || quoted;
    if (!payload) {
      return ctx.reply(`Provide some text after \`${algo}\` or reply to a message.`);
    }
    if (Buffer.byteLength(payload, 'utf8') > MAX_INPUT_BYTES) {
      return ctx.reply(`❌ Input too large (max ${MAX_INPUT_BYTES} bytes).`);
    }

    await ctx.react('🔐');

    const digest = crypto.createHash(algo).update(payload, 'utf8').digest('hex');
    return ctx.reply(
      `🔐 *${algo.toUpperCase()}* (${digest.length} hex chars)\n\n\`\`\`\n${digest}\n\`\`\``,
    );
  },
};
