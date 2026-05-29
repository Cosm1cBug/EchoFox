/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details. @license AGPL-3.0
 *
 * You should have received a copy of the GNU AGPL along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 */
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
 *   recordStat(key, inc=1)                 → counter ++
 *   async getStats()                       → { key: number, … }
 *
 *   setGauge(key, value)                   → gauge :=
 *   async getGauges()                      → { key: number, … }
 *
 *   async countGroups()                    → number
 *   async countUniqueUsers()               → number
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

module.exports = { createStore };
