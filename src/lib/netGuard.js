/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');
const ipaddr = require('ipaddr.js');

const hostname = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
const failure = (message, code = 'EPRIVATE') => Object.assign(new Error(message), { code });

function isPrivateHost(value) {
  const host = hostname(value);
  if (!host || host === 'localhost' || /\.(?:localhost|local|internal|corp|lan)$/.test(host))
    return true;
  // ipaddr.process also normalizes dotted AND hexadecimal IPv4-mapped IPv6.
  if (ipaddr.isValid(host)) return ipaddr.process(host).range() !== 'unicast';
  // Malformed IP literals must not fall through to DNS interpretation.
  return host.includes(':') || /^[\d.]+$/.test(host) || host.includes('%');
}

/** Validate every DNS answer, then return a lookup bound to those exact answers.
 * A preflight followed by ordinary DNS lookup is NOT a rebinding defense.
 * The injectable resolver is for deterministic, offline policy tests.
 */
async function resolvePublicUrl(rawUrl, { lookup = dns.lookup, dnsTimeoutMs = 5000 } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw failure('Invalid URL', 'EBADURL');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw failure('Only HTTP(S) URLs are allowed', 'EBADSCHEME');
  if (url.username || url.password)
    throw failure('URL credentials are not allowed', 'EBADCREDENTIALS');
  const host = hostname(url.hostname);
  if (isPrivateHost(host)) throw failure('Blocked non-public host');

  let addresses;
  const family = net.isIP(host);
  if (family) {
    addresses = [{ address: host, family }];
  } else {
    let timer;
    try {
      addresses = await Promise.race([
        lookup(host, { all: true, verbatim: true }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(failure('DNS lookup timed out', 'EDNS')), dnsTimeoutMs);
        }),
      ]);
    } catch {
      throw failure('DNS resolution failed; request denied', 'EDNS');
    } finally {
      clearTimeout(timer);
    }
  }
  if (!Array.isArray(addresses) || !addresses.length)
    throw failure('DNS returned no addresses', 'EDNS');
  addresses = addresses.map(({ address, family: resolvedFamily }) => ({
    address,
    family: Number(resolvedFamily),
  }));
  if (
    addresses.some(
      (answer) =>
        !net.isIP(answer.address) ||
        net.isIP(answer.address) !== answer.family ||
        isPrivateHost(answer.address),
    )
  ) {
    throw failure('DNS resolved to a non-public address');
  }

  function pinnedLookup(requestHost, options, callback) {
    if (typeof options === 'function') [callback, options] = [options, {}];
    options = typeof options === 'number' ? { family: options } : options || {};
    if (hostname(requestHost) !== host)
      return callback(failure('Unexpected connection hostname', 'EDNS'));
    const candidates = addresses.filter(
      (answer) => !options.family || options.family === answer.family,
    );
    if (!candidates.length)
      return callback(failure('No validated address for requested family', 'EDNS'));
    if (options.all)
      return callback(
        null,
        candidates.map((answer) => ({ ...answer })),
      );
    callback(null, candidates[0].address, candidates[0].family);
  }
  return { url, addresses, lookup: pinnedLookup };
}

async function assertPublicUrl(rawUrl, options) {
  return (await resolvePublicUrl(rawUrl, options)).url;
}

module.exports = { assertPublicUrl, resolvePublicUrl, isPrivateHost };
