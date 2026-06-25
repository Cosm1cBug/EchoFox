/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .hn [top|new|best|ask|show|job] [N]
 *
 *   .hn                — top 5 stories on Hacker News (default)
 *   .hn 10             — top 10 stories
 *   .hn new            — newest 5
 *   .hn best 8         — best 8
 *   .hn ask 5          — top 5 Ask HN
 *   .hn show 5         — top 5 Show HN
 *   .hn job 3          — top 3 job posts
 *
 * Backed by the official Hacker News Firebase API:
 *   https://github.com/HackerNews/API
 * No API key required. Endpoints used:
 *   GET https://hacker-news.firebaseio.com/v0/{top|new|best|ask|show|job}stories.json
 *   GET https://hacker-news.firebaseio.com/v0/item/<id>.json
 *
 * Returns up to MAX_STORIES (10) entries, with title + score + comment
 * count + URL + HN discussion link.
 *
 * Note: each story requires a separate item lookup, so requesting 10
 * stories = 11 HTTP calls (1 for the index + 10 for the items). All
 * fetched in parallel via Promise.all to keep latency at ~1 round-trip.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const MAX_STORIES = 10;
const DEFAULT_STORIES = 5;
const VALID_TYPES = new Set(['top', 'new', 'best', 'ask', 'show', 'job']);
const DEFAULT_TYPE = 'top';

const API_BASE = 'https://hacker-news.firebaseio.com/v0';

function parseArgs(text) {
  const tokens = String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let type = DEFAULT_TYPE;
  let count = DEFAULT_STORIES;
  for (const t of tokens) {
    const lc = t.toLowerCase();
    if (VALID_TYPES.has(lc)) {
      type = lc;
    } else if (/^\d+$/.test(t)) {
      count = Math.max(1, Math.min(MAX_STORIES, parseInt(t, 10)));
    }
  }
  return { type, count };
}

function fmtAge(utcSec) {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - utcSec);
  if (age < 3600) return `${Math.floor(age / 60)}m`;
  if (age < 86400) return `${Math.floor(age / 3600)}h`;
  return `${Math.floor(age / 86400)}d`;
}

function fmtScore(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

async function fetchItem(id) {
  try {
    const r = await axiosWithBreaker(`hn-item`, {
      method: 'GET',
      url: `${API_BASE}/item/${id}.json`,
      timeout: 6000,
      maxContentLength: 50_000,
      maxBodyLength: 50_000,
    });
    return r.data;
  } catch {
    return null;
  }
}

module.exports = {
  name: 'hn',
  alias: ['ycombinator', 'yc'],
  desc: 'Top stories from Hacker News.',
  category: 'general',
  type: 'general',
  usage: '[top|new|best|ask|show|job] [N]',
  cooldown: 10,
  timeout: 30,

  async start(sock, m, { ctx, text }) {
    const { type, count } = parseArgs(text);
    await ctx.react('🟧');

    // 1. Fetch the index (array of story IDs)
    let ids;
    try {
      const resp = await axiosWithBreaker('hn-index', {
        method: 'GET',
        url: `${API_BASE}/${type}stories.json`,
        timeout: 8000,
        maxContentLength: 100_000,
        maxBodyLength: 100_000,
      });
      ids = Array.isArray(resp.data) ? resp.data.slice(0, count) : [];
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Hacker News API is having issues. Try again shortly.');
      }
      throw err;
    }

    if (!ids.length) {
      return ctx.reply(`📭 No ${type} stories found.`);
    }

    // 2. Fetch all items in parallel
    const items = (await Promise.all(ids.map(fetchItem))).filter(Boolean);
    if (!items.length) {
      return ctx.reply('❌ All story lookups failed. Try again in a moment.');
    }

    // 3. Format
    const TITLES = {
      top: 'Top',
      new: 'New',
      best: 'Best',
      ask: 'Ask HN',
      show: 'Show HN',
      job: 'Jobs',
    };
    const lines = [`🟧 *Hacker News — ${TITLES[type]}* (${items.length})`, ''];
    items.forEach((p, i) => {
      const title = (p.title || '(untitled)').slice(0, 140);
      const score = fmtScore(p.score || 0);
      const comments = p.descendants || 0;
      const author = p.by || 'anon';
      const age = fmtAge(p.time || 0);
      const link = p.url || (p.id ? `https://news.ycombinator.com/item?id=${p.id}` : '');
      const hnLink = p.id ? `https://news.ycombinator.com/item?id=${p.id}` : null;

      lines.push(`*${i + 1}.* ${title}`);
      lines.push(`   _by ${author} · ⬆ ${score} · 💬 ${comments} · ${age} ago_`);
      if (link) lines.push(`   🔗 ${link}`);
      if (hnLink && hnLink !== link) lines.push(`   💬 ${hnLink}`);
      lines.push('');
    });

    return ctx.reply(lines.join('\n'));
  },
};
