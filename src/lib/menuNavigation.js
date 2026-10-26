/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

// Native-flow replies are untrusted input. IDs describe menu navigation only;
// never turn an arbitrary paramsJson.id or display label into a command.
const MENU_STYLES = Object.freeze(['carousel', 'thumbnail', 'list']);
const MENU_CATEGORIES = Object.freeze([
  'ai',
  'media',
  'tools',
  'feeds',
  'group',
  'user',
  'admin',
  'other',
]);
const TARGETS = new Set(['home', 'all', ...MENU_CATEGORIES]);
const ID_PREFIX = 'echofox-menu:';

function validPrefix(prefix) {
  return (
    typeof prefix === 'string' &&
    prefix.length > 0 &&
    prefix.length <= 32 &&
    ![...prefix].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
  );
}

function makeMenuSelection(prefix, style, target = 'home', page = 1) {
  if (
    !validPrefix(prefix) ||
    !MENU_STYLES.includes(style) ||
    !TARGETS.has(target) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 9999 ||
    (target === 'home' && page !== 1)
  ) {
    throw new TypeError('Invalid menu navigation');
  }
  return `${ID_PREFIX}v1:${encodeURIComponent(prefix)}:${style}:${target}:${page}`;
}

/**
 * Decode navigation syntax, or null for invalid/unrelated IDs. The caller must
 * re-match the encoded prefix against its real configuration and require that
 * the command is still `menu` (see messages.upsert.js), not trust that prefix.
 */
function readMenuSelection(id) {
  if (typeof id !== 'string' || id.length > 512) return null;
  const parts = id.split(':');
  if (parts.length !== 6 || parts[0] !== 'echofox-menu' || parts[1] !== 'v1') return null;
  const [, , encodedPrefix, style, target, pageText] = parts;
  if (!/^[1-9]\d{0,3}$/.test(pageText)) return null;

  let prefix;
  try {
    prefix = decodeURIComponent(encodedPrefix);
  } catch (_) {
    return null;
  }
  if (
    !validPrefix(prefix) ||
    !MENU_STYLES.includes(style) ||
    !TARGETS.has(target) ||
    (target === 'home' && pageText !== '1')
  ) {
    return null;
  }
  const route = target === 'home' ? style : `${style} ${target} ${pageText}`;
  return `${prefix}menu ${route}`;
}

function readNativeMenuResponse(response) {
  if (
    !response ||
    !['single_select', 'quick_reply'].includes(response.name) ||
    typeof response.paramsJson !== 'string' ||
    response.paramsJson.length > 4096
  ) {
    return '';
  }
  try {
    const params = JSON.parse(response.paramsJson);
    if (!params || typeof params !== 'object' || Array.isArray(params)) return '';
    return readMenuSelection(params.id) || '';
  } catch (_) {
    return '';
  }
}

module.exports = {
  MENU_STYLES,
  MENU_CATEGORIES,
  ID_PREFIX,
  makeMenuSelection,
  readMenuSelection,
  readNativeMenuResponse,
};
