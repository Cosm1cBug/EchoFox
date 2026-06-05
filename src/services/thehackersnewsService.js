/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const axios = require('axios');
const xml2js = require('xml2js');
const config = require('../lib/configLoader').config;
const store = require('../store/db');

const THEHACKERSNEWS_RSS = 'https://feeds.feedburner.com/TheHackersNews';
const CHECK_INTERVAL = config.apis?.thehackersnews?.checkIntervalMin || 60;

async function fetchLatestArticles(limit = 5) {
  try {
    const { data } = await axios.get(THEHACKERSNEWS_RSS, { timeout: 15000 });

    const parser = new xml2js.Parser({ explicitArray: false });
    const result = await parser.parseStringPromise(data);

    const items = result?.rss?.channel?.item;
    if (!items) return [];

    const articles = Array.isArray(items) ? items : [items];

    return articles.slice(0, limit).map(item => ({
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
    }));
  } catch (error) {
    console.error('[thehackersnews] Failed to fetch articles:', error.message);
    return [];
  }
}

async function sendArticle(jid, article) {
  const message = `*${article.title}*\n\n${article.link}`;
  console.log(`[thehackersnews] Sending to ${jid}: ${article.title}`);
  // TODO: Replace with actual WhatsApp sending logic
}

async function checkAndDeliver() {
  const subscribers = await store.getSubscribers('thehackersnews');
  if (!subscribers.length) return;

  const articles = await fetchLatestArticles(5);
  if (!articles.length) return;

  for (const subscriber of subscribers) {
    const { jid, last_seen_pulse_ts } = subscriber;

    const newArticles = !last_seen_pulse_ts
      ? articles
      : articles.filter(a => new Date(a.pubDate).getTime() > last_seen_pulse_ts);

    if (!newArticles.length) continue;

    const toSend = newArticles.slice(0, 3);

    for (const article of toSend) {
      await sendArticle(jid, article);
    }

    const latestTimestamp = new Date(articles[0].pubDate).getTime();
    await store.updateSubscriberTimestamp('thehackersnews', jid, latestTimestamp);
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL };