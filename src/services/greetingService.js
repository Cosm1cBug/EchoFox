/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * greetingService — per-group welcome/goodbye templates.
 *
 * Templates live in the existing service_subscribers.meta JSON column
 * under the synthetic service key "greetings", with the *group jid* as
 * the subscriber id (NOT a user jid). That keeps the data adjacent to
 * everything else we persist via the subscriber-meta abstraction with
 * no new migration.
 *
 *   meta = {
 *     welcomeEnabled: bool,
 *     welcomeTemplate: string,    // supports {user} {group} {count}
 *     goodbyeEnabled: bool,
 *     goodbyeTemplate: string,
 *   }
 *
 * Template variables expanded by renderTemplate():
 *   {user}    — @-mention of the affected participant
 *   {group}   — the group's subject (best-effort, falls back to '@<jid>')
 *   {count}   — current participant count
 *
 * Invoked from src/events/group-participants.update.js for the
 * 'add' / 'join' (welcome) and 'leave' / 'kick' (goodbye) classified
 * actions only.
 */

const { getStore } = require('../store/instance');

const SERVICE = 'greetings';
const MAX_TEMPLATE_CHARS = 1000;

const DEFAULT_WELCOME = '👋 Welcome to *{group}*, {user}! You are member #{count}.';
const DEFAULT_GOODBYE = '👋 {user} has left the group.';

async function getConfig(groupJid) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, groupJid)) || {};
  return {
    welcomeEnabled: !!meta.welcomeEnabled,
    welcomeTemplate: meta.welcomeTemplate || DEFAULT_WELCOME,
    goodbyeEnabled: !!meta.goodbyeEnabled,
    goodbyeTemplate: meta.goodbyeTemplate || DEFAULT_GOODBYE,
  };
}

async function setConfig(groupJid, patch) {
  const store = getStore();
  const meta = (await store.getSubscriberMeta(SERVICE, groupJid)) || {};
  const next = { ...meta, ...patch };
  await store.subscribe(SERVICE, groupJid).catch(() => {});
  await store.setSubscriberMeta(SERVICE, groupJid, next);
  return next;
}

function renderTemplate(tpl, { userJid, groupName, count }) {
  const userShort = (userJid || '').split('@')[0];
  return String(tpl || '')
    .replace(/\{user\}/g, `@${userShort}`)
    .replace(/\{group\}/g, groupName || 'this group')
    .replace(/\{count\}/g, String(count ?? '?'))
    .slice(0, 2000);
}

function validateTemplate(tpl) {
  if (typeof tpl !== 'string') return 'template must be a string';
  if (!tpl.trim()) return 'template must not be empty';
  if (tpl.length > MAX_TEMPLATE_CHARS) return `template too long (max ${MAX_TEMPLATE_CHARS} chars)`;
  return null;
}

module.exports = {
  SERVICE,
  DEFAULT_WELCOME,
  DEFAULT_GOODBYE,
  MAX_TEMPLATE_CHARS,
  getConfig,
  setConfig,
  renderTemplate,
  validateTemplate,
};
