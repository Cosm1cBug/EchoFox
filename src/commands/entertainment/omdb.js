/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .omdb <title>
 *
 * Look up a movie / TV series on OMDb. Requires an OMDb API key in
 * `config.apis.omdb.apiKey` — the command auto-disables at boot if missing.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

module.exports = {
  name: 'omdb',
  alias: ['movie', 'series', 'imdb'],
  desc: 'Look up a movie or series on OMDb',
  category: 'entertainment',
  requires: ['apis.omdb.apiKey'],
  cooldown: 4,

  async start(sock, m, { ctx, text, config }) {
    const q = (text || '').trim();
    if (!q) return ctx.reply('Usage: `.omdb <title>`');

    await ctx.react('🎬');

    let data;

    try {
      const res = await axiosWithBreaker('omdb', {
        method: 'GET',
        url:    config.apis.omdb.url,
        timeout: 10_000,
        params: { apikey: config.apis.omdb.apiKey, t: q, plot: 'full' },
      });
      data = res.data;
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('⏱️ OMDb is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`OMDb request failed: ${err.message}`);
    }

    if (data.Response === 'False') {
      await ctx.react('🤷');
      return ctx.reply(`No result for *${q}*: ${data.Error || 'not found'}.`);
    }

    const lines = [
      `🎬 *${data.Title}* (${data.Year})`,
      `*Rated:* ${data.Rated || '—'}    *Runtime:* ${data.Runtime || '—'}`,
      `*Genre:* ${data.Genre || '—'}`,
      `*Language:* ${data.Language || '—'}`,
      `*Director:* ${data.Director || '—'}`,
      `*Actors:* ${data.Actors || '—'}`,
      '',
      `*Plot:* ${data.Plot || '—'}`,
    ];
    if (data.imdbRating && data.imdbRating !== 'N/A') {
      lines.push('', `⭐ *IMDb:* ${data.imdbRating}/10  (${data.imdbVotes || '?'} votes)`);
    }

    // Try to send with poster as external-ad thumbnail; fall back to text-only.
    let thumb;
    if (data.Poster && data.Poster !== 'N/A') {
      try {
        const img = await axiosWithBreaker('omdb-poster', {
          method:       'GET',
          url:          data.Poster,
          responseType: 'arraybuffer',
          timeout:      8000,
        });
        thumb = Buffer.from(img.data);
      } catch { /* ignore — fall back to text-only */ }
    }

    await sock.sendMessage(ctx.from, {
      text: lines.join('\n'),
      contextInfo: thumb ? {
        externalAdReply: {
          showAdAttribution: false,
          renderLargerThumbnail: true,
          title: data.Title,
          body: `${data.Year} · ${data.Type}`,
          previewType: 0,
          mediaType: 1,
          thumbnail: thumb,
        },
      } : undefined,
    }, { quoted: m });
  },
};
