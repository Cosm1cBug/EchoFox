/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { axiosWithBreaker, isOpenBreakerError } = require('../lib/network');
// v1.5.0 security: migrated from xml2js (prototype pollution risk per CVE-2023-0842)
// to fast-xml-parser which doesn't materialise __proto__ keys from input.
const { XMLParser } = require('fast-xml-parser');
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false, // keep CDATA as strings, don't coerce
});
const config = require('../lib/configLoader').config;
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'thehackersnews-service' });

const THEHACKERSNEWS_RSS = 'https://feeds.feedburner.com/TheHackersNews';
const CHECK_INTERVAL = config.apis?.thehackersnews?.checkIntervalMin || 60;

async function fetchLatestArticles(limit = 5) {
  try {
    const { data } = await axiosWithBreaker('thehackersnews', {
      method: 'GET',
      url: THEHACKERSNEWS_RSS,
      timeout: 15000,
    });

    // fast-xml-parser is synchronous; no async needed
    const result = xmlParser.parse(data);

    const items = result?.rss?.channel?.item;
    if (!items) return [];

    const articles = Array.isArray(items) ? items : [items];

    return articles.slice(0, limit).map((item) => {
      // <category> can appear 0..N times in an RSS <item>; xml2js with
      // explicitArray:false collapses single-element occurrences to a
      // string and multi-element to an array. Normalise both.
      let categories = [];
      if (Array.isArray(item.category)) categories = item.category;
      else if (typeof item.category === 'string') categories = [item.category];
      categories = categories.map((c) => String(c).trim().toLowerCase()).filter(Boolean);

      return {
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        categories,
      };
    });
  } catch (err) {
    if (isOpenBreakerError(err)) {
      logger.warn('thehackersnews breaker open — skipping this cycle');
      return [];
    }
    logger.warn({ err: err.message }, 'fetchLatestArticles failed');
    return [];
  }
}

async function sendArticle(sock, jid, article) {
  try {
    await sock.sendMessage(jid, {
      text: `*${article.title}*\n\n${article.link}`,
    });
    logger.info({ jid, title: article.title }, 'Article sent successfully');
  } catch (err) {
    logger.error({ jid, title: article.title, err: err.message }, 'Failed to send article');
  }
}

/**
 * Return true if the article should be delivered to this subscriber.
 *   • If subscriber.meta.topics is empty / missing → match everything
 *   • Otherwise → OR-match: any article category in subscriber topics
 *   Topic comparison is case-insensitive.
 */
function matchesTopics(article, meta) {
  const topics = meta && Array.isArray(meta.topics) ? meta.topics : [];
  if (!topics.length) return true;
  if (!article.categories?.length) return false;
  const wanted = new Set(topics.map((t) => String(t).trim().toLowerCase()).filter(Boolean));
  return article.categories.some((c) => wanted.has(String(c).trim().toLowerCase()));
}

async function checkAndDeliver(sock) {
  try {
    const store = getStore();
    const subscribers = await store.getSubscribers('thehackersnews');
    if (!subscribers.length || !sock) return;

    const articles = await fetchLatestArticles(5);
    if (!articles.length) return;

    for (const subscriber of subscribers) {
      const { jid, meta } = subscriber;

      for (const article of articles) {
        if (!matchesTopics(article, meta)) continue;
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

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchLatestArticles, matchesTopics };
