/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

// Validate through the real loader without starting workers, sockets, or writing config.
const { config } = require('../src/lib/configLoader');
console.log(
  JSON.stringify(
    {
      valid: true,
      source: config.__meta.source,
      store: config.storeDB.type,
      auth: config.auth.method,
      dashboardEnabled: config.dashboard.enabled,
      aiEnabled: config.ai.enabled,
      telegramEnabled: config.telegram.enabled,
      storeMessageBodies: config.privacy.storeMessageBodies,
      configuredProviders: Object.fromEntries(
        Object.entries(config.ai.providers).map(([name, provider]) => [name, !!provider.apiKey]),
      ),
    },
    null,
    2,
  ),
);
