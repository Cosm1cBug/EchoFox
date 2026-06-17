/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .ytdl <url> — download a YouTube video or audio track.
 *
 *   .ytdl https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   .ytdl audio https://youtu.be/dQw4w9WgXcQ
 *   .ytdl video https://www.youtube.com/shorts/xyz
 *   .ytdl info  https://www.youtube.com/watch?v=…   → metadata only, no download
 *
 * ⚠️  Gated behind `config.features.ytdl`. The flag defaults to FALSE
 * because downloading from YouTube is a Terms-of-Service grey area and
 * the bot operator should opt in explicitly.
 *
 * Modes:
 *   audio (default) → m4a, audio-only highest bitrate
 *   video           → mp4, 720p (or best ≤720p available)
 *   info            → title + duration + author, no media
 *
 * Hard limits:
 *   • Max video duration: MAX_DURATION_SEC (default 15 min)
 *   • Max file size:      MAX_BYTES (default 50 MB)
 *   • Single-host validation against the YT_HOST_RE allow-list
 *     (defence-in-depth — ytdl-core itself only accepts youtube URLs,
 *     but we double-check before doing any work).
 */

const fs = require('node:fs');
const { config } = require('../../lib/configLoader');
const { getTempFile } = require('../../lib/tempManager');

let ytdl;
try {
  ytdl = require('@distube/ytdl-core');
} catch {
  ytdl = null;
}

const YT_HOST_RE =
  /^(?:(?:[a-z0-9-]+\.)?youtube\.com|youtu\.be|m\.youtube\.com|music\.youtube\.com)$/i;
const URL_RE = /\bhttps?:\/\/\S+/i;
const MAX_DURATION_SEC = 15 * 60;
const MAX_BYTES = 50 * 1024 * 1024;

const VERB_AUDIO = new Set(['audio', 'a', 'mp3', 'm4a']);
const VERB_VIDEO = new Set(['video', 'v', 'mp4']);
const VERB_INFO = new Set(['info', 'i', 'meta']);

function sanitiseFileName(s) {
  return (
    String(s || 'youtube')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'youtube'
  );
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function isValidYouTubeUrl(u) {
  try {
    const url = new URL(u);
    return YT_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

async function streamToFile(stream, outPath, byteCap) {
  return new Promise((resolve, reject) => {
    let written = 0;
    let aborted = false;
    const ws = fs.createWriteStream(outPath);
    stream.on('data', (chunk) => {
      written += chunk.length;
      if (written > byteCap) {
        aborted = true;
        stream.destroy(new Error(`exceeded byte cap (${byteCap} bytes)`));
      }
    });
    stream.on('error', (err) => {
      ws.destroy();
      reject(err);
    });
    ws.on('error', (err) => reject(err));
    ws.on('finish', () => (aborted ? reject(new Error('aborted')) : resolve(written)));
    stream.pipe(ws);
  });
}

module.exports = {
  name: 'ytdl',
  alias: ['ytd', 'youtubedl'],
  desc: 'Download a YouTube video or audio (gated by config.features.ytdl).',
  category: 'download',
  type: 'download',
  usage: '[audio|video|info] <url>',
  cooldown: 30,
  timeout: 180,

  async start(sock, m, { ctx, text }) {
    // ─── feature flag gate ───────────────────────────────────────────
    if (!config.features?.ytdl) {
      return ctx.reply(
        '🚫 `.ytdl` is disabled. An admin must set `config.features.ytdl = true` ' +
          'to enable it. Note: downloading from YouTube is a ToS grey area — opt in deliberately.',
      );
    }
    if (!ytdl) {
      return ctx.reply('❌ `@distube/ytdl-core` is not installed on this host.');
    }

    const raw = String(text || '').trim();
    if (!raw) {
      return ctx.reply(
        '📥 *YouTube downloader*\n\n' +
          'Usage:\n' +
          '• `.ytdl <url>`              — audio (default)\n' +
          '• `.ytdl audio <url>`        — audio only (m4a)\n' +
          '• `.ytdl video <url>`        — video (mp4, ≤720p)\n' +
          '• `.ytdl info <url>`         — metadata only\n\n' +
          `_Hard caps: ${MAX_DURATION_SEC / 60}m duration, ` +
          `${MAX_BYTES / 1024 / 1024}MB file size._`,
      );
    }

    // Tokenise: optional mode verb, then URL anywhere in the rest
    const tokens = raw.split(/\s+/);
    let mode = 'audio';
    if (VERB_AUDIO.has(tokens[0]?.toLowerCase())) {
      mode = 'audio';
      tokens.shift();
    } else if (VERB_VIDEO.has(tokens[0]?.toLowerCase())) {
      mode = 'video';
      tokens.shift();
    } else if (VERB_INFO.has(tokens[0]?.toLowerCase())) {
      mode = 'info';
      tokens.shift();
    }
    const rest = tokens.join(' ');
    const urlMatch = rest.match(URL_RE);
    const url = urlMatch ? urlMatch[0] : '';

    if (!url || !isValidYouTubeUrl(url)) {
      return ctx.reply(
        '❌ Provide a valid YouTube URL ' +
          '(youtube.com / youtu.be / m.youtube.com / music.youtube.com).',
      );
    }

    await ctx.react('⏳');

    let info;
    try {
      info = await ytdl.getInfo(url);
    } catch (err) {
      return ctx.reply(`❌ Couldn't fetch video info: ${err.message.slice(0, 200)}`);
    }

    const details = info.videoDetails || {};
    const duration = Number(details.lengthSeconds) || 0;
    const title = details.title || 'youtube';
    const author = details.author?.name || details.ownerChannelName || 'Unknown';

    // ─── info-only path ──────────────────────────────────────────────
    if (mode === 'info') {
      await ctx.react('ℹ️');
      return ctx.reply(
        `📺 *${title}*\n` +
          `*Channel:* ${author}\n` +
          `*Duration:* ${fmtDuration(duration)}\n` +
          `*Views:* ${Number(details.viewCount || 0).toLocaleString()}\n` +
          `*URL:* ${details.video_url || url}`,
      );
    }

    if (duration > MAX_DURATION_SEC) {
      return ctx.reply(
        `❌ Video too long (${fmtDuration(duration)} > ${fmtDuration(MAX_DURATION_SEC)} cap).`,
      );
    }
    if (details.isLiveContent) {
      return ctx.reply('❌ Refusing to download a livestream.');
    }
    if (details.isPrivate) {
      return ctx.reply('❌ Refusing to download a private video.');
    }

    // ─── choose format ───────────────────────────────────────────────
    let chosen;
    try {
      if (mode === 'video') {
        chosen = ytdl.chooseFormat(info.formats, {
          quality: 'highest',
          filter: (f) =>
            f.container === 'mp4' && f.hasVideo && f.hasAudio && (!f.height || f.height <= 720),
        });
      } else {
        chosen = ytdl.chooseFormat(info.formats, {
          quality: 'highestaudio',
          filter: 'audioonly',
        });
      }
    } catch (err) {
      return ctx.reply(`❌ No suitable format found: ${err.message}`);
    }
    if (!chosen) {
      return ctx.reply('❌ No suitable format found.');
    }

    const ext = mode === 'video' ? '.mp4' : chosen.container === 'webm' ? '.webm' : '.m4a';
    const out = getTempFile(ext);

    await ctx.react('⏬');
    let bytes;
    try {
      const stream = ytdl.downloadFromInfo(info, { format: chosen });
      bytes = await streamToFile(stream, out, MAX_BYTES);
    } catch (err) {
      try {
        fs.unlinkSync(out);
      } catch {}
      return ctx.reply(`❌ Download failed: ${err.message.slice(0, 200)}`);
    }

    // ─── send ────────────────────────────────────────────────────────
    const safeName = sanitiseFileName(title);
    const payload =
      mode === 'video'
        ? {
            video: { url: out },
            mimetype: 'video/mp4',
            fileName: `${safeName}.mp4`,
            caption: `📺 *${title}*\n_${author}_ · ${fmtDuration(duration)} · ${(bytes / 1024 / 1024).toFixed(1)} MB`,
          }
        : {
            audio: { url: out },
            mimetype: ext === '.webm' ? 'audio/webm' : 'audio/mp4',
            fileName: `${safeName}${ext}`,
          };

    try {
      await sock.sendMessage(ctx.chat, payload, { quoted: m.raw || m });
      await ctx.react('✅');
    } finally {
      // tempManager.startGC sweeps the file in ≤30 minutes anyway, but
      // we unlink eagerly to free disk on busy hosts.
      setTimeout(() => fs.promises.unlink(out).catch(() => {}), 60_000).unref();
    }
  },
};
