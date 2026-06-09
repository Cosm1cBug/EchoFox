/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * EchoFox configuration template (v1.0.0).
 *
 *   1. Copy this file:   cp src/config.example.js src/config.js
 *   2. Edit src/config.js with your values (it's gitignored — safe).
 *   3. Optionally override any field with an environment variable:
 *        ECHOFOX_<SECTION>_<CAMELCASEKEY>=value
 *      e.g.   ECHOFOX_APIS_OMDB_APIKEY=abc123
 *             ECHOFOX_BOT_PREFIX=!
 *             ECHOFOX_STOREDB_TYPE=POSTGRES
 *             ECHOFOX_DASHBOARD_ENABLED=true
 *
 * Every field below is consumed by at least one runtime path.
 * Optional/future sections (i18n, webhooks, ai, telegram, schedules,
 * groupSettings, store, metrics) are still defined in configSchema.js
 * with sensible defaults — add them to your config.js only if/when
 * the corresponding feature ships.
 */
module.exports = {

  // ═══ Core ═════════════════════════════════════════════════════════════

  bot: {
    name:         'EchoFox',
    prefix:       '.',                    // user commands
    adminPrefix:  '$',                    // admin commands
    sessionName:  '@session',
    timezone:     'Asia/Kolkata',
    language:     'en',
    public:       true,                   // false = admin-only mode
  },

  features: {
    readMessages: true,
    readStatus:   true,
    reactStatus:  false,
    antiCall:     false,
    syncHistory:  true,
  },

  login: {
    type:        'QR',                    // 'QR' or 'PAIRING'
    phoneNumber: '',                      // required when type = 'PAIRING' (digits only)
  },

  auth: {
    method:      'MULTIFILE',             // 'MULTIFILE' | 'REDIS' | 'SQLITE' | 'POSTGRES'
    redisUrl:    'redis://localhost:6379',
    sqlitePath:  './src/store/auth.db',
    postgresUrl: 'postgresql://postgres:postgres@localhost:5432/echofox',
  },

  storeDB: {
    type:        'SQLITE',                // 'SQLITE' | 'POSTGRES' | 'MONGODB' | 'REDIS'
    sqlitePath:  './src/store/runtime/wa.db',
    postgresUrl: 'postgresql://postgres:postgres@localhost:5432/echofox',
    mongoUri:    'mongodb://localhost:27017/echofox',
    redisUrl:    'redis://localhost:6379',
    runMigrationsOnBoot: true,
  },

  dashboard: {
    enabled:  false,                      // basic-auth React dashboard at /dashboard/
    port:     3001,
    username: 'admin',
    password: 'change-me-please',
  },

  processing: {
    concurrencyPerChat: 1,
    globalRateLimit:    20,
    userRateLimit:      10,
    sendConcurrency:    4,
    messageBatch: {
      maxBatch:      100,
      maxWaitMs:     250,
      maxBufferSize: 5000,
    },
  },

  // ═══ Anti-ban (human-like presence + ban-mitigation) ══════════════════

  antiBan: {
    typingIndicator: true,
    shortReplyChars: 40,
    pauseAfterSend:  true,
    typingDelayMs:   { min: 800, max: 2500 },
    presenceOnConnect: 'available',
    warmupMode:        false,
    warmupDays:        14,
    warmupMultiplier:  3,
  },

  admins: [
    // '1234567890@s.whatsapp.net',
  ],

  channels: {
    syslogs:      '',
    botLogs:      '',
    userLogs:     '',
    groupUpdates: '',
    callLogs:     '',
    errLogs:      '',
    movGroup:     '',
  },

  apis: {
    omdb:           { apiKey: '', url: 'https://www.omdbapi.com/' },
    virustotal:     { apiKey: '' },
    alienvault:     { apiKey: '' },
    thehackersnews: { checkIntervalMin: 60 },
  },

  sticker: {
    packName:   'EchoFox',
    packAuthor: 'COSM1CBUG',
  },

  // ═══ Runtime ═══════════════════════════════════════════════════════════

  runtime: {
    logLevel:        'info',              // trace|debug|info|warn|error|fatal
    maxHeapPercent:  90,                  // restart worker above this heap %
    autoRestart:     false,                // false = only alert, no exit
    checkIntervalMs: 30000,
    gracePeriodMs:   5000,                // delay before restart (drains in-flight)
    logFile: {
      enabled: false,                     // also write JSON logs to file
      dir:     './logs',
      prefix:  'echofox',                 // → ./logs/echofox-YYYY-MM-DD.log
    },

    // v1.0.0 — leak detector. Set enabled:false to disable.
    leakDetection: {
      enabled: true,
      sampleIntervalMs: 600000,           // 10 minutes
      windowSize: 144,                    // 24h at 10min/sample
      growthThresholdPercent: 30,         // trigger if last-half MIN exceeds first-half MAX by N%
    },
  },

  // ═══ Networking ════════════════════════════════════════════════════════

  network: {
    httpProxy:    '',
    httpsProxy:   '',
    socksProxy:   '',
    noProxy:      [],
    fetchTimeoutMs:  30000,
    extraCaCertPath: '',
    userAgent: 'EchoFox/1.0 (+https://github.com/Cosm1cBug/EchoFox)',
  },

  // ═══ Operations ════════════════════════════════════════════════════════

  backup: {
    enabled:     false,
    schedule:    '0 3 * * *',
    destination: '',
    retain:      7,
    include:     ['@session', 'store/runtime'],
    encryptionPassphrase: '',
  },

  privacy: {
    storeMessageBodies:       true,
    messageBodyRetentionDays: 0,
    blockUnknownSenders:      false,
    forwardingDisabled:       false,
    excludeFromStore:         [],
    minimiseLogs:             false,
  },

  // ─── per-command failure-rate alerts ──────────────────────────────────
  alerts: {
    enabled:              true,
    windowMinutes:        60,             // rolling window
    minInvocations:       10,             // need at least N runs to alert
    failureRateThreshold: 0.30,           // alert if ≥30% fail in window
    notifyChannel:        '',             // empty = use channels.errLogs
  },
};