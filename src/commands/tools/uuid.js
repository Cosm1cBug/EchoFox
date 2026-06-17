/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .uuid — generate one or more UUIDs (v4) or other short ids.
 *
 *   .uuid                  → one UUID v4
 *   .uuid 5                → five UUIDs (max 25)
 *   .uuid short            → one 8-char URL-safe id (base64url)
 *   .uuid short 10         → ten short ids
 *   .uuid hex              → 16 random bytes hex (32 chars)
 *
 * Backed by Node's built-in crypto.randomUUID() + crypto.randomBytes().
 */

const crypto = require('node:crypto');

const MAX_COUNT = 25;
const MAX_SHORT_LEN = 24;
const DEFAULT_SHORT_LEN = 8;

const MODE_SHORT = new Set(['short', 's', 'nano', 'nanoid']);
const MODE_HEX = new Set(['hex', 'h']);

function shortId(bytes = 6) {
  return crypto
    .randomBytes(Math.max(1, Math.min(MAX_SHORT_LEN, bytes)))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

module.exports = {
  name: 'uuid',
  alias: ['guid', 'id'],
  desc: 'Generate UUIDs / random short IDs / hex strings.',
  category: 'tools',
  type: 'tools',
  usage: '[N] | short [N] | hex [N]',
  cooldown: 1,

  async start(sock, m, { ctx, args }) {
    const a = (args || []).map((x) => String(x).toLowerCase());
    let mode = 'uuid';
    let count = 1;

    if (a.length && MODE_SHORT.has(a[0])) {
      mode = 'short';
      count = parseInt(a[1], 10) || 1;
    } else if (a.length && MODE_HEX.has(a[0])) {
      mode = 'hex';
      count = parseInt(a[1], 10) || 1;
    } else if (a.length) {
      count = parseInt(a[0], 10) || 1;
    }
    count = Math.max(1, Math.min(MAX_COUNT, count));

    await ctx.react('🆔');

    const lines = [];
    for (let i = 0; i < count; i++) {
      if (mode === 'short') {
        lines.push(shortId(Math.ceil((DEFAULT_SHORT_LEN * 3) / 4))); // ~8 chars
      } else if (mode === 'hex') {
        lines.push(crypto.randomBytes(16).toString('hex'));
      } else {
        lines.push(crypto.randomUUID());
      }
    }

    const label =
      mode === 'short'
        ? `🆔 *Short IDs* (×${count})`
        : mode === 'hex'
          ? `🆔 *Random hex* (×${count}, 32 chars each)`
          : `🆔 *UUID v4* (×${count})`;

    return ctx.reply(`${label}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``);
  },
};
