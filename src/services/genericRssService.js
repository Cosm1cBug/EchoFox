/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Generic RSS / Atom subscription service.
 *
 *   Each .rss subscriber has meta = { feeds: [{ url, topics? }, ...] }
 *   On the configured cron, we iterate all subscribers, fetch each of
 *   their feeds, and deliver up to maxArticlesPerFeed new items that
 *   haven't been recorded in service_sent_items yet.
 *
 *   Topic filter (per-feed) matches against RSS <category> tags +
 *   <media:keywords> via OR-match (case-insensitive). Empty topics
 *   match every article.
 *
 *   Auth: none. URL fetched directly. Configure outbound proxy in
 *   config.network.* if you need to.
 */

const { axiosWithBreaker, isOpenBreakerError } = require('../lib/network');
// v1.5.0 security: migrated from xml2js (prototype pollution risk per CVE-2023-0842)
// to fast-xml-parser. Attribute prefix '@_' and text node '#text' replace
// xml2js' $ and _ conventions; normaliseCategories + extractLink handle both.
const { XMLParser } = require('fast-xml-parser');
const { config } = require('../lib/configLoader');
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'rss-service' });

const SERVICE = 'rss';
const CHECK_INTERVAL = config.apis?.rss?.checkIntervalMin || 30;
const MAX_ARTICLES = config.apis?.rss?.maxArticlesPerFeed || 5;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
});

// v1.5.0: extract a feed item's URL from BOTH xml2js and fast-xml-parser shapes.
//   RSS:   <link>https://...</link>            -> string
//   Atom:  <link href="https://..."/>          -> xml2js: { $: { href: ... } }
//                                                -> f-x-p: { @_href: ... }
//   Atom (multiple):                            -> array of the above
function _extractLink(item) {
  const l = item.link;
  if (!l) return item.guid?.['#text'] || item.guid?._ || item.guid || '';
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return _extractLink({ link: l[0] });
  if (typeof l === 'object') {
    return l['@_href'] || l['#text'] || (l.$ && l.$.href) || l._ || '';
  }
  return '';
}

function normaliseCategories(item) {
  let cats = [];
  if (Array.isArray(item.category)) cats = item.category;
  else if (typeof item.category === 'string') cats = [item.category];
  else if (item.category) cats = [item.category];
  // v1.5.0: handle BOTH xml2js shape ({_, $.term}) and fast-xml-parser shape
  // ({#text, @_term}) so the migration is safe even mid-deploy.
  cats = cats.map((c) => {
    if (c == null) return '';
    if (typeof c === 'string') return c;
    if (typeof c === 'object') {
      return c['#text'] || c._ || c['@_term'] || (c.$ && c.$.term) || '';
    }
    return String(c);
  });
  return cats
    .map((c) =>
      String(c || '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}

async function fetchFeed(url) {
  try {
    const { data } = await axiosWithBreaker(`rss:${new URL(url).hostname}`, {
      method: 'GET',
      url,
      timeout: 15000,
      responseType: 'text',
      headers: { 'User-Agent': 'EchoFox/1.0 (RSS subscription)' },
    });
    const result = parser.parse(data); // sync
    // RSS 2.0
    let items = result?.rss?.channel?.item;
    // Atom
    if (!items) items = result?.feed?.entry;
    if (!items) return [];
    const arr = Array.isArray(items) ? items : [items];
    return arr
      .slice(0, MAX_ARTICLES)
      .map((item) => ({
        title: (item.title && (item.title['#text'] || item.title._)) || item.title || '(untitled)',
        link: _extractLink(item),
        pubDate: item.pubDate || item.published || item.updated || null,
        categories: normaliseCategories(item),
      }))
      .filter((a) => a.link);
  } catch (err) {
    if (isOpenBreakerError(err)) {
      logger.warn({ url }, 'rss breaker open — skipping this cycle');
      return [];
    }
    logger.warn({ url, err: err.message }, 'rss fetch failed');
    return [];
  }
}

function matchesTopics(article, topics) {
  if (!topics || !topics.length) return true;
  if (!article.categories?.length) return false;
  const wanted = new Set(topics.map((t) => String(t).trim().toLowerCase()));
  return article.categories.some((c) => wanted.has(String(c).trim().toLowerCase()));
}

async function sendArticle(sock, jid, article, feedUrl) {
  const host = (() => {
    try {
      return new URL(feedUrl).hostname.replace(/^www\./, '');
    } catch {
      return 'rss';
    }
  })();
  try {
    await sock.sendMessage(jid, {
      text: `📰 *${article.title}*\n_via ${host}_\n\n${article.link}`,
    });
    logger.info({ jid, host, title: article.title }, 'rss article sent');
  } catch (err) {
    logger.warn({ jid, err: err.message }, 'sendArticle failed');
  }
}

async function checkAndDeliver(sock) {
  try {
    if (!sock) return;
    const store = getStore();
    const subscribers = await store.getSubscribers(SERVICE);
    if (!subscribers.length) return;

    for (const { jid, meta } of subscribers) {
      const feeds = meta && Array.isArray(meta.feeds) ? meta.feeds : [];
      for (const feed of feeds) {
        if (!feed?.url) continue;
        const articles = await fetchFeed(feed.url);
        for (const article of articles) {
          if (!matchesTopics(article, feed.topics)) continue;
          if (await store.hasSentItem(SERVICE, jid, article.link)) continue;
          await sendArticle(sock, jid, article, feed.url);
          await store.recordSentItem(SERVICE, jid, article.link);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'rss checkAndDeliver failed');
  }
}

module.exports = { checkAndDeliver, CHECK_INTERVAL, fetchFeed, matchesTopics, SERVICE };
