/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { axiosWithBreaker, isOpenBreakerError } = require('../lib/network');
const { config } = require('../lib/configLoader');
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'alienvault-service' });

const ALIENVAULT_API = 'https://otx.alienvault.com/api/v1/pulses/subscribed';
const CHECK_INTERVAL = config.apis?.alienvault?.checkIntervalMin || 60;

async function fetchNewPulses(lastTs) {
  try {
    const apiKey = config.apis?.alienvault?.apiKey;
    if (!apiKey) {
      logger.warn('alienvault apiKey not configured; skipping fetch');
      return [];
    }

    const { data } = await axiosWithBreaker('alienvault', {
      method:  'GET',
      url:     ALIENVAULT_API,
      headers: { 'X-OTX-API-KEY': apiKey },
      params:  { modified_since: lastTs ? new Date(lastTs).toISOString() : undefined },
      timeout: 15000,
    });

    return data?.results || [];
  } catch (err) {
    if (isOpenBreakerError(err)) {
      logger.warn('alienvault breaker open — skipping this cycle');
      return [];
    }
    logger.error({ err: err.message }, 'fetchNewPulses failed');
    return [];
  }
}

function formatPulse(pulse) {
  const name   = pulse.name || '(unnamed pulse)';
  const author = pulse.author_name ? `by ${pulse.author_name}` : '';
  const tlp    = pulse.tlp ? `TLP: ${pulse.tlp.toUpperCase()}` : '';
  const tags   = (pulse.tags || []).slice(0, 6).map((t) => `#${t}`).join(' ');
  const descr  = (pulse.description || '').trim().slice(0, 600);
  const iocs   = Array.isArray(pulse.indicators) ? pulse.indicators.length : 0;
  const link   = pulse.id ? `https://otx.alienvault.com/pulse/${pulse.id}` : '';

  return [
    `🛡️ *${name}*`,
    [author, tlp].filter(Boolean).join('  •  '),
    descr ? `\n${descr}${descr.length === 600 ? '…' : ''}` : '',
    tags ? `\n${tags}` : '',
    `\nIOCs: ${iocs}`,
    link ? `\n${link}` : '',
  ].filter(Boolean).join('\n');
}

async function sendPulse(sock, jid, pulse) {
  try {
    await sock.sendMessage(jid, { text: formatPulse(pulse) });
    logger.info({ jid, pulse: pulse.id || pulse.name }, 'pulse sent');
  } catch (err) {
    logger.error(
      { jid, pulse: pulse.id || pulse.name, err: err.message },
      'sendPulse failed',
    );
  }
}

async function checkAndDeliver(sock) {
  try {
    if (!sock) return;
    const store = getStore();

    const subscribers = await store.getSubscribers('alienvault');
    if (!subscribers.length) return;

    for (const { jid, last_seen_pulse_ts } of subscribers) {
      const pulses = await fetchNewPulses(last_seen_pulse_ts);
      if (!pulses.length) continue;

      const newTs = Math.max(
        ...pulses.map((p) => new Date(p.modified || p.created || Date.now()).getTime()),
      );

      // Batch up to 5 pulses per subscriber per run; older ones are
      // implicitly skipped on the next run via newTs watermark.
      for (const p of pulses.slice(0, 5)) {
        await sendPulse(sock, jid, p);
      }

      if (pulses.length > 5) {
        await sock.sendMessage(jid, {
          text: `ℹ️ +${pulses.length - 5} more pulses since last check (skipped to avoid flooding).`,
        }).catch(() => {});
      }

      await store.updateSubscriberTimestamp('alienvault', jid, newTs);
    }
  } catch (err) {
    logger.error({ err }, 'checkAndDeliver failed');
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchNewPulses, formatPulse };