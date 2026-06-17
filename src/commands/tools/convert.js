/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .convert <amount> <from> <to> — currency conversion.
 *
 *   .convert 100 usd inr
 *   .convert 49.95 eur gbp
 *   .convert 1 btc usd
 *
 * Uses https://api.frankfurter.dev (ECB-backed, free, no API key,
 * supports ~30 major currencies). For crypto we fall back to
 * https://api.coingecko.com (also free, no key, generous limits).
 *
 * Both endpoints are HTTPS public APIs — SSRF guard not tripped
 * (user input only feeds query params, never the URL host).
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');

const FIAT_RE = /^[a-zA-Z]{3}$/;
const CRYPTO_HINTS = new Set([
  'btc',
  'eth',
  'sol',
  'usdt',
  'usdc',
  'bnb',
  'xrp',
  'doge',
  'ada',
  'matic',
  'dot',
  'avax',
  'ltc',
  'trx',
  'shib',
  'link',
  'atom',
  'xlm',
]);
const MAX_AMOUNT = 1e12;

function isCrypto(code) {
  return CRYPTO_HINTS.has(code.toLowerCase());
}

// CoinGecko uses full coin-ids — map the common tickers.
const CG_ID = {
  btc: 'bitcoin',
  eth: 'ethereum',
  sol: 'solana',
  usdt: 'tether',
  usdc: 'usd-coin',
  bnb: 'binancecoin',
  xrp: 'ripple',
  doge: 'dogecoin',
  ada: 'cardano',
  matic: 'matic-network',
  dot: 'polkadot',
  avax: 'avalanche-2',
  ltc: 'litecoin',
  trx: 'tron',
  shib: 'shiba-inu',
  link: 'chainlink',
  atom: 'cosmos',
  xlm: 'stellar',
};

async function fiatRate(from, to) {
  const resp = await axiosWithBreaker('frankfurter', {
    method: 'GET',
    url: 'https://api.frankfurter.dev/v1/latest',
    params: { base: from.toUpperCase(), symbols: to.toUpperCase() },
    timeout: 8000,
    maxContentLength: 50_000,
    maxBodyLength: 50_000,
  });
  const r = resp?.data?.rates?.[to.toUpperCase()];
  if (typeof r !== 'number') return null;
  return r;
}

async function cryptoConvert(amount, from, to) {
  // CoinGecko simple/price: { <id>: { <vs>: number } }
  const fromCrypto = isCrypto(from);
  const toCrypto = isCrypto(to);
  if (fromCrypto && toCrypto) {
    // crypto→crypto: go through usd
    const aUsd = await cryptoConvert(1, from, 'usd');
    const bUsd = await cryptoConvert(1, to, 'usd');
    if (!aUsd || !bUsd) return null;
    return (amount * aUsd) / bUsd;
  }
  if (fromCrypto) {
    const cgId = CG_ID[from.toLowerCase()];
    if (!cgId) return null;
    const resp = await axiosWithBreaker('coingecko-price', {
      method: 'GET',
      url: 'https://api.coingecko.com/api/v3/simple/price',
      params: { ids: cgId, vs_currencies: to.toLowerCase() },
      timeout: 8000,
      maxContentLength: 50_000,
      maxBodyLength: 50_000,
    });
    const r = resp?.data?.[cgId]?.[to.toLowerCase()];
    if (typeof r !== 'number') return null;
    return amount * r;
  }
  if (toCrypto) {
    const cgId = CG_ID[to.toLowerCase()];
    if (!cgId) return null;
    const resp = await axiosWithBreaker('coingecko-price', {
      method: 'GET',
      url: 'https://api.coingecko.com/api/v3/simple/price',
      params: { ids: cgId, vs_currencies: from.toLowerCase() },
      timeout: 8000,
      maxContentLength: 50_000,
      maxBodyLength: 50_000,
    });
    const r = resp?.data?.[cgId]?.[from.toLowerCase()];
    if (typeof r !== 'number') return null;
    return amount / r;
  }
  return null;
}

module.exports = {
  name: 'convert',
  alias: ['cv', 'fx', 'currency'],
  desc: 'Currency conversion (fiat + crypto).',
  category: 'tools',
  type: 'tools',
  usage: '<amount> <from> <to>',
  cooldown: 5,

  async start(sock, m, { ctx, args }) {
    if (!args || args.length < 3) {
      return ctx.reply(
        '💱 *Currency convert*\n\n' +
          'Usage: `.convert <amount> <from> <to>`\n\n' +
          'Examples:\n' +
          '• `.convert 100 usd inr`\n' +
          '• `.convert 49.95 eur gbp`\n' +
          '• `.convert 1 btc usd`\n' +
          '• `.convert 250 eur eth`',
      );
    }

    const amount = parseFloat(args[0]);
    const from = String(args[1] || '').trim();
    const to = String(args[2] || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      return ctx.reply('❌ Amount must be a positive finite number.');
    }
    if (!FIAT_RE.test(from) || !FIAT_RE.test(to)) {
      return ctx.reply('❌ Currency codes must be 3 letters (e.g. USD, EUR, BTC).');
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      return ctx.reply(`💱 ${amount} ${from.toUpperCase()} = ${amount} ${to.toUpperCase()}`);
    }

    await ctx.react('💱');

    try {
      let result;
      if (isCrypto(from) || isCrypto(to)) {
        result = await cryptoConvert(amount, from, to);
      } else {
        const rate = await fiatRate(from, to);
        result = rate === null ? null : amount * rate;
      }

      if (result === null || !Number.isFinite(result)) {
        return ctx.reply(`❓ Couldn't convert *${from.toUpperCase()} → ${to.toUpperCase()}*.`);
      }

      // Pretty-print: 6 decimals for small results, 2 for larger.
      const formatted = result < 1 ? result.toFixed(6) : result.toFixed(2);
      return ctx.reply(`💱 *${amount} ${from.toUpperCase()}* = *${formatted} ${to.toUpperCase()}*`);
    } catch (err) {
      if (isOpenBreakerError(err)) {
        return ctx.reply('🌐 Currency service is having issues. Try again shortly.');
      }
      throw err;
    }
  },
};
