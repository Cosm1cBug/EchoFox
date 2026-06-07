/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .song <query>
 *
 * Search YouTube Music (via Piped) for the query and reply with audio.
 *
 *   Re-audited from M3 against the new ctx-only contract.
 *   Replaces the abandoned `youtubedl-core` with `@distube/ytdl-core`.
 */

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

let ytdl;

try { ytdl = require('@distube/ytdl-core'); } catch { ytdl = null; }

const TEMP_TTL_MS  = 60 * 60 * 1000;
const MAX_DURATION = 10 * 60;

async function searchYouTube(query) {
  const url = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=music_songs`;
  const { data } = await axiosWithBreaker('piped', { method: 'GET', url, timeout: 15_000 });
  const item = (data?.items || []).find((i) => i.type === 'stream' || i.url);
  if (!item) return null;
  const fullUrl = item.url?.startsWith('http')
    ? item.url
    : `https://www.youtube.com${item.url}`;
  return {
    url:      fullUrl,
    title:    item.title    || query,
    uploader: item.uploaderName || 'Unknown',
    duration: item.duration || 0,
  };
}

function downloadAudio(url, outPath, lengthSeconds) {
  return new Promise((resolve, reject) => {
    if (lengthSeconds > MAX_DURATION) {
      return reject(new Error(`track is ${Math.floor(lengthSeconds / 60)} min — limit is ${MAX_DURATION / 60} min`));
    }
    const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
    const out = fs.createWriteStream(outPath);
    stream.pipe(out);
    out.on('finish', () => resolve(outPath));
    out.on('error',  reject);
    stream.on('error', reject);
  });
}

module.exports = {
  name: 'song',
  alias: ['songdl', 'yt'],
  desc: 'Search YouTube for a song and reply with the audio (MP3)',
  category: 'download',
  cooldown: 15,
  timeout: 180,

  async start(sock, m, { ctx, text }) {
    if (!ytdl) {
      return ctx.reply('❌ Requires `@distube/ytdl-core`. Run `npm install @distube/ytdl-core`.');
    }
    if (!text || !text.trim()) {
      return ctx.reply('Usage: `.song <song name or lyrics>`');
    }

    await ctx.react('🔎');
    
    let result;
    
    try {
      result = await searchYouTube(text);
    } catch (e) {
      if (isOpenBreakerError(e)) {
        return ctx.reply('⏱️ YouTube search is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`Search failed: ${e.message}`);
    }
    if (!result) return ctx.reply(`Couldn't find anything for *${text}*.`);

    await ctx.reply(
      `🎵 *${result.title}*\n_${result.uploader}_${result.duration ? ` · ${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')}` : ''}\n\nDownloading…`,
    );

    const out = path.join(os.tmpdir(), `echofox-song-${Date.now()}.mp3`);
    try {
      await ctx.react('⏬');
      await downloadAudio(result.url, out, result.duration || 0);

      const stat = fs.statSync(out);
      if (stat.size < 1024) throw new Error('downloaded file is empty');

      await sock.sendMessage(ctx.from, {
        audio: { url: out },
        mimetype: 'audio/mpeg',
        fileName: `${result.title.replace(/[\\/:*?"<>|]/g, '_')}.mp3`,
      }, { quoted: m });

      await ctx.react('✅');
    } finally {
      setTimeout(() => fs.promises.unlink(out).catch(() => {}), TEMP_TTL_MS);
    }
  },
};
