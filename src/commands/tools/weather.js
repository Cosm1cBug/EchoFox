/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .weather — current conditions + 3-day forecast for any city.
 *
 *   .weather Mumbai
 *   .weather "San Francisco, US"
 *   .weather 51.5074,-0.1278            (lat,lon direct lookup)
 *
 * Uses Open-Meteo (https://open-meteo.com):
 *   • forecast API: free, no API key, generous limits (10k req/day)
 *   • geocoding  API: free, no API key
 *
 * Both endpoints are HTTPS public APIs, so the SSRF guard isn't tripped
 * (host is not private and we never let user input compose the URL host).
 *
 *   ─ Output: 3-line plaintext (location · now · 3-day) for compact display.
 *   ─ Uses the existing axiosWithBreaker helper for the same retry +
 *     circuit-breaker semantics as every other upstream call in the bot.
 *     NOTE: axiosWithBreaker() fires immediately — it is NOT a factory.
 *     Each request goes through it as `await axiosWithBreaker(name, cfg)`.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const WMO = {
  0: '☀️ Clear',
  1: '🌤️ Mostly clear',
  2: '⛅ Partly cloudy',
  3: '☁️ Overcast',
  45: '🌫️ Fog',
  48: '🌫️ Rime fog',
  51: '🌦️ Light drizzle',
  53: '🌦️ Drizzle',
  55: '🌧️ Heavy drizzle',
  56: '🌧️❄️ Freezing drizzle',
  57: '🌧️❄️ Heavy freezing drizzle',
  61: '🌧️ Light rain',
  63: '🌧️ Rain',
  65: '🌧️ Heavy rain',
  66: '🌧️❄️ Freezing rain',
  67: '🌧️❄️ Heavy freezing rain',
  71: '🌨️ Light snow',
  73: '🌨️ Snow',
  75: '❄️ Heavy snow',
  77: '🌨️ Snow grains',
  80: '🌦️ Rain showers',
  81: '🌧️ Rain showers',
  82: '⛈️ Violent rain showers',
  85: '🌨️ Snow showers',
  86: '❄️ Heavy snow showers',
  95: '⛈️ Thunderstorm',
  96: '⛈️🧊 Thunderstorm w/ hail',
  99: '⛈️🧊 Severe thunderstorm w/ hail',
};

const LAT_LON_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

const COMMON_AXIOS = {
  timeout: 8_000,
  maxContentLength: 100_000,
  maxBodyLength: 100_000,
};

function dayName(isoDate) {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

async function geocode(query) {
  const { data } = await axiosWithBreaker('open-meteo-geo', {
    method: 'GET',
    url: 'https://geocoding-api.open-meteo.com/v1/search',
    params: { name: query, count: 1, language: 'en', format: 'json' },
    ...COMMON_AXIOS,
  });
  const hit = data?.results?.[0];
  if (!hit) return null;
  return {
    name: hit.name,
    country: hit.country_code || hit.country || '',
    admin: hit.admin1 || '',
    lat: hit.latitude,
    lon: hit.longitude,
    tz: hit.timezone || 'UTC',
  };
}

async function forecast(lat, lon, tz) {
  const { data } = await axiosWithBreaker('open-meteo-forecast', {
    method: 'GET',
    url: 'https://api.open-meteo.com/v1/forecast',
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: tz || 'auto',
      forecast_days: 3,
    },
    ...COMMON_AXIOS,
  });
  return data;
}

module.exports = {
  name: 'weather',
  alias: ['w', 'forecast'],
  desc: 'Current conditions and 3-day forecast for any city.',
  category: 'tools',
  type: 'tools',
  usage: '<city | "city, country" | lat,lon>',
  cooldown: 5,

  async start(sock, m, { ctx, text }) {
    const query = String(text || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!query) {
      return ctx.reply(
        '🌤️ *Weather*\n\n' +
          'Usage: `.weather <city>`\n\n' +
          'Examples:\n' +
          '• `.weather Mumbai`\n' +
          '• `.weather "San Francisco, US"`\n' +
          '• `.weather 51.5074,-0.1278`',
      );
    }

    await ctx.react('🌤️');

    let loc;
    const ll = query.match(LAT_LON_RE);
    if (ll) {
      loc = {
        name: `${parseFloat(ll[1]).toFixed(4)},${parseFloat(ll[2]).toFixed(4)}`,
        country: '',
        admin: '',
        lat: parseFloat(ll[1]),
        lon: parseFloat(ll[2]),
        tz: 'auto',
      };
    } else {
      try {
        loc = await geocode(query);
      } catch (err) {
        if (isOpenBreakerError(err)) {
          return ctx.reply('🌐 Geocoding service is having issues. Try again shortly.');
        }
        throw err;
      }
      if (!loc) {
        return ctx.reply(`❓ Couldn't find any location matching *${query}*.`);
      }
    }

    let f;
    try {
      f = await forecast(loc.lat, loc.lon, loc.tz);
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Forecast service is having issues. Try again shortly.');
      }
      throw err;
    }

    const cur = f.current || {};
    const daily = f.daily || {};
    const place = [loc.name, loc.admin, loc.country].filter(Boolean).join(', ');
    const wxNow = WMO[cur.weather_code] || `Code ${cur.weather_code}`;

    const lines = [
      `🌤️ *Weather — ${place}*`,
      '',
      `*Now:* ${wxNow}  ·  ${Math.round(cur.temperature_2m)}°C  ·  ` +
        `💧 ${cur.relative_humidity_2m}%  ·  💨 ${Math.round(cur.wind_speed_10m)} km/h`,
      '',
      '*Next 3 days:*',
    ];

    const days = daily.time || [];
    for (let i = 0; i < days.length; i++) {
      const code = daily.weather_code?.[i];
      const wxd = WMO[code] || `Code ${code}`;
      const hi = Math.round(daily.temperature_2m_max?.[i]);
      const lo = Math.round(daily.temperature_2m_min?.[i]);
      const pop = daily.precipitation_probability_max?.[i] ?? 0;
      lines.push(`• ${dayName(days[i])}  ${wxd}  ${lo}–${hi}°C  ☔ ${pop}%`);
    }

    lines.push('', '_Data: open-meteo.com_');
    return ctx.reply(lines.join('\n'));
  },
};
