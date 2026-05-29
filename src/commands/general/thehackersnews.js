/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const axios = require('axios');

const SOURCES = {
  cyberattack: 'https://thehackernews.com/search/label/CyberAttack',
  malware:     'https://thehackernews.com/search/label/Malware',
  vuln:        'https://thehackernews.com/search/label/Vulnerability',
  data_breach: 'https://thehackernews.com/search/label/data%20breach',
  ransomware:  'https://thehackernews.com/search/label/Ransomware',
  apt:         'https://thehackernews.com/search/label/APT',
  latest:      'https://thehackernews.com/',
};

/**
 * Lightweight scraper: extract titles + URLs from The Hacker News by
 * matching their consistent `<h2 class="home-title">` markup. Avoids
 * the cheerio dependency entirely.
 */
function parseArticles(html, limit = 5) {
  const out = [];
  // Match: <h2 class="home-title">TITLE</h2>  preceded by   <a href="URL"
  const reHref  = /<a\s+[^>]*?href="(https:\/\/thehackernews\.com\/[^"]+)"[^>]*>[\s\S]*?<h2 class="home-title">([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = reHref.exec(html)) && out.length < limit) {
    const url   = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title && !out.some((a) => a.url === url)) out.push({ title, url });
  }
  return out;
}

module.exports = {
  name: 'thehackernews',
  alias: ['thn', 'hackernews', 'cybernews'],
  desc: 'Fetch latest cybersecurity headlines from thehackernews.com',
  category: 'general',

  async start(sock, m, { ctx, args }) {
    const topic = (args[0] || 'latest').toLowerCase();
    const url   = SOURCES[topic] || SOURCES.latest;

    await ctx.react('🔎');

    let html;
    try {
      const res = await axios.get(url, {
        timeout: 15_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EchoFox/0.4)' },
        validateStatus: (s) => s < 500,
      });
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      html = res.data;
    } catch (err) {
      await ctx.react('❌');
      return ctx.reply(`Could not reach thehackernews.com (${err.message}).`);
    }

    const articles = parseArticles(html, 5);
    if (!articles.length) {
      await ctx.react('🤷');
      return ctx.reply('Found no articles — site layout may have changed. Please report a bug.');
    }

    const topics = Object.keys(SOURCES).join(', ');
    const list   = articles
      .map((a, i) => `*${i + 1}.* ${a.title}\n   ${a.url}`)
      .join('\n\n');

    await ctx.react('🛡️');
    return ctx.reply(
      `🛡️ *The Hacker News* — _${topic}_\n\n${list}\n\n` +
      `_Topics:_ ${topics}\n_Usage:_ ${ctx.body.split(/\s/)[0]} <topic>`,
    );
  },
};
