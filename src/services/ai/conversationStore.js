/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Thin facade over store.{appendAiTurn,getRecentAiTurns,clearAiTurns}
 * so the rest of the AI service doesn't have to know about the store
 * interface, and so we can degrade gracefully if the active store
 * flavour hasn't implemented the AI methods yet.
 */
const logger = require('../../core/logger').child({ mod: 'ai/mem' });
const { getStore } = require('../../store/instance');
const { canStoreAiMemory } = require('../../lib/privacyPolicy');

async function append(chatJid, turn) {
  if (!canStoreAiMemory(chatJid)) return false;
  try {
    const store = getStore();
    if (!store || typeof store.appendAiTurn !== 'function') return false;
    return await store.appendAiTurn(chatJid, { ...turn, ts: turn.ts || Date.now() });
  } catch (e) {
    logger.warn({ err: e, chatJid }, 'append failed');
    return false;
  }
}

async function recent(chatJid, limit = 20) {
  if (!canStoreAiMemory(chatJid) || Number(limit) <= 0) return [];
  try {
    const store = getStore();
    if (!store || typeof store.getRecentAiTurns !== 'function') return [];
    return await store.getRecentAiTurns(chatJid, Math.min(200, Math.max(0, Number(limit) || 0)));
  } catch (e) {
    logger.warn({ err: e, chatJid }, 'recent failed');
    return [];
  }
}

async function clear(chatJid) {
  try {
    const store = getStore();
    if (!store || typeof store.clearAiTurns !== 'function') return false;
    return await store.clearAiTurns(chatJid);
  } catch (e) {
    logger.warn({ err: e, chatJid }, 'clear failed');
    return false;
  }
}

module.exports = { append, recent, clear };
