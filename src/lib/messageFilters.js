/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * messageFilters — shared predicates for deciding what counts as human
 * activity in a chat.
 *
 * Why this exists:
 *   The dashboard's "active / inactive" flag is derived from
 *   `SELECT MAX(ts) FROM messages WHERE jid = ? AND from_me = 0`.
 *   `from_me = 0` only means "not sent by this bot" — it does NOT mean
 *   "sent by a human". Protocol traffic, key distributions, reactions and
 *   poll votes all arrive as ordinary inbound messages and were keeping
 *   dormant groups pinned to "active" on the Groups tab.
 *
 * Field names below are verified against proto.Message.prototype in the
 * installed @whiskeysockets/baileys (87 fields).
 */

/**
 * Content types that are NOT evidence of conversation.
 *
 * Deliberately excluded from this list:
 *   - messageContextInfo: a *companion* field WhatsApp attaches to ordinary
 *     messages too (a message can carry both `conversation` and
 *     `messageContextInfo`), so treating it as a non-human marker would
 *     silently drop real messages from the store.
 *   - messageStubType: a top-level WAMessage field, not a Message field. It
 *     is already skipped because those events carry no `m.message`.
 */
const NON_HUMAN_CONTENT = new Set([
  'protocolMessage', // edits, deletes, app-state sync, LID migration…
  'senderKeyDistributionMessage',
  'reactionMessage',
  'pollUpdateMessage', // a vote, not conversation
  'keepInChatMessage',
]);

/** true when `message` should NOT be treated as human activity. */
function isNonHumanContent(message) {
  if (!message) return true;
  for (const key of NON_HUMAN_CONTENT) {
    if (message[key]) return true;
  }
  return false;
}

/**
 * Normalise a Baileys messageTimestamp to whole seconds.
 *
 * `messageTimestamp` is a protobuf Long on inbound messages — `Number()`
 * works (long.js defines valueOf) but history-sync and hand-built messages
 * have been observed carrying milliseconds. The `messages.ts` column feeds
 * MAX(ts) comparisons against `Date.now()/1000`, so a stray millisecond
 * value would pin a chat as active for ~50,000 years.
 */
function normaliseTs(messageTimestamp, nowSec = Math.floor(Date.now() / 1000)) {
  let ts = Number(messageTimestamp) || nowSec;
  if (ts > 10_000_000_000) ts = Math.floor(ts / 1000); // ms -> s
  return ts;
}

module.exports = { isNonHumanContent, normaliseTs, NON_HUMAN_CONTENT };
