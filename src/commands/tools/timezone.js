/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .timezone <tz | city> — current time in another timezone.
 *
 *   .timezone Asia/Tokyo
 *   .timezone Europe/London
 *   .timezone Tokyo                  (geo-lookup → resolves to IANA tz)
 *   .timezone worldclock             → preset list (NY, London, Mumbai, Tokyo, Sydney)
 *
 * Uses moment-timezone (already a dep) for IANA tz formatting.
 * City → IANA resolution uses Open-Meteo geocoding (no API key).
 */

const moment = require('moment-timezone');
const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const WORLD_CLOCK = [
  ['America/Los_Angeles', 'Los Angeles'],
  ['America/New_York', 'New York'],
  ['Europe/London', 'London'],
  ['Europe/Berlin', 'Berlin'],
  ['Asia/Dubai', 'Dubai'],
  ['Asia/Kolkata', 'Mumbai'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney'],
];

function fmt(tz) {
  return moment().tz(tz).format('ddd, D MMM YYYY · HH:mm:ss z');
}

async function cityToTz(query) {
  const resp = await axiosWithBreaker('open-meteo-geo-tz', {
    method: 'GET',
    url: 'https://geocoding-api.open-meteo.com/v1/search',
    params: { name: query, count: 1, language: 'en', format: 'json' },
    timeout: 8000,
    maxContentLength: 100_000,
    maxBodyLength: 100_000,
  });
  const hit = resp?.data?.results?.[0];
  if (!hit) return null;
  return {
    tz: hit.timezone || 'UTC',
    label: [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', '),
  };
}

module.exports = {
  name: 'timezone',
  alias: ['tz', 'time', 'worldclock'],
  desc: 'Current time in a timezone or city.',
  category: 'tools',
  type: 'tools',
  usage: '<IANA tz | city | worldclock>',
  cooldown: 5,

  async start(sock, m, { ctx, text, command }) {
    const raw = String(text || '').trim();

    // ─── worldclock preset ───────────────────────────────────────────
    if (command === 'worldclock' || raw.toLowerCase() === 'worldclock' || raw === '') {
      if (command === 'worldclock' || raw.toLowerCase() === 'worldclock') {
        const lines = WORLD_CLOCK.map(([tz, label]) => `• *${label}* — ${fmt(tz)}`);
        return ctx.reply(['🌍 *World clock*', '', ...lines].join('\n'));
      }
      // bare `.timezone` with no arg → show worldclock + help
      const lines = WORLD_CLOCK.map(([tz, label]) => `• *${label}* — ${fmt(tz)}`);
      return ctx.reply(
        ['🌍 *World clock*', '', ...lines, '', 'Usage: `.timezone <IANA tz | city>`'].join('\n'),
      );
    }

    await ctx.react('🕒');

    // ─── direct IANA timezone ────────────────────────────────────────
    if (moment.tz.zone(raw)) {
      return ctx.reply(`🕒 *${raw}*\n${fmt(raw)}`);
    }

    // ─── city → tz via geocode ───────────────────────────────────────
    try {
      const hit = await cityToTz(raw);
      if (!hit) return ctx.reply(`❓ Couldn't resolve *${raw}* to a timezone.`);
      return ctx.reply(`🕒 *${hit.label}*  _(${hit.tz})_\n${fmt(hit.tz)}`);
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Geocoding service is having issues. Try again shortly.');
      }
      throw err;
    }
  },
};
