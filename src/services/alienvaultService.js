/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const axios = require('axios');
const config = require('../lib/configLoader').config;
const store = require('../store/db'); 

const ALIENVAULT_API = 'https://otx.alienvault.com/api/v1/pulses/subscribed';
const CHECK_INTERVAL = config.apis?.alienvault?.checkIntervalMin || 60;

async function fetchNewPulses(lastTs) {
  const { data } = await axios.get(ALIENVAULT_API, {
    headers: { 'X-OTX-API-KEY': config.apis.alienvault.apiKey },
    params: { modified_since: lastTs ? new Date(lastTs).toISOString() : undefined },
  });
  return data.results || [];
}

async function sendPulse(jid, pulse) {
  // TODO: integrate with whatsapp send + externalAdReply
  console.log(`[alienvault] would send to ${jid}: ${pulse.name}`);
}

async function checkAndDeliver() {
  const subscribers = await store.getSubscribers('alienvault');
  for (const { jid, last_seen_pulse_ts } of subscribers) {
    const pulses = await fetchNewPulses(last_seen_pulse_ts);
    if (!pulses.length) continue;

    const newTs = Math.max(...pulses.map(p => new Date(p.modified).getTime()));
    for (const p of pulses.slice(0, 5)) {
      await sendPulse(jid, p);
    }
    if (pulses.length > 5) {
      // digest message
    }
    await store.updateSubscriberTimestamp('alienvault', jid, newTs);
  }
}

// cron entry point (every CHECK_INTERVAL minutes)
module.exports = { checkAndDeliver, CHECK_INTERVAL };