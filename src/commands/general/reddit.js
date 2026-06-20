/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .reddit r/<subreddit> [hot|new|top|rising] [N]
 *
 *   .reddit r/programming
 *   .reddit r/selfhosted top
 *   .reddit r/whatsapp new 3
 *   .reddit r/aww                          → defaults: hot, top 5
 *
 * Uses Reddit's public read-only JSON endpoint
 * (https://www.reddit.com/r/<sub>/<sort>/.json) — no API key required.
 *
 * Output: a compact text digest of up to MAX_POSTS posts with title,
 * author, score, comment count, and permalink. NSFW posts are filtered
 * out (so the bot stays SFW even in groups with mixed subreddits in
 * play).
 *
 * Safety:
 *   • Strict allow-list for subreddit name (alphanumeric + underscores
 *     only, 3-21 chars per Reddit's spec).
 *   • SSRF-safe: URL host is hard-coded; only sub-name + sort are
 *     interpolated via encodeURIComponent.
 *   • Body size cap 1 MB to defend against runaway responses.
 *   • 8s timeout via the existing axiosWithBreaker.
 *
 * Limits:
 *   • Reddit's unauth rate limit is generous (~60 req/min per IP).
 *     If we hit it the breaker catches the 429 and returns a friendly
 *     "service busy" message.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const MAX_POSTS = 10;
const DEFAULT_POSTS = 5;
const SUB_RE = /^[A-Za-z0-9_]{3,21}$/;
const SORTS = new Set(['hot', 'new', 'top', 'rising', 'controversial']);
const DEFAULT_SORT = 'hot';

function parseArgs(text) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'no args' };

  const tokens = raw.split(/\s+/);
  // First token: subreddit (r/<name>, /r/<name>, or <name>)
  const sub = tokens[0].replace(/^\/?r\//i, '');
  if (!SUB_RE.test(sub)) {
    return {
      error: `invalid subreddit name "${sub}" — must be 3–21 chars (letters/digits/underscore)`,
    };
  }

  // Remaining tokens: sort + count (in either order)
  let sort = DEFAULT_SORT;
  let count = DEFAULT_POSTS;
  for (const t of tokens.slice(1)) {
    const lc = t.toLowerCase();
    if (SORTS.has(lc)) {
      sort = lc;
    } else if (/^\d+$/.test(t)) {
      count = Math.max(1, Math.min(MAX_POSTS, parseInt(t, 10)));
    }
  }
  return { sub, sort, count };
}

function fmtAge(utcSec) {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - utcSec);
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  if (age < 86400) return `${Math.floor(age / 3600)}h`;
  return `${Math.floor(age / 86400)}d`;
}

function fmtScore(n) {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

module.exports = {
  name: 'reddit',
  alias: ['rdt', 'sub'],
  desc: 'Top posts from a public subreddit.',
  category: 'general',
  type: 'general',
  usage: 'r/<subreddit> [hot|new|top|rising] [N]',
  cooldown: 10,
  timeout: 15,

  async start(sock, m, { ctx, text }) {
    const parsed = parseArgs(text);
    if (parsed.error) {
      return ctx.reply(
        '🌐 *Reddit*\n\n' +
          'Usage: `.reddit r/<sub> [hot|new|top|rising] [N]`\n\n' +
          'Examples:\n' +
          '• `.reddit r/programming`\n' +
          '• `.reddit r/selfhosted top`\n' +
          '• `.reddit r/whatsapp new 3`\n\n' +
          `Defaults: sort = ${DEFAULT_SORT}, N = ${DEFAULT_POSTS} (max ${MAX_POSTS})`,
      );
    }

    const { sub, sort, count } = parsed;
    await ctx.react('🌐');

    let data;
    try {
      const resp = await axiosWithBreaker(`reddit:${sub}`, {
        method: 'GET',
        url: `https://www.reddit.com/r/${encodeURIComponent(sub)}/${encodeURIComponent(sort)}/.json`,
        params: { limit: count + 5, raw_json: 1 }, // +5 for NSFW filter overhead
        timeout: 8000,
        maxContentLength: 1_000_000,
        maxBodyLength: 1_000_000,
        headers: {
          // Reddit requires a non-default UA or it returns 429.
          'User-Agent': 'EchoFox/1.12 (+https://github.com/Cosm1cBug/EchoFox)',
        },
      });
      data = resp.data;
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Reddit is having issues. Try again shortly.');
      }
      const status = err?.response?.status;
      if (status === 403) {
        return ctx.reply(`🚫 r/${sub} is private, quarantined, or banned.`);
      }
      if (status === 404) {
        return ctx.reply(`❓ r/${sub} doesn't exist.`);
      }
      if (status === 429) {
        return ctx.reply('🐌 Reddit is rate-limiting us. Try again in a minute.');
      }
      throw err;
    }

    const children = data?.data?.children || [];
    const posts = children
      .map((c) => c?.data)
      .filter((p) => p && !p.over_18 && !p.stickied)
      .slice(0, count);

    if (!posts.length) {
      return ctx.reply(`📭 No SFW posts found in r/${sub} (${sort}).`);
    }

    const lines = [`🌐 *r/${sub}* — ${sort} (${posts.length})`, ''];
    posts.forEach((p, i) => {
      const title = (p.title || '').slice(0, 140);
      const author = p.author || '?';
      const score = fmtScore(p.score || 0);
      const comments = p.num_comments || 0;
      const age = fmtAge(p.created_utc || 0);
      const link = `https://reddit.com${p.permalink || ''}`;
      lines.push(`*${i + 1}.* ${title}`);
      lines.push(`   _u/${author} · ⬆ ${score} · 💬 ${comments} · ${age} ago_`);
      lines.push(`   ${link}`);
      lines.push('');
    });

    return ctx.reply(lines.join('\n'));
  },
};
