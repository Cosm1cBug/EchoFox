/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Baseline migration for the Redis store.
 *
 * Redis is schemaless — all keys are created on first write by
 * redisStore.js. This migration is a no-op that exists so the
 * `_migrations` ZSET has a v=0 marker from boot, keeping the tracking
 * scheme consistent across backends.
 *
 * If future changes require key renames or scan-based rewrites, add
 * them as 001_<slug>.js / 002_<slug>.js. They run sequentially via
 * `ctx.client` (an ioredis instance).
 */
module.exports = {
  version: 0,
  description: 'baseline — Redis is schemaless, no-op marker',

  async up(_ctx) {
    /* nothing to do */
  },
  async down(_ctx) {
    /* intentionally a no-op */
  },
};
