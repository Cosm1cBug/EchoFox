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
 *   .ytdl info  https://www.youtube.com/watch?v=…   → metadata only
 *
 * v1.15.0 — new flags (all optional):
 *   -c <lang>           — also send subtitles in <lang> (e.g. -c en, -c hi)
 *   -t <start>-<end>    — clip range, MM:SS or H:MM:SS (e.g. -t 0:30-1:45)
 *
 *   .ytdl -c en https://www.youtube.com/watch?v=…       → audio + EN subs
 *   .ytdl video -t 1:00-2:30 https://...                → clip 1m–2m30s of video
 *   .ytdl -t 0:30-1:00 -c en https://...                → clip + subs
 *
 * ⚠️  Gated behind `config.features.ytdl`.
 *
 * Hard limits:
 *   • Max video duration (full): MAX_DURATION_SEC (default 15 min)
 *   • Max clip duration:         CLIP_MAX_SEC (default 10 min)
 *   • Max file size:             MAX_BYTES (default 50 MB)
 *
 * v1.15.0 better errors:
 *   Classifies common ytdl-core failures (private/age-restricted/region-
 *   locked/removed) and replies with a user-friendly explanation instead
 *   of the raw stack trace.
 */

const fs = require('node:fs');
const ffmpeg = require('fluent-ffmpeg');
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
const CLIP_MAX_SEC = 10 * 60;
const MAX_BYTES = 50 * 1024 * 1024;

const VERB_AUDIO = new Set(['audio', 'a', 'mp3', 'm4a']);
const VERB_VIDEO = new Set(['video', 'v', 'mp4']);
const VERB_INFO = new Set(['info', 'i', 'meta']);

// v1.15.0 — clip time range: MM:SS or H:MM:SS
const TIME_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/;
const RANGE_RE = /^([0-9:]+)-([0-9:]+)$/;

function parseTime(s) {
  const m = TIME_RE.exec(s);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10);
  const mins = parseInt(m[2], 10);
  const secs = parseInt(m[3], 10);
  if (mins >= 60 || secs >= 60) return null;
  return h * 3600 + mins * 60 + secs;
}

function parseRange(s) {
  const m = RANGE_RE.exec(s);
  if (!m) return null;
  const start = parseTime(m[1]);
  const end = parseTime(m[2]);
  if (start === null || end === null) return null;
  if (end <= start) return null;
  if (end - start > CLIP_MAX_SEC) return null;
  return { start, end };
}

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

/**
 * v1.15.0 — classify common ytdl-core errors into user-facing messages.
 * Returns null if the error is unclassified (caller falls back to generic).
 */
function classifyError(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('private video')) {
    return '🔒 This video is private — only invited viewers can watch it.';
  }
  if (msg.includes('age-restricted') || msg.includes('confirm your age')) {
    return "🔞 This video is age-restricted. ytdl-core cannot bypass YouTube's age gate.";
  }
  if (msg.includes('not available in your country') || msg.includes('region')) {
    return "🌍 This video is region-locked and not available from the bot's host country.";
  }
  if (msg.includes('removed') || msg.includes('terminated')) {
    return '❌ This video has been removed (or the channel was terminated).';
  }
  if (msg.includes('copyright')) {
    return '⚖️ This video is unavailable due to a copyright claim.';
  }
  if (msg.includes('login required') || msg.includes('sign in')) {
    return '🔑 This video requires you to be signed in. Cannot be downloaded by the bot.';
  }
  if (msg.includes('unavailable')) {
    return '❌ This video is currently unavailable (deleted, set to private, or YouTube outage).';
  }
  if (msg.includes('429') || msg.includes('rate')) {
    return '🐌 YouTube is rate-limiting the bot. Try again in a few minutes.';
  }
  return null;
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

/**
 * v1.15.0 — ffmpeg clip: trim an existing media file to [start, end].
 *   Uses -ss BEFORE -i for fast (keyframe-snap) seek + -t for duration.
 *   For audio, copies the codec; for video, re-encodes (clipping at
 *   non-keyframes via -c copy can produce broken streams).
 */
function clipFile(inputPath, outputPath, start, duration, isVideo) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath).setStartTime(start).setDuration(duration);
    if (isVideo) {
      // Re-encode to ensure the clip starts cleanly. Faster than full
      // re-encode by using ultrafast preset.
      cmd.outputOptions(
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
      );
    } else {
      cmd.outputOptions('-c', 'copy');
    }
    cmd
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });
}

/**
 * v1.15.0 — pull subtitles from videoInfo. Returns { text, lang } or null.
 *
 *   info.player_response.captions.playerCaptionsTracklistRenderer
 *     .captionTracks[].{ baseUrl, languageCode, name }
 *
 *   The baseUrl returns XML; we strip tags to get plain-text srt-ish.
 */
async function fetchSubtitles(info, requestedLang) {
  const tracks =
    info?.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;

  // Pick the closest matching language
  const want = requestedLang.toLowerCase();
  const match =
    tracks.find((t) => (t.languageCode || '').toLowerCase() === want) ||
    tracks.find((t) => (t.languageCode || '').toLowerCase().startsWith(want.slice(0, 2)));
  if (!match || !match.baseUrl) return null;

  const { axiosWithBreaker } = require('../../lib/network');
  let xml;
  try {
    const r = await axiosWithBreaker('yt-subs', {
      method: 'GET',
      url: match.baseUrl,
      responseType: 'text',
      timeout: 10_000,
      maxContentLength: 500_000,
      maxBodyLength: 500_000,
    });
    xml = String(r.data || '');
  } catch (e) {
    return null;
  }

  // Strip XML tags + decode common entities. Keep one line per cue.
  const text = xml
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<\/text>/g, '\n')
    .replace(/<text[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, lang: match.languageCode || requestedLang, name: match.name?.simpleText || '' };
}

/**
 * v1.15.0 — flag parser. Extracts `-c <lang>` and `-t <start>-<end>`
 * leaving the rest for the existing tokeniser. Returns { tokens, subsLang, clip }.
 */
function extractFlags(tokens) {
  const out = [];
  let subsLang = null;
  let clip = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const lc = t.toLowerCase();
    if ((lc === '-c' || lc === '--subs') && tokens[i + 1]) {
      const v = tokens[i + 1].toLowerCase();
      if (/^[a-z]{2,5}$/.test(v)) {
        subsLang = v;
        i++;
        continue;
      }
    }
    if ((lc === '-t' || lc === '--clip') && tokens[i + 1]) {
      const parsed = parseRange(tokens[i + 1]);
      if (parsed) {
        clip = parsed;
        i++;
        continue;
      }
    }
    out.push(t);
  }
  return { tokens: out, subsLang, clip };
}

module.exports = {
  name: 'ytdl',
  alias: ['ytd', 'youtubedl'],
  desc: 'Download a YouTube video/audio with optional subs and clip range (gated by config).',
  category: 'download',
  type: 'download',
  usage: '[audio|video|info] [-c <lang>] [-t <MM:SS-MM:SS>] <url>',
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
          '• `.ytdl <url>`                          — audio (default)\n' +
          '• `.ytdl audio <url>`                    — audio only (m4a)\n' +
          '• `.ytdl video <url>`                    — video (mp4, ≤720p)\n' +
          '• `.ytdl info <url>`                     — metadata only\n\n' +
          '*v1.15.0 flags:*\n' +
          '• `-c <lang>`                            — attach subtitles (e.g. `-c en`)\n' +
          '• `-t <MM:SS-MM:SS>`                     — clip a time range (≤ 10m)\n\n' +
          '*Examples:*\n' +
          '• `.ytdl -c en <url>`                    — audio + English subs\n' +
          '• `.ytdl video -t 1:00-2:30 <url>`       — clip a 90s segment of video\n' +
          '• `.ytdl -t 0:30-1:00 -c hi <url>`       — short clip + Hindi subs\n\n' +
          `_Caps: ${MAX_DURATION_SEC / 60}m full, ${CLIP_MAX_SEC / 60}m clip, ` +
          `${MAX_BYTES / 1024 / 1024}MB file._`,
      );
    }

    // Tokenise + extract flags
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

    // v1.15.0 — pull -c / -t flags from anywhere in remaining tokens
    const { tokens: residual, subsLang, clip } = extractFlags(tokens);
    const rest = residual.join(' ');
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
      const friendly = classifyError(err);
      return ctx.reply(friendly || `❌ Couldn't fetch video info: ${err.message.slice(0, 200)}`);
    }

    const details = info.videoDetails || {};
    const duration = Number(details.lengthSeconds) || 0;
    const title = details.title || 'youtube';
    const author = details.author?.name || details.ownerChannelName || 'Unknown';

    // ─── info-only path ──────────────────────────────────────────────
    if (mode === 'info') {
      await ctx.react('ℹ️');
      // v1.15.0 — list available subtitle languages too
      const tracks =
        info?.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const langs = tracks
        .map((t) => t.languageCode)
        .filter(Boolean)
        .slice(0, 12);
      const subsLine = langs.length
        ? `\n*Subtitles:* ${langs.join(', ')}${tracks.length > langs.length ? ' …' : ''}`
        : '';
      return ctx.reply(
        `📺 *${title}*\n` +
          `*Channel:* ${author}\n` +
          `*Duration:* ${fmtDuration(duration)}\n` +
          `*Views:* ${Number(details.viewCount || 0).toLocaleString()}\n` +
          `*URL:* ${details.video_url || url}` +
          subsLine,
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
      return ctx.reply('🔒 This video is private — only invited viewers can watch.');
    }

    // v1.15.0 — clip range sanity
    if (clip) {
      if (clip.end > duration) {
        return ctx.reply(
          `❌ Clip end (${fmtDuration(clip.end)}) is past the video length ` +
            `(${fmtDuration(duration)}).`,
        );
      }
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
    const fullOut = getTempFile(ext);
    let finalOut = fullOut;

    await ctx.react('⏬');
    let bytes;
    try {
      const stream = ytdl.downloadFromInfo(info, { format: chosen });
      bytes = await streamToFile(stream, fullOut, MAX_BYTES);
    } catch (err) {
      try {
        fs.unlinkSync(fullOut);
      } catch {}
      const friendly = classifyError(err);
      return ctx.reply(friendly || `❌ Download failed: ${err.message.slice(0, 200)}`);
    }

    // v1.15.0 — optional clipping pass
    if (clip) {
      const clipOut = getTempFile(ext);
      try {
        await clipFile(fullOut, clipOut, clip.start, clip.end - clip.start, mode === 'video');
        try {
          fs.unlinkSync(fullOut);
        } catch {}
        finalOut = clipOut;
        bytes = fs.statSync(clipOut).size;
      } catch (err) {
        try {
          fs.unlinkSync(clipOut);
        } catch {}
        return ctx.reply(`❌ Clipping failed: ${err.message.slice(0, 200)}`);
      }
    }

    // ─── send media ──────────────────────────────────────────────────
    const safeName = sanitiseFileName(title);
    const clipTag = clip ? ` · clip ${fmtDuration(clip.start)}–${fmtDuration(clip.end)}` : '';
    const payload =
      mode === 'video'
        ? {
            video: { url: finalOut },
            mimetype: 'video/mp4',
            fileName: `${safeName}${clip ? `-clip` : ''}.mp4`,
            caption: `📺 *${title}*\n_${author}_ · ${fmtDuration(
              clip ? clip.end - clip.start : duration,
            )} · ${(bytes / 1024 / 1024).toFixed(1)} MB${clipTag}`,
          }
        : {
            audio: { url: finalOut },
            mimetype: ext === '.webm' ? 'audio/webm' : 'audio/mp4',
            fileName: `${safeName}${clip ? `-clip` : ''}${ext}`,
          };

    try {
      await sock.sendMessage(ctx.chat, payload, { quoted: m.raw || m });

      // v1.15.0 — also fetch + send subtitles if requested
      if (subsLang) {
        try {
          const subs = await fetchSubtitles(info, subsLang);
          if (!subs) {
            await ctx.reply(
              `ℹ️ No subtitles available in *${subsLang}* for this video. ` +
                'Run `.ytdl info <url>` to see available languages.',
            );
          } else {
            const subsBuf = Buffer.from(subs.text, 'utf8');
            await sock.sendMessage(
              ctx.chat,
              {
                document: subsBuf,
                mimetype: 'text/plain',
                fileName: `${safeName}-${subs.lang}.txt`,
                caption: `📝 Subtitles (${subs.lang}${subs.name ? ` · ${subs.name}` : ''})`,
              },
              { quoted: m.raw || m },
            );
          }
        } catch (e) {
          await ctx.reply(`ℹ️ Subtitle fetch failed: ${e.message.slice(0, 200)}`);
        }
      }

      await ctx.react('✅');
    } finally {
      // Eager temp cleanup; tempManager.startGC also sweeps within 30m.
      setTimeout(() => fs.promises.unlink(finalOut).catch(() => {}), 60_000).unref();
    }
  },
};
