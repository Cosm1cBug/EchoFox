/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .wiki <query>
 *
 * Searches Wikipedia and returns the first 1-3 lead paragraphs.
 * Uses Wikipedia's REST API (no scraping, no cheerio) so it's stable
 * across page layout changes.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

module.exports = {
  name: 'wiki',
  alias: ['wikipedia'],
  desc: 'Search Wikipedia and return article excerpt',
  category: 'general',
  cooldown: 4,

  async start(sock, m, { ctx, text }) {
    const q = (text || '').trim();
    if (!q) return ctx.reply('Usage: `.wiki <query>`');

    await ctx.react('🔎');

    try {
      const search = await axiosWithBreaker('wikipedia-rest', {
        method: 'GET',
        url: 'https://en.wikipedia.org/w/api.php',
        timeout: 10_000,
        params: {
          action: 'opensearch',
          search: q,
          limit: 1,
          namespace: 0,
          format: 'json',
        },
        headers: { 'User-Agent': 'EchoFox/0.4 (https://github.com/Cosm1cBug/EchoFox)' },
      });

      const title = search.data?.[1]?.[0];
      const url = search.data?.[3]?.[0];
      if (!title) {
        await ctx.react('🤷');
        return ctx.reply(`No Wikipedia page found for *${q}*.`);
      }

      const summary = await axiosWithBreaker('wikipedia-rest', {
        method: 'GET',
        url: `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        timeout: 10_000,
        headers: { 'User-Agent': 'EchoFox/0.4' },
        validateStatus: (s) => s < 500,
      });

      if (summary.status === 404 || !summary.data?.extract) {
        await ctx.react('🤷');
        return ctx.reply(`No summary available for *${title}*.`);
      }

      const extract = summary.data.extract.slice(0, 1500);
      await ctx.react('📖');
      await ctx.reply(`📖 *${summary.data.title}*\n\n${extract}\n\n🔗 ${url}`);
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('⏱️ Wikipedia is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`Wikipedia lookup failed: ${err.message}`);
    }
  },
};
