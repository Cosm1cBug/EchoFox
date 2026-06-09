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
const xml2js = require('xml2js');
const { config } = require('../lib/configLoader');
const { getStore } = require('../store/instance');
const logger = require('../core/logger').child({ mod: 'rss-service' });

const SERVICE = 'rss';
const CHECK_INTERVAL = config.apis?.rss?.checkIntervalMin || 30;
const MAX_ARTICLES   = config.apis?.rss?.maxArticlesPerFeed || 5;

const parser = new xml2js.Parser({ explicitArray: false });

function normaliseCategories(item) {
  let cats = [];
  if (Array.isArray(item.category)) cats = item.category;
  else if (typeof item.category === 'string') cats = [item.category];
  // Some feeds use <category term="..."> attribute (Atom)
  cats = cats.map((c) => (c && typeof c === 'object' ? (c._ || c.$?.term || '') : c));
  return cats.map((c) => String(c || '').trim().toLowerCase()).filter(Boolean);
}

async function fetchFeed(url) {
    try {
        const { data } = await axiosWithBreaker(`rss:${new URL(url).hostname}`, {
            method:       'GET',
            url,
            timeout:      15000,
            responseType: 'text',
            headers:      { 'User-Agent': 'EchoFox/1.0 (RSS subscription)' },
        });
        const result = await parser.parseStringPromise(data);
        // RSS 2.0
        let items = result?.rss?.channel?.item;
        // Atom
        if (!items) items = result?.feed?.entry;
        if (!items) return [];
        const arr = Array.isArray(items) ? items : [items];
        return arr.slice(0, MAX_ARTICLES).map((item) => ({
            title: item.title?._ || item.title || '(untitled)',
            link:  typeof item.link === 'string' ? item.link : (item.link?.$?.href || item.link?.[0]?.$?.href || item.guid?._ || item.guid || ''),
            pubDate: item.pubDate || item.published || item.updated || null,
            categories: normaliseCategories(item),
        })).filter((a) => a.link);
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
    try { return new URL(feedUrl).hostname.replace(/^www\./, ''); }
    catch { return 'rss'; }
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
      const feeds = (meta && Array.isArray(meta.feeds)) ? meta.feeds : [];
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