/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .spotify <url>
 *
 * Downloads a track from Spotify and replies with the MP3.
 *
 * Strategy:
 *   1. Resolve the Spotify URL → ISRC + title via Spotify's oEmbed
 *      endpoint (public, no key).
 *   2. Search YouTube Music for the resolved title via Piped (public,
 *      no key). Same approach as `.song`.
 *   3. Download audio with `@distube/ytdl-core` (already in deps).
 *
 * NOTE: Direct Spotify-encrypted-stream extraction requires a logged-in
 * account and violates Spotify ToS in most cases. We bridge through
 * YouTube Music which is the standard approach for personal-use bots.
 * See DISCLAIMER.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

let ytdl;
try {
  ytdl = require('@distube/ytdl-core');
} catch {
  ytdl = null;
}

const SPOTIFY_URL = /^https?:\/\/(open\.|play\.)?spotify\.com\/track\/[a-zA-Z0-9]+/;
const TEMP_TTL_MS = 60 * 60 * 1000;
const MAX_DURATION = 12 * 60;

async function resolveSpotify(url) {
  const r = await axiosWithBreaker('spotify-oembed', {
    method: 'GET',
    url: 'https://open.spotify.com/oembed',
    params: { url },
    timeout: 10_000,
    headers: { 'User-Agent': 'EchoFox/0.4' },
  });
  return {
    title: r.data?.title,
    thumbnail: r.data?.thumbnail_url,
  };
}

async function searchPiped(query) {
  const r = await axiosWithBreaker('piped', {
    method: 'GET',
    url: 'https://pipedapi.kavin.rocks/search',
    params: { q: query, filter: 'music_songs' },
    timeout: 15_000,
  });
  const item = (r.data?.items || []).find((i) => i.type === 'stream' || i.url);
  if (!item) return null;
  const url = item.url?.startsWith('http') ? item.url : `https://www.youtube.com${item.url}`;
  return { url, title: item.title || query, duration: item.duration || 0 };
}

function downloadAudio(url, outPath, lengthSeconds) {
  return new Promise((resolve, reject) => {
    if (lengthSeconds > MAX_DURATION) {
      return reject(
        new Error(
          `track is ${Math.floor(lengthSeconds / 60)} min — limit is ${MAX_DURATION / 60} min`,
        ),
      );
    }
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,
    });
    const out = fs.createWriteStream(outPath);
    stream.pipe(out);
    out.on('finish', () => resolve(outPath));
    out.on('error', reject);
    stream.on('error', reject);
  });
}

module.exports = {
  name: 'spotify',
  alias: ['spotifydl', 'spdl'],
  desc: 'Download a Spotify track as MP3 (via YouTube Music)',
  category: 'download',
  cooldown: 20,
  timeout: 180,

  async start(sock, m, { ctx, text }) {
    if (!ytdl) {
      return ctx.reply('❌ Requires `@distube/ytdl-core`. Run `npm install @distube/ytdl-core`.');
    }
    const url = (text || '').trim();
    if (!SPOTIFY_URL.test(url)) {
      return ctx.reply('Usage: `.spotify <spotify track url>`\n_(playlists not yet supported)_');
    }

    await ctx.react('🎵');

    let meta;

    try {
      meta = await resolveSpotify(url);
    } catch (e) {
      if (isOpenBreakerError(e)) {
        return ctx.reply('⏱️ Spotify oEmbed is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`Spotify resolve failed: ${e.message}`);
    }
    if (!meta?.title) throw new Error('Could not parse Spotify metadata');

    let yt;

    try {
      yt = await searchPiped(meta.title);
    } catch (e) {
      if (isOpenBreakerError(e)) {
        return ctx.reply('⏱️ YouTube search is currently overloaded. Try again in ~1 minute.');
      }
      throw e;
    }
    if (!yt) throw new Error(`No YouTube match for "${meta.title}"`);

    await ctx.reply(`🎵 *${meta.title}*\n_Found on YouTube — downloading…_`);

    const out = path.join(os.tmpdir(), `echofox-sp-${Date.now()}.mp3`);
    try {
      await ctx.react('⏬');
      await downloadAudio(yt.url, out, yt.duration);
      const stat = fs.statSync(out);
      if (stat.size < 1024) throw new Error('downloaded file is empty');

      await sock.sendMessage(
        ctx.from,
        {
          audio: { url: out },
          mimetype: 'audio/mpeg',
          fileName: `${meta.title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
        },
        { quoted: m },
      );

      await ctx.react('✅');
    } finally {
      setTimeout(() => fs.promises.unlink(out).catch(() => {}), TEMP_TTL_MS);
    }
  },
};
