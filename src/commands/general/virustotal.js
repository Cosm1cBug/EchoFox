/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .virustotal <ip|domain|url|hash>
 *
 * Look up an IP / domain / URL / file-hash on VirusTotal v3.
 *   • Auto-detects which of the 4 input types you passed.
 *   • Requires `config.apis.virustotal.apiKey` — auto-disables if empty.
 *   • Soft-fails to a single readable summary line; full JSON is logged
 *     so you can grep production for raw responses.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../../lib/network');
const crypto = require('node:crypto');

const RE_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const RE_HASH = /^[a-fA-F0-9]{32}(?:[a-fA-F0-9]{8})?(?:[a-fA-F0-9]{24})?$/;
const RE_URL  = /^https?:\/\//i;

function detectType(input) {
  if (RE_IPV4.test(input))  return 'ip_addresses';
  if (RE_URL.test(input))   return 'urls';
  if (RE_HASH.test(input))  return 'files';
  // Anything else with a dot we treat as a domain
  if (input.includes('.'))  return 'domains';
  return null;
}

// Per VirusTotal docs, URL IDs are url-safe-base64 of the URL itself.
function urlId(url) {
  return Buffer.from(url).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

module.exports = {
  name: 'virustotal',
  alias: ['vt'],
  desc: 'Lookup IP / domain / URL / hash on VirusTotal',
  category: 'general',
  requires: ['apis.virustotal.apiKey'],
  cooldown: 5,

  async start(sock, m, { ctx, text, config }) {
    const target = (text || '').trim();
    if (!target) return ctx.reply('Usage: `.virustotal <ip | domain | url | sha256>`');

    const type = detectType(target);
    if (!type) return ctx.reply(`Couldn't determine what *${target}* is. Pass an IP, domain, URL, or hash.`);

    await ctx.react('🛡️');

    const id = type === 'urls' ? urlId(target) : target;
    const url = `https://www.virustotal.com/api/v3/${type}/${encodeURIComponent(id)}`;

    let data;
    try {
      const r = await axiosWithBreaker('virustotal', {
        method:  'GET',
        url,
        timeout: 12_000,
        headers: {
          accept:     'application/json',
          'x-apikey': config.apis.virustotal.apiKey,
        },
        validateStatus: (s) => s < 500,
      });
      if (r.status === 404) {
        await ctx.react('🤷');
        return ctx.reply(`VirusTotal has no record for *${target}*.`);
      }
      if (r.status === 401) return ctx.reply('🔑 Invalid VirusTotal API key.');
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      data = r.data;
    } catch (err) {
      if (isOpenBreakerError(err)) {
        throw new Error('⏱️ VirusTotal is currently overloaded. Try again in ~1 minute.');
      }
      throw new Error(`VirusTotal request failed: ${err.message}`);
    }

    const a    = data?.data?.attributes || {};
    const last = a.last_analysis_stats || {};
    const total = (last.harmless || 0) + (last.malicious || 0) +
                  (last.suspicious || 0) + (last.undetected || 0);
    const verdict =
      (last.malicious || 0) >= 3  ? '🔴 *MALICIOUS*' :
      (last.malicious || 0) >= 1  ? '🟠 *Suspicious*' :
      (last.suspicious || 0) >= 1 ? '🟡 *Some flags*' :
                                    '🟢 *Clean*';

    const lines = [
      `🛡️ *VirusTotal* — _${type.replace('_', ' ').slice(0, -1)}_`,
      `*Target:* \`${target}\``,
      ``,
      `*Verdict:* ${verdict}`,
      `*Detections:* ${last.malicious || 0} malicious · ${last.suspicious || 0} suspicious · ${last.harmless || 0} harmless · ${last.undetected || 0} undetected  (of ${total})`,
    ];
    if (a.reputation !== undefined) lines.push(`*Reputation:* ${a.reputation}`);
    if (a.country)                 lines.push(`*Country:* ${a.country}`);
    if (a.as_owner)                lines.push(`*ASN:* ${a.as_owner}`);
    if (a.tags?.length)            lines.push(`*Tags:* ${a.tags.slice(0, 8).join(', ')}`);
    lines.push('', `🔗 https://www.virustotal.com/gui/${type === 'ip_addresses' ? 'ip-address' : type.slice(0, -1)}/${id}`);

    await ctx.reply(lines.join('\n'));
  },
};
