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

/*

Updated code using fast-xml-parser

'use strict';

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const config = require('../lib/configLoader').config;
const store = require('../store/db');
const logger = require('../core/logger').child({ mod: 'thehackersnews-service' });

const THEHACKERSNEWS_RSS = 'https://feeds.feedburner.com/TheHackersNews';
const CHECK_INTERVAL = config.apis?.thehackersnews?.checkIntervalMin || 60;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

async function fetchLatestArticles(limit = 5) {
  try {
    const { data } = await axios.get(THEHACKERSNEWS_RSS, {
      timeout: 15000,
      responseType: 'text',
    });

    const result = parser.parse(data);

    const items = result?.rss?.channel?.item;

    if (!items) {
      logger.warn('No articles found in RSS feed');
      return [];
    }

    const articles = Array.isArray(items) ? items : [items];

    return articles.slice(0, limit).map(item => ({
      guid: typeof item.guid === 'object'
        ? item.guid['#text'] || item.link
        : item.guid || item.link,

      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      description: item.description || '',
      author: item.author || '',

      image:
        item.enclosure?.['@_url'] ||
        item['media:content']?.['@_url'] ||
        null,
    }));
  } catch (error) {
    logger.error(
      {
        err: error.message,
        stack: error.stack,
      },
      'Failed to fetch articles from The Hacker News RSS'
    );

    return [];
  }
}

module.exports = {
  fetchLatestArticles,
  CHECK_INTERVAL,
};
*/