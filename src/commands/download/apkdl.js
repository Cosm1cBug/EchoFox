/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .apk <name>
 *
 * Search Aptoide for an APK by name and reply with metadata plus the
 * download link. We do NOT auto-attach the .apk file because:
 *   • most are over WhatsApp's 100 MB limit
 *   • most users want to inspect the version/permissions first
 *
 *   Aptoide's `webservices.aptoide.com` REST API is public, no key.
 *   Endpoint:
 *     https://ws75.aptoide.com/api/7/apps/search?query=<q>&limit=5
 */

const axios = require('axios');

const APTOIDE_URL = 'https://ws75.aptoide.com/api/7/apps/search';
const APP_INFO    = 'https://ws75.aptoide.com/api/7/app/get';

module.exports = {
  name: 'apk',
  alias: ['apkdl', 'aptoide'],
  desc: 'Search Aptoide for an Android app and get download info',
  category: 'download',
  cooldown: 10,
  timeout: 30,

  async start(sock, m, { ctx, text }) {
    const q = (text || '').trim();
    if (!q) return ctx.reply('Usage: `.apk <app name>`');

    await ctx.react('🔎');

    let hits;
    try {
      const r = await axios.get(APTOIDE_URL, {
        params: { query: q, limit: 5 },
        timeout: 10_000,
        headers: { 'User-Agent': 'EchoFox/0.4' },
      });
      hits = r.data?.datasets?.search?.data?.list || [];
    } catch (err) {
      throw new Error(`Aptoide search failed: ${err.message}`);
    }

    if (!hits.length) {
      await ctx.react('🤷');
      return ctx.reply(`No Android apps found for *${q}*.`);
    }

    // Pick the top hit and fetch fuller details
    const top = hits[0];
    let details = top;
    try {
      const r = await axios.get(APP_INFO, {
        params: { app_id: top.id },
        timeout: 10_000,
      });
      details = r.data?.nodes?.meta?.data || top;
    } catch { /* fall back to search-result fields */ }

    const lines = [
      `📦 *${details.name}*`,
      `*Developer:* ${details.developer?.name || details.store?.name || '—'}`,
      `*Version:*   ${details.file?.vername || top.file?.vername || '—'} (build ${details.file?.vercode || '—'})`,
      `*Size:*      ${details.size ? Math.round(details.size / 1e6) + ' MB' : '—'}`,
      `*Rating:*    ${details.stats?.rating?.avg || '—'} ⭐  (${details.stats?.rating?.total || 0} reviews)`,
      `*Updated:*   ${details.updated || '—'}`,
      '',
      `*Download:* ${details.file?.path || details.file?.path_alt || top.file?.path || '—'}`,
    ];

    // Send icon as a thumbnail when available
    const iconUrl = details.icon || details.graphic || top.icon;
    let thumb;
    if (iconUrl) {
      try {
        const img = await axios.get(iconUrl, { responseType: 'arraybuffer', timeout: 6000 });
        thumb = Buffer.from(img.data);
      } catch { /* not fatal */ }
    }

    await sock.sendMessage(ctx.from, {
      text: lines.join('\n'),
      contextInfo: thumb ? {
        externalAdReply: {
          showAdAttribution: false,
          renderLargerThumbnail: false,
          title:  details.name,
          body:   details.developer?.name || details.store?.name || '',
          previewType: 0,
          mediaType: 1,
          thumbnail: thumb,
        },
      } : undefined,
    }, { quoted: m });
  },
};
