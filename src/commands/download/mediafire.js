/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .mediafire <url>
 *
 * Resolve a MediaFire share URL to its direct download link and
 * stream the file back to chat.
 *
 *   MediaFire embeds the real download URL in a hidden anchor on the
 *   share page (`<a id="downloadButton" href="...">`). We scrape that
 *   one element — no public API needed, no third-party proxy.
 *
 *   Safe-guards:
 *     • only http(s)://www.mediafire.com URLs accepted
 *     • file size capped at 95 MB (WhatsApp's hard limit is 100 MB)
 *     • content-type sniffed for the send payload
 */

const axios = require('axios');

const MF_URL = /^https?:\/\/(www\.)?mediafire\.com\//i;
const HREF_RE = /id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i;
const ALT_RE  = /aria-label=["']Download file["'][^>]*href=["']([^"']+)["']/i;
const NAME_RE = /<div class=["']filename["'][^>]*>([^<]+)<\/div>/i;
const SIZE_RE = /<li>\s*<span>File size:\s*<\/span>\s*([\d.]+)\s*(MB|KB|GB)\s*<\/li>/i;

const MAX_BYTES = 95 * 1024 * 1024;

async function resolveDirect(url) {
  const r = await axios.get(url, {
    timeout: 15_000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 EchoFox/0.4' },
    validateStatus: (s) => s < 400,
  });
  const html = r.data || '';
  const m = HREF_RE.exec(html) || ALT_RE.exec(html);
  if (!m) throw new Error('could not extract download link from page');
  const direct = m[1];
  const name   = (NAME_RE.exec(html) || [, 'mediafire-file'])[1].trim();
  const sizeM  = SIZE_RE.exec(html);
  return {
    direct,
    name,
    sizeBytes: sizeM ? Math.round(
      parseFloat(sizeM[1]) * (sizeM[2] === 'MB' ? 1e6 : sizeM[2] === 'KB' ? 1e3 : 1e9),
    ) : null,
  };
}

module.exports = {
  name: 'mediafire',
  alias: ['mfdl', 'mf'],
  desc: 'Download a file from a MediaFire share URL',
  category: 'download',
  cooldown: 20,
  timeout: 240,

  async start(sock, m, { ctx, text }) {
    const url = (text || '').trim();
    if (!MF_URL.test(url)) {
      return ctx.reply('Usage: `.mediafire <https://www.mediafire.com/...>`');
    }

    await ctx.react('🔎');

    const info = await resolveDirect(url).catch((e) => {
      throw new Error(`MediaFire resolve failed: ${e.message}`);
    });

    if (info.sizeBytes && info.sizeBytes > MAX_BYTES) {
      return ctx.reply(
        `📦 *${info.name}*\nFile is ${Math.round(info.sizeBytes / 1e6)} MB — over WhatsApp's 95 MB cap.\nDirect link:\n${info.direct}`,
      );
    }

    await ctx.reply(`⏬ *${info.name}*\n_Downloading…_`);

    let payload;
    try {
      const dl = await axios.get(info.direct, {
        responseType: 'arraybuffer',
        timeout: 200_000,
        maxContentLength: MAX_BYTES,
        maxBodyLength:    MAX_BYTES,
        headers: { 'User-Agent': 'Mozilla/5.0 EchoFox/0.4' },
      });
      payload = {
        document: Buffer.from(dl.data),
        mimetype: dl.headers['content-type'] || 'application/octet-stream',
        fileName: info.name,
      };
    } catch (err) {
      throw new Error(`Download failed: ${err.message}`);
    }

    await sock.sendMessage(ctx.from, payload, { quoted: m });
    await ctx.react('✅');
  },
};
