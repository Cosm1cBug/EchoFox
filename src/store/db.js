/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Store backend factory. All backends honour the same interface:
 *
 *   async getMessage(key)                  → proto.IMessage | undefined
 *   async getGroupMetadata(jid)            → GroupMetadata | undefined
 *   async saveGroupMetadata(jid, meta)     → void
 *
 *   async recordParticipantEvent(group, participant, action, actor, ts?)
 *   async getParticipantHistory(group, limit=500) → [{participant, action, actor, ts}]
 *   async getCurrentParticipants(group)    → [{participant, last_action, last_ts}]
 *
 *   async recordMessageEdit(jid, msgId, editor, oldBody, newBody, ts)
 *   async getMessageEdits(jid, msgId)      → [{editor, old_body, new_body, ts}]
 *   async updateMessageBody(jid, msgId, message, ts)
 *
 *   async recordMessageReaction(jid, msgId, reactor, emoji, ts)
 *   async getMessageReactions(jid, msgId)  → [{reactor, emoji, ts}]
 *
 *   async recordReceipt(jid, msgId, recipient, status, ts)
 *   async getMessageReceipts(jid, msgId)   → [{recipient, status, ts}]
 *
 *   async markMessageDeleted(jid, msgId, by, ts)
 *   async markChatMessagesDeleted(jid, ts)
 *   async getDeletedInGroup(jid, limit=100) → [{id, participant, deleted_at}]
 *
 *   async updateMessageStatus(jid, msgId, status, ts)    // 1=sent .. 4=played
 *
 *   recordStat(key, inc=1)                 → counter ++
 *   async getStats()                       → { key: number, … }
 *
 *   setGauge(key, value)                   → gauge :=
 *   async getGauges()                      → { key: number, … }
 *
 *   async countGroups()                    → number
 *   async countUniqueUsers()               → number
 *   async listGroups()                     → [{jid, subject, participantCount}]
 *
 *   bind(ev)                               → wire to Baileys ev emitter
 *   close()
 *
 * If you add a 5th backend, implement every method above so the typed
 * metrics service and dashboard work without conditional checks.
 */

const { makeSQLiteStore }   = require('./sqliteStore');
const { makePostgresStore } = require('./postgresStore');
const { makeMongoStore }    = require('./mongoStore');
const { makeRedisStore }    = require('./redisStore');

function createStore(config, logger, groupCache) {
  const type = (config.storeDB.type || 'SQLITE').toUpperCase();

  switch (type) {
    case 'POSTGRES':
      return makePostgresStore(config.storeDB.postgresUrl, logger, groupCache);
    case 'MONGODB':
      return makeMongoStore(config.storeDB.mongoUri, logger, groupCache);
    case 'REDIS':
      return makeRedisStore(config.storeDB.redisUrl, logger, groupCache);
    case 'SQLITE':
    default:
      return makeSQLiteStore({
        dbPath: config.storeDB.sqlitePath || './src/store/runtime/wa.db',
        logger,
        groupCache,
      });
  }
}

module.exports = { createStore }; *   async getSubscribers(service)          → [{jid, last_seen_pulse_ts}]