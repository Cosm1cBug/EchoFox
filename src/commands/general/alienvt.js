/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .alienvault <indicator>
 *
 * Look up an IPv4 / domain / URL / file-hash in AlienVault OTX
 * (Open Threat Exchange). Returns reputation + pulse count + a list
 * of the top tags / industries.
 *
 *   • Requires `config.apis.alienvault.apiKey` — auto-disabled when empty.
 *   • Indicator type is auto-detected.
 *
 * Note: this is the *lookup* command. Pulse-subscription management
 * (subscribe / unsubscribe a chat to live OTX pulses) lives in
 * `src/lib/alienvault-pulse.js` and runs as a background service.
 */

const axios = require('axios');

const RE_IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const RE_HASH = /^[a-fA-F0-9]{32,64}$/;
const RE_URL  = /^https?:\/\//i;

function detect(input) {
  if (RE_IPV4.test(input)) return 'IPv4';
  if (RE_URL.test(input))  return 'url';
  if (RE_HASH.test(input)) return 'file';
  if (input.includes('.')) return 'domain';
  return null;
}

const SECTIONS = {
  IPv4:   'general',
  domain: 'general',
  url:    'general',
  file:   'general',
};

module.exports = {
  name: 'alienvault',
  alias: ['otx', 'pulse'],
  desc: 'Lookup IP / domain / URL / hash in AlienVault OTX',
  category: 'general',
  requires: ['apis.alienvault.apiKey'],
  cooldown: 5,

  async start(sock, m, { ctx, text, config }) {
    const target = (text || '').trim();
    if (!target) {
      return ctx.reply('Usage: `.alienvault <ip | domain | url | hash>`');
    }
    const kind = detect(target);
    if (!kind) {
      return ctx.reply(`Couldn't determine what *${target}* is.`);
    }

    await ctx.react('👽');

    const section = SECTIONS[kind];
    const url = `https://otx.alienvault.com/api/v1/indicators/${kind}/${encodeURIComponent(target)}/${section}`;

    let data;
    try {
      const r = await axios.get(url, {
        timeout: 12_000,
        headers: { 'X-OTX-API-KEY': config.apis.alienvault.apiKey },
        validateStatus: (s) => s < 500,
      });
      if (r.status === 404) {
        await ctx.react('🤷');
        return ctx.reply(`OTX has no record for *${target}*.`);
      }
      if (r.status === 401 || r.status === 403) return ctx.reply('🔑 Invalid OTX API key.');
      if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
      data = r.data;
    } catch (err) {
      throw new Error(`AlienVault lookup failed: ${err.message}`);
    }

    const pulseInfo = data.pulse_info || {};
    const pulses    = pulseInfo.pulses || [];
    const tags      = [...new Set(pulses.flatMap((p) => p.tags || []))].slice(0, 8);
    const industries = [...new Set(pulses.flatMap((p) => p.industries || []))].slice(0, 5);
    const families  = [...new Set(pulses.flatMap((p) => p.malware_families?.map((m) => m.display_name) || []))].slice(0, 5);
    const verdict =
      pulses.length >= 5 ? '🔴 *High threat*' :
      pulses.length >= 1 ? '🟡 *Some intel*' :
                           '🟢 *No pulses*';

    const lines = [
      `👽 *AlienVault OTX* — _${kind}_`,
      `*Target:* \`${target}\``,
      ``,
      `*Verdict:* ${verdict}`,
      `*Pulse count:* ${pulses.length}`,
    ];
    if (data.reputation !== undefined && data.reputation !== 0) lines.push(`*Reputation:* ${data.reputation}`);
    if (data.country_name)   lines.push(`*Country:* ${data.country_name}`);
    if (data.asn)            lines.push(`*ASN:* ${data.asn}`);
    if (tags.length)         lines.push(`*Tags:* ${tags.join(', ')}`);
    if (industries.length)   lines.push(`*Industries:* ${industries.join(', ')}`);
    if (families.length)     lines.push(`*Malware:* ${families.join(', ')}`);
    if (pulses.length) {
      lines.push('');
      lines.push('*Top pulses:*');
      pulses.slice(0, 3).forEach((p, i) => {
        lines.push(`  ${i + 1}. ${p.name} _(by ${p.author?.username || 'anon'})_`);
      });
    }
    lines.push('', `🔗 https://otx.alienvault.com/indicator/${kind}/${encodeURIComponent(target)}`);

    await ctx.reply(lines.join('\n'));
  },
};
