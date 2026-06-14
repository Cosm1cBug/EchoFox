/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .pinterest <query>
 *
 * Search Pinterest for an image matching the query and send back 1–4
 * results as a small grid.
 *
 *   Uses Pinterest's public BaseSearchResource endpoint (the one their
 *   own website calls — no API key, no third-party proxy, stable for
 *   years). If the upstream payload schema ever shifts we soft-fail with
 *   a clear error.
 */

const axios = require('axios');
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const ENDPOINT = 'https://www.pinterest.com/resource/BaseSearchResource/get/';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function searchPinterest(query, limit = 4) {
  const params = {
    source_url: `/search/pins/?q=${encodeURIComponent(query)}`,
    data: JSON.stringify({
      options: {
        isPrefetch: false,
        query,
        scope: 'pins',
        bookmarks: [],
        page_size: limit,
        no_fetch_context_on_resource: false,
      },
      context: {},
    }),
    _: Date.now(),
  };

  const r = await axiosWithBreaker('pinterest-search', {
    method: 'GET',
    url: ENDPOINT,
    params,
    timeout: 15_000,
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://www.pinterest.com/',
    },
  });

  const results = r.data?.resource_response?.data?.results || [];
  return results
    .filter((p) => p.images?.orig?.url)
    .slice(0, limit)
    .map((p) => ({
      url: p.images.orig.url,
      title: p.title || p.grid_title || query,
      link: p.link || `https://www.pinterest.com/pin/${p.id}/`,
    }));
}

async function fetchImage(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15_000,
    headers: { 'User-Agent': UA },
  });
  return Buffer.from(r.data);
}

module.exports = {
  name: 'pinterest',
  alias: ['pinterestdl', 'pin'],
  desc: 'Search Pinterest and send back image results',
  category: 'download',
  cooldown: 8,
  timeout: 60,

  async start(sock, m, { ctx, text, args }) {
    const q = (text || '').trim();
    if (!q)
      return ctx.reply('Usage: `.pinterest <query>`\n_Example: .pinterest aesthetic wallpaper_');

    // optional second-arg as count, e.g. `.pinterest cats 2`
    let limit = 1;
    if (args.length > 1 && /^[1-4]$/.test(args[args.length - 1])) {
      limit = Number(args[args.length - 1]);
    }

    await ctx.react('🔎');

    const results = await searchPinterest(q, limit).catch((e) => {
      throw new Error(`Pinterest search failed: ${e.message}`);
    });
    if (!results.length) {
      await ctx.react('🤷');
      return ctx.reply(`No Pinterest results for *${q}*.`);
    }

    for (const r of results) {
      try {
        const buf = await fetchImage(r.url);
        await sock.sendMessage(
          ctx.from,
          {
            image: buf,
            caption: `📌 ${r.title}\n🔗 ${r.link}`,
          },
          { quoted: m },
        );
      } catch (err) {
        ctx.logger?.warn?.({ err, url: r.url }, 'failed to send one image, continuing');
      }
    }
    await ctx.react('✅');
  },
};
