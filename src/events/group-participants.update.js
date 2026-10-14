/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * group-participants.update handler.
 *
 *   Baileys emits a single event when any subset of participants in a
 *   group changes role. We:
 *     1. Record EACH (participant, action) pair as an append-only event
 *        in the store. Never deletes prior records.
 *     2. Classify raw `remove` into LEFT vs KICKED based on actor.
 *     3. Refresh the group metadata cache from authoritative source.
 *     4. Optionally post a one-liner to the configured groupUpdates channel.
 *
 *   The store interface (`recordParticipantEvent`) is implemented by all
 *   four backends (sqlite/postgres/mongo/redis) — see src/store/db.js.
 */

const { classifyAction, _participantId } = require('../store/schema/participants');
const { config } = require('../lib/configLoader');
const greetings = require('../services/greetingService');
const logger = require('../core/logger').child({ mod: 'gp.update' });

module.exports = async function onGroupParticipants({ sock, store, u }) {
  if (!u || !u.id || !Array.isArray(u.participants) || !u.participants.length) return;

  const { id: groupJid, participants, action: rawAction, author } = u;
  const ts = Math.floor(Date.now() / 1000);

  // ─── 0. Normalise participants to JID strings ──────────────────────
  // Baileys 7.x sends `GroupParticipant[]` = Contact & {admin}, i.e. OBJECTS
  // like { id, phoneNumber, admin }. This handler used to pass that object
  // straight into the store, where better-sqlite3 rejected the bind
  // ("Too few parameter values were provided"). The throw was caught and
  // logged at WARN, so the event table never received a row and the
  // dashboard's participant history was permanently empty. It also made
  // `classifyAction` compare a string to an object (always false → every
  // removal mislabelled as a kick) and made `participant.split('@')` throw.
  //
  // One normalisation here fixes all three.
  const people = participants
    .map((p) => ({
      id: _participantId(p),
      phoneNumber: typeof p === 'object' ? p?.phoneNumber || null : null,
      admin: typeof p === 'object' ? (p?.admin ?? null) : null,
    }))
    .filter((p) => !!p.id);

  // ─── 1. Record each (participant, classified action) into event log
  for (const person of people) {
    const action = classifyAction(rawAction, author, person.id);
    try {
      await store.recordParticipantEvent(groupJid, person.id, action, author || null, ts);
    } catch (e) {
      logger.warn(
        { err: e, groupJid, participant: person.id, action },
        'failed to record participant event',
      );
    }
  }

  // ─── 2. Refresh group metadata cache from server (best-effort)
  try {
    const fresh = await sock.groupMetadata(groupJid);
    await store.saveGroupMetadata(groupJid, fresh);
  } catch (e) {
    logger.debug({ err: e, groupJid }, 'group metadata refresh failed after participants update');
  }

  // ─── 3. Structured log + optional channel notification
  const classified = people.map((p) => ({
    // `participant` is deliberately the JID STRING — the dashboard's
    // HistoryTimeline, the channel notice and greetings all expect a string.
    participant: p.id,
    phoneNumber: p.phoneNumber,
    action: classifyAction(rawAction, author, p.id),
  }));
  logger.info(
    { groupJid, rawAction, author, classified, count: participants.length },
    'participants changed',
  );

  if (config.channels.groupUpdates) {
    const lines = classified
      .map(({ participant, action }) => {
        const verb =
          {
            add: '➕ added',
            join: '🚪 joined',
            leave: '👋 left',
            kick: '🚫 kicked',
            promote: '⭐ promoted',
            demote: '⬇️ demoted',
            approve: '✅ approved',
            reject: '❌ rejected',
            request: '📥 requested',
          }[action] || `(${action})`;
        const who = participant.split('@')[0];
        return `• ${verb} *${who}*${author && action === 'kick' ? ` (by ${author.split('@')[0]})` : ''}`;
      })
      .join('\n');

    sock
      .sendMessage(config.channels.groupUpdates, {
        text: `*${groupJid.split('@')[0]}* — participants updated\n${lines}`,
      })
      .catch((e) => logger.debug({ err: e }, 'failed to post groupUpdates notification'));
  }

  // ─── v1.7.0 — per-group welcome/goodbye dispatch ──────────────────
  await dispatchGreetings({ sock, groupJid, classified }).catch((e) =>
    logger.debug({ err: e, groupJid }, 'greeting dispatch failed'),
  );
};

async function dispatchGreetings({ sock, groupJid, classified }) {
  const cfg = await greetings.getConfig(groupJid);
  if (!cfg.welcomeEnabled && !cfg.goodbyeEnabled) return;

  // Best-effort: pull live group meta for name + count. Failure is non-fatal.
  let groupName = groupJid.split('@')[0];
  let count;
  try {
    const meta = await sock.groupMetadata(groupJid);
    groupName = meta?.subject || groupName;
    count = Array.isArray(meta?.participants) ? meta.participants.length : undefined;
  } catch (_e) {
    /* fall through with defaults */
  }

  for (const { participant, action } of classified) {
    const isWelcome = action === 'add' || action === 'join';
    const isGoodbye = action === 'leave' || action === 'kick';
    if (isWelcome && !cfg.welcomeEnabled) continue;
    if (isGoodbye && !cfg.goodbyeEnabled) continue;
    if (!isWelcome && !isGoodbye) continue;

    const tpl = isWelcome ? cfg.welcomeTemplate : cfg.goodbyeTemplate;
    const text = greetings.renderTemplate(tpl, {
      userJid: participant,
      groupName,
      count,
    });

    sock
      .sendMessage(groupJid, { text, mentions: [participant] })
      .catch((err) => logger.debug({ err, groupJid, participant, action }, 'greeting send failed'));
  }
}

/*
const logger = require('../core/logger').child({ mod: 'group-participants' });
const { getStore } = require('../store/instance');

// Simple concurrency limiter
async function runWithConcurrency(items, limit, fn) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        const result = await fn(items[currentIndex]);
        results[currentIndex] = result;
      } catch (err) {
        results[currentIndex] = err;
      }
    }
  }

  const workers = Array(Math.min(limit, items.length)).fill(null).map(worker);
  await Promise.all(workers);
  return results;
}

module.exports = async ({ sock, store, u }) => {
  if (!u) return;
  const currentStore = store || getStore();
  if (!currentStore?.recordParticipantEvent) return;

  const events = Array.isArray(u) ? u : [u];

  // Process with max 10 concurrent writes
  await runWithConcurrency(events, 10, async (update) => {
    try {
      await currentStore.recordParticipantEvent(
        update.id,
        update.participant,
        update.action,
        update.actor || null,
        update.timestamp || Math.floor(Date.now() / 1000)
      );
    } catch (err) {
      logger.warn({ err, group: update.id }, 'Failed to record participant event');
    }
  });
};
*/
