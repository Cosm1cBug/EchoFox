/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ssweb <url>
 *
 * Captures a screenshot of the given URL via a public screenshot service
 * (api.vreden.my.id, no key required). Falls back gracefully on errors.
 */

const axios = require('axios');

const URL_RE = /^https?:\/\/[^\s]+$/i;

module.exports = {
  name: 'ssweb',
  alias: ['ssw', 'webshot', 'screenshot'],
  desc: 'Capture a screenshot of a webpage',
  category: 'tools',
  cooldown: 8,
  timeout: 45,

  async start(sock, m, { ctx, text }) {
    const url = (text || '').trim();
    if (!url) return ctx.reply('Usage: `.ssweb <url>`');
    if (!URL_RE.test(url)) return ctx.reply('That doesn\'t look like a valid URL (must start with http:// or https://).');

    await ctx.react('📸');

    let buf;
    try {
      const api = `https://api.vreden.my.id/api/ssweb?url=${encodeURIComponent(url)}&type=desktop`;
      const res = await axios.get(api, { responseType: 'arraybuffer', timeout: 40_000 });
      buf = Buffer.from(res.data);
      if (!buf.length) throw new Error('empty response');
    } catch (err) {
      throw new Error(`Screenshot service failed: ${err.message}`);
    }

    await sock.sendMessage(ctx.from, {
      image: buf,
      mimetype: 'image/png',
      caption: `📸 ${url}`,
    }, { quoted: m });
  },
};
