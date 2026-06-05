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
const logger = require('../core/logger').child({ mod: 'thehackersnews-service' });

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
    logger.error({ err: error.message }, 'Failed to fetch articles');
    return [];
  }
}

async function sendArticle(sock, jid, article) {
  try {
    await sock.sendMessage(jid, {
      text: `*${article.title}*\n\n${article.link}`
    });
    logger.info({ jid, title: article.title }, 'Article sent successfully');
  } catch (err) {
    logger.error({ jid, title: article.title, err: err.message }, 'Failed to send article');
  }
}

async function checkAndDeliver(sock) {
  try {
    const subscribers = await store.getSubscribers('thehackersnews');
    if (!subscribers.length || !sock) return;

    const articles = await fetchLatestArticles(5);
    if (!articles.length) return;

    for (const subscriber of subscribers) {
      const { jid } = subscriber;

      for (const article of articles) {
        const alreadySent = await store.hasSentArticle('thehackersnews', jid, article.link);
        if (alreadySent) continue;

        await sendArticle(sock, jid, article);
        await store.recordSentArticle('thehackersnews', jid, article.link);
      }
    }
  } catch (err) {
    logger.error({ err }, 'checkAndDeliver failed');
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchLatestArticles };