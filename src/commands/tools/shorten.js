/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .shorten <url> — return a short URL via is.gd.
 *
 *   .shorten https://example.com/very/long/path?with=many&query=params
 *   .short  https://github.com/Cosm1cBug/EchoFox
 *
 * is.gd is a free, no-key, single-shot URL shortener. It validates the
 * input URL server-side and returns a short URL in the body. We use the
 * existing axiosWithBreaker so circuit-breaker + retry semantics apply
 * just like every other upstream call.
 *
 * Safety notes:
 *   • Reject anything that isn't http(s).
 *   • Reject any URL whose hostname matches the SSRF private-host list
 *     (reuse toolRegistry._isPrivateHost so we don't drift) — we don't
 *     want to help shorten link to internal infra.
 *   • Soft cap input length at 2 KB (is.gd's limit is 5 KB).
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');
const toolRegistry = require('../../services/ai/toolRegistry');

const MAX_URL_LEN = 2048;
const URL_RE = /^https?:\/\/\S+$/i;

module.exports = {
  name: 'shorten',
  alias: ['short', 'tinyurl'],
  desc: 'Shorten a URL via is.gd.',
  category: 'tools',
  type: 'tools',
  usage: '<url>',
  cooldown: 5,

  async start(sock, m, { ctx, text }) {
    const url = String(text || '').trim();
    if (!url) {
      return ctx.reply(
        '🔗 *URL shortener*\n\n' +
          'Usage: `.shorten <url>`\n\n' +
          'Example: `.shorten https://github.com/Cosm1cBug/EchoFox`',
      );
    }
    if (!URL_RE.test(url)) {
      return ctx.reply("❌ That doesn't look like an http(s) URL.");
    }
    if (url.length > MAX_URL_LEN) {
      return ctx.reply(`❌ URL too long (max ${MAX_URL_LEN} chars).`);
    }

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return ctx.reply('❌ Could not parse that URL.');
    }

    // Reuse SSRF guard so we never shorten links to private infra.
    if (toolRegistry._isPrivateHost && toolRegistry._isPrivateHost(parsed.hostname)) {
      return ctx.reply('🚫 Refusing to shorten a link to a private/internal host.');
    }

    await ctx.react('🔗');

    let resp;
    try {
      resp = await axiosWithBreaker('isgd-shorten', {
        method: 'GET',
        url: 'https://is.gd/create.php',
        params: { format: 'simple', url },
        timeout: 8000,
        maxContentLength: 2048,
        maxBodyLength: 2048,
        responseType: 'text',
      });
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 is.gd is having issues. Try again shortly.');
      }
      throw err;
    }

    const body = String(resp.data || '').trim();
    if (!body || body.toLowerCase().startsWith('error')) {
      return ctx.reply(`❌ is.gd rejected the URL: ${body.slice(0, 200) || 'empty response'}`);
    }
    if (!/^https?:\/\//i.test(body)) {
      return ctx.reply(`❌ Unexpected response from is.gd: ${body.slice(0, 200)}`);
    }

    return ctx.reply(
      `🔗 *Shortened*\n\n` +
        `*From:* ${url.length > 80 ? url.slice(0, 80) + '…' : url}\n` +
        `*To:*   ${body}`,
    );
  },
};
