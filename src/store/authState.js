/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const { initAuthCreds } = require('@whiskeysockets/baileys');
const Redis = require('ioredis');

/**
 * High-performance Redis auth state using HSET.
 * Recommended for EchoFox (Redis-first architecture).
 *
 * Benefits:
 * - Uses a single Redis Hash per session (lower memory)
 * - Uses pipelines for bulk key updates
 * - Includes built-in session deletion helper
 *
 * @param {Object} options
 * @param {Object} options.redisOptions - ioredis connection options
 * @param {string} options.sessionId - Unique identifier for the session
 * @param {Function} [options.logger] - Logger function
 * @returns {Promise<{state: any, saveCreds: Function, redis: Redis, deleteSession: Function}>}
 */
async function useRedisAuthStateWithHSet({ redisOptions, sessionId, logger = console.log }) {
  if (!redisOptions || !sessionId) {
    throw new Error('useRedisAuthStateWithHSet requires redisOptions and sessionId');
  }

  const redis = new Redis(redisOptions);
  const hsetKey = `baileys:${sessionId}:auth`;

  // Load credentials
  let credsData;
  try {
    credsData = await redis.hget(hsetKey, 'creds');
  } catch (err) {
    logger.error({ err, sessionId }, '[authState] Failed to load creds from Redis');
    throw err;
  }

  const creds = credsData ? JSON.parse(credsData) : initAuthCreds();

  if (!credsData) {
    await redis.hset(hsetKey, 'creds', JSON.stringify(creds));
    logger.info(`[authState] Created new credentials for session: ${sessionId}`);
  }

  const saveCreds = async () => {
    try {
      await redis.hset(hsetKey, 'creds', JSON.stringify(creds));
    } catch (err) {
      logger.error({ err, sessionId }, '[authState] Failed to save creds');
      throw err;
    }
  };

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        const results = {};
        try {
          const pipeline = redis.pipeline();
          ids.forEach((id) => pipeline.hget(hsetKey, `keys:${type}:${id}`));
          const replies = await pipeline.exec();

          replies.forEach((reply, index) => {
            if (reply[1]) {
              results[ids[index]] = JSON.parse(reply[1]);
            }
          });
        } catch (err) {
          logger.warn({ err, sessionId, type }, '[authState] Failed to get keys');
        }
        return results;
      },

      set: async (data) => {
        try {
          const pipeline = redis.pipeline();
          for (const category in data) {
            for (const id in data[category]) {
              pipeline.hset(hsetKey, `keys:${category}:${id}`, JSON.stringify(data[category][id]));
            }
          }
          await pipeline.exec();
        } catch (err) {
          logger.error({ err, sessionId }, '[authState] Failed to set keys');
          throw err;
        }
      },
    },
  };

  const deleteSession = async () => {
    try {
      await redis.del(hsetKey);
      logger.info(`[authState] Deleted session: ${sessionId}`);
    } catch (err) {
      logger.error({ err, sessionId }, '[authState] Failed to delete session');
    }
  };

  // Graceful shutdown
  const close = () => redis.quit();

  return {
    state,
    saveCreds,
    redis,
    deleteSession,
    close,
  };
}

/**
 * Flexible auth state using Keyv (supports multiple backends).
 * Use this only if you need to support databases other than Redis.
 */
async function makeKeyvAuthState({ sessionId, store, logger = console.log }) {
  if (!sessionId || !store) {
    throw new Error('makeKeyvAuthState requires sessionId and store');
  }

  const credsKey = `baileys:${sessionId}:creds`;
  const keysKey = `baileys:${sessionId}:keys`;

  let creds = await store.get(credsKey);
  if (!creds) {
    creds = initAuthCreds();
    await store.set(credsKey, JSON.stringify(creds));
    logger.info(`[authState] Created new credentials for session: ${sessionId}`);
  } else {
    creds = JSON.parse(creds);
  }

  const keysData = await store.get(keysKey);
  const keys = keysData ? JSON.parse(keysData) : {};

  const saveCreds = async () => {
    await store.set(credsKey, JSON.stringify(creds));
  };

  const state = {
    creds,
    keys: {
      get(type, ids) {
        return ids.reduce((dict, id) => {
          const key = `${type}:${id}`;
          if (keys[key]) dict[id] = JSON.parse(keys[key]);
          return dict;
        }, {});
      },
      set: async (data) => {
        for (const category in data) {
          for (const id in data[category]) {
            keys[`${category}:${id}`] = JSON.stringify(data[category][id]);
          }
        }
        await store.set(keysKey, JSON.stringify(keys));
      },
    },
  };

  return { state, saveCreds, client: store };
}

module.exports = {
  useRedisAuthStateWithHSet,
  makeKeyvAuthState,
};
