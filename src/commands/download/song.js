/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .song <query>
 *
 * Search YouTube for the query and send back the audio as an MP3.
 *
 * The previous version depended on the abandoned `youtubedl-core` package.
 * We now rely on the maintained fork `@distube/ytdl-core`.
 *
 * NOTE on legality: downloading YouTube content is restricted by their
 * Terms of Service. This command exists for personal-use scenarios (e.g.
 * music in a private chat with one's own account). The bot operator is
 * solely responsible for compliance. See DISCLAIMER.md.
 */

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');
const axios = require('axios');

let ytdl;
try {
  // Optional dependency — gracefully no-op if not installed.
  ytdl = require('@distube/ytdl-core');
} catch {
  ytdl = null;
}

const TEMP_TTL_MS  = 60 * 60 * 1000;            // delete temp file after 1 h
const MAX_DURATION = 10 * 60;                    // refuse anything > 10 min

function tmpFile() {
  return path.join(os.tmpdir(), `echofox-song-${Date.now()}.mp3`);
}

/**
 * Lightweight YouTube search using the public yt-dlp-style oEmbed/search
 * endpoint. We avoid scraping youtube.com directly (anti-bot 429 hell).
 * If you have a Piped / Invidious instance, point this at it instead.
 */
async function searchYouTube(query) {
  // Use Piped as a free, public search API (no key required).
  // Public instances rotate — `pipedapi.kavin.rocks` is one of the more stable.
  const url = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=music_songs`;
  const { data } = await axios.get(url, { timeout: 15_000 });
  const item = (data?.items || []).find((i) => i.type === 'stream' || i.url);
  if (!item) return null;
  // Piped returns paths like "/watch?v=…"
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
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25,           // 32 MiB buffer for smoother throughput
    });
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
  desc: 'Search YouTube for a song and reply with the audio (MP3).',
  category: 'download',
  cooldown: 15,
  timeout: 120,

  async start(sock, m, { ctx, text }) {
    if (!ytdl) {
      return ctx.reply(
        '❌ This command requires `@distube/ytdl-core`. Install with:\n```npm i @distube/ytdl-core```',
      );
    }
    if (!text || !text.trim()) {
      return ctx.reply(`Usage: \`.song <song name or lyrics>\``);
    }

    await ctx.react('🔎');
    let result;
    try {
      result = await searchYouTube(text);
    } catch (err) {
      return ctx.reply(`Search failed: ${err.message}`);
    }
    if (!result) {
      return ctx.reply(`Couldn't find anything for *${text}*.`);
    }

    await ctx.reply(
      `🎵 *${result.title}*\n_${result.uploader}_${result.duration ? ` · ${Math.floor(result.duration / 60)}:${String(result.duration % 60).padStart(2, '0')}` : ''}\n\nDownloading…`,
    );

    const out = tmpFile();
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
    } catch (err) {
      await ctx.react('❌');
      throw err;
    } finally {
      setTimeout(() => fs.promises.unlink(out).catch(() => {}), TEMP_TTL_MS);
    }
  },
};
