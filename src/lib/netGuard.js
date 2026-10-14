/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * netGuard — SSRF protection for every place EchoFox fetches a URL that a
 * user supplied (directly or indirectly).
 *
 * Why this exists:
 *   `.rss add <url>` accepts any http(s) URL and genericRssService then
 *   fetches it *from the bot's own process* on a cron. Without a check, any
 *   user who can DM the bot can make it reach:
 *     • cloud metadata          http://169.254.169.254/…
 *     • the dashboard itself    http://127.0.0.1:3001/api/…
 *     • internal services       http://10.0.0.5:9200/…
 *   and — because parsed RSS items are delivered back to the subscriber —
 *   read the response, not just probe it.
 *
 *   src/services/ai/toolRegistry.js has a good deny-list for its `fetch_url`
 *   tool; this module is the shared, importable version so no other call
 *   site has to re-derive it.
 *
 * Usage:
 *   const { assertPublicUrl } = require('../lib/netGuard');
 *   await assertPublicUrl(userUrl);          // throws on private / unsafe
 */

const dns = require('node:dns').promises;
const net = require('node:net');

/** Parse an IPv4 dotted-quad into its 4 octets, or null. */
function _v4Octets(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

/**
 * Structural deny-list. Returns true when `host` is (or resolves inside)
 * a network the bot must never reach.
 *
 * Blocks:
 *   0.0.0.0/8         "this network"
 *   10.0.0.0/8        RFC 1918
 *   100.64.0.0/10     CGNAT (incl. some cloud task-metadata paths)
 *   127.0.0.0/8       loopback
 *   169.254.0.0/16    link-local — includes AWS/GCP/Azure 169.254.169.254
 *   172.16.0.0/12     RFC 1918
 *   192.0.0.0/24      IETF protocol assignments
 *   192.168.0.0/16    RFC 1918
 *   198.18.0.0/15     benchmarking
 *   ::1, fc00::/7, fe80::/10, IPv4-mapped IPv6 (::ffff:x.x.x.x)
 *   and the well-known local hostnames.
 */
function isPrivateHost(host) {
  if (!host || typeof host !== 'string') return true;
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, ''); // strip [ ] around v6

  if (h === 'localhost' || h === 'ip6-localhost' || h === 'ip6-loopback') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv4
  const v4 = _v4Octets(h);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6
  if (net.isIPv6(h)) {
    if (h === '::1' || h === '::') return true;
    if (h.startsWith('fe80')) return true; // link-local
    if (/^f[cd]/.test(h)) return true; // unique local fc00::/7
    // IPv4-mapped / -compatible forms, e.g. ::ffff:127.0.0.1
    const tail = h.split(':').pop();
    if (tail.includes('.')) return isPrivateHost(tail);
    return false;
  }

  return false; // a hostname — resolved by the caller
}

/**
 * Validate a user-supplied URL and (for hostnames) resolve it, re-checking
 * every returned address. Throws on anything unsafe.
 *
 * Resolving before the fetch closes the DNS-rebinding gap where a name
 * resolves to a public IP at check time and to 127.0.0.1 at fetch time.
 * It does not fully eliminate rebinding (the attacker can change the record
 * between our lookup and axios's), so callers should also cap redirects.
 *
 * @param {string} rawUrl
 * @returns {Promise<URL>} the parsed URL when safe
 */
async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    throw Object.assign(new Error('invalid_url'), { code: 'EINVALIDURL' });
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw Object.assign(new Error('bad_scheme'), { code: 'EBADSCHEME' });
  }
  if (!u.hostname) {
    throw Object.assign(new Error('no_host'), { code: 'ENOHOST' });
  }

  if (isPrivateHost(u.hostname)) {
    throw Object.assign(new Error('private_host_blocked'), { code: 'EPRIVATEHOST' });
  }

  // Literal IPs were fully checked above. Hostnames need resolution so we can
  // inspect the address(es) actually behind the name.
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) === 0) {
    let addrs;
    try {
      addrs = await dns.lookup(u.hostname, { all: true });
    } catch {
      // Fail OPEN on resolution failure, deliberately:
      //   • if we cannot resolve the name, axios cannot either, so the fetch
      //     will fail on its own — there is nothing to protect;
      //   • failing closed here would break offline installs, CI and
      //     split-horizon DNS for perfectly legitimate feeds;
      //   • it does not weaken the rebinding defence, because an attacker who
      //     controls DNS simply answers with a public address at check time
      //     and a private one at fetch time — a gap that only connection
      //     pinning (or the maxRedirects: 0 default) mitigates.
      return u;
    }
    if (addrs.some((a) => isPrivateHost(a.address))) {
      throw Object.assign(new Error('private_host_blocked'), { code: 'EPRIVATEHOST' });
    }
  }

  return u;
}

module.exports = { isPrivateHost, assertPublicUrl };
