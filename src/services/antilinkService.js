/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * antilinkService — per-group antilink config + URL detection helper.
 *
 * Storage: existing service_subscribers.meta JSON column under the
 * synthetic service "antilink", keyed by group jid.
 *
 *   meta = {
 *     enabled:   bool,       // default false
 *     action:    'warn' | 'delete' | 'delete+warn'  // default 'delete+warn'
 *     whitelist: string[],   // case-insensitive host suffixes
 *   }
 *
 * Default whitelist is empty. Users can add hosts via the .antilink
 * command. WhatsApp's own URL fields (chat.whatsapp.com) are NEVER in
 * the default whitelist — admins must explicitly allow them if they want
 * to share group invites in-group.
 *
 * containsLink() and findFirstHost() are exported so the message handler
 * can do the per-message check cheaply (no I/O for the check itself).
 */

const { getStore } = require('../store/instance');

const SERVICE = 'antilink';
const MAX_WHITELIST = 50;
const DEFAULT_ACTION = 'delete+warn';
const VALID_ACTIONS = new Set(['warn', 'delete', 'delete+warn']);

// Conservative URL detector — explicit http/https scheme OR a www. prefix.
// Avoids false positives on lone tokens like "a.b" or "node.js" while still
// catching the cases groups actually care about (shareable URLs).
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>()"']+)/gi;

function containsLink(text) {
  if (!text || typeof text !== 'string') return false;
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}

function findFirstHost(text) {
  if (!text || typeof text !== 'string') return null;
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  if (!m) return null;
  try {
    const u = new URL(m[1].startsWith('http') ? m[1] : `http://${m[1]}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function isWhitelisted(host, whitelist) {
  if (!host) return false;
  const h = host.toLowerCase();
  return (whitelist || []).some((w) => {
    const ww = String(w).toLowerCase();
    return h === ww || h.endsWith('.' + ww);
  });
}

async function getConfig(groupJid) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, groupJid)) || {};
  return {
    enabled: !!meta.enabled,
    action: VALID_ACTIONS.has(meta.action) ? meta.action : DEFAULT_ACTION,
    whitelist: Array.isArray(meta.whitelist) ? meta.whitelist.slice(0, MAX_WHITELIST) : [],
  };
}

async function setConfig(groupJid, patch) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, groupJid)) || {};
  const next = { ...meta, ...patch };
  if (Array.isArray(next.whitelist)) next.whitelist = next.whitelist.slice(0, MAX_WHITELIST);
  await store.subscribe(SERVICE, groupJid).catch(() => {});
  await store.setSubscriberMeta(SERVICE, groupJid, next);
  return next;
}

async function addToWhitelist(groupJid, host) {
  const cfg = await getConfig(groupJid);
  const h = String(host || '')
    .toLowerCase()
    .trim();
  if (!h) throw new Error('host required');
  if (cfg.whitelist.includes(h)) return cfg.whitelist;
  if (cfg.whitelist.length >= MAX_WHITELIST) {
    throw new Error(`whitelist full (max ${MAX_WHITELIST})`);
  }
  const next = [...cfg.whitelist, h];
  await setConfig(groupJid, { whitelist: next });
  return next;
}

async function removeFromWhitelist(groupJid, host) {
  const cfg = await getConfig(groupJid);
  const h = String(host || '')
    .toLowerCase()
    .trim();
  const next = cfg.whitelist.filter((w) => w !== h);
  await setConfig(groupJid, { whitelist: next });
  return next;
}

module.exports = {
  SERVICE,
  DEFAULT_ACTION,
  VALID_ACTIONS,
  MAX_WHITELIST,
  containsLink,
  findFirstHost,
  isWhitelisted,
  getConfig,
  setConfig,
  addToWhitelist,
  removeFromWhitelist,
};
