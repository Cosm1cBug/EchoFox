/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * EchoFox configuration template.
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
 * Sections marked `enabled: false` are scaffolded — the schema and
 * runtime wiring is partially in place; flip to `true` and supply the
 * fields once you're ready. See README.md "Configuration reference"
 * for the full per-field documentation.
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
  },

  dashboard: {
    enabled:  false,
    port:     3001,
    username: 'admin',
    password: 'change-me-please',
  },

  processing: {
    concurrencyPerChat: 1,
    globalRateLimit:    20,
    userRateLimit:      10,
    sendConcurrency:    4,
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
    maxGroupsPerDay:   0,
    maxNewContactsPerHour: 0,
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
    omdb:       { apiKey: '', url: 'https://www.omdbapi.com/' },
    virustotal: { apiKey: '' },
    alienvault: { apiKey: '' },
    thehackersnews: { 
      checkIntervalMin: 60 
    },
  },

  sticker: {
    packName:   'EchoFox',
    packAuthor: 'COSM1CBUG',
  },

  runtime: {
    logLevel:    'info',                  // trace|debug|info|warn|error|fatal
    port:        3000,                    // /healthz + /metrics
    healthPath:  '/healthz',
    metricsPath: '/metrics',
    maxHeapPercent:  90,                  // restart worker above this heap %
    autoRestart:     true,                // false = only alert, no exit
    checkIntervalMs: 30000,
    gracePeriodMs:   5000,                // delay before restart (drains in-flight)
    logFile: {
      enabled: false,                     // also write JSON logs to file
      dir:     './logs',
      prefix:  'echofox',                 // → ./logs/echofox-YYYY-MM-DD.log
    },
  },

  store: {
    instanceId: 'EchoFox',
    storePath:  './src/store/',
    runtimeDir: './src/store/runtime/',
  },

  // ═══ Production sections (v0.4.4) ═════════════════════════════════════

  network: {
    httpProxy:    '',
    httpsProxy:   '',
    socksProxy:   '',
    noProxy:      [],
    fetchTimeoutMs:  30000,
    extraCaCertPath: '',
    userAgent: 'EchoFox/0.4 (+https://github.com/Cosm1cBug/EchoFox)',
  },

  backup: {
    enabled:     false,
    schedule:    '0 3 * * *',
    destination: '',
    retain:      7,
    include:     ['@session', 'store/runtime'],
    encryptionPassphrase: '',
  },

  metrics: {
    enabled:           true,
    prometheusEnabled: false,
    prometheusPort:    9100,
    retentionDays:     90,
  },

  webhooks: {
    enabled: false,
    endpoints: [
      // { url: 'https://hooks.example.com/echofox',
      //   events: ['command.success', 'participant.kick'],
      //   secret: 'shared-hmac', headers: {} },
    ],
    retries:   3,
    timeoutMs: 5000,
  },

  i18n: {
    defaultLocale:    'en',
    enabledLocales:   ['en'],
    perGroupLocale:   {},
    fallbackToDefault: true,
  },

  groupSettings: {
    // '120111@g.us': { public: false, prefix: '!', disabledCommands: ['eval'] },
  },

  schedules: [
    // { name: 'daily-stats', cron: '0 9 * * *', command: 'stats', target: '', enabled: true },
  ],

  privacy: {
    storeMessageBodies:       true,
    messageBodyRetentionDays: 0,
    blockUnknownSenders:      false,
    forwardingDisabled:       false,
    excludeFromStore:         [],
    minimiseLogs:             false,
  },

  ai: {
    enabled:         false,
    defaultProvider: 'openai',
    model:           'gpt-4o-mini',
    maxTokens:       500,
    costCapPerDayUsd: 5,
    providers: {
      openai:    { apiKey: '', baseUrl: '' },
      gemini:    { apiKey: '', baseUrl: '' },
      anthropic: { apiKey: '', baseUrl: '' },
      local:     { baseUrl: 'http://localhost:11434' },
    },
  },

  // ─── A5 — per-command failure-rate alerts ─────────────────────────────
  alerts: {
    enabled:              true,
    windowMinutes:        60,             // rolling window
    minInvocations:       10,             // need at least N runs to alert
    failureRateThreshold: 0.30,           // alert if ≥30% fail in window
    notifyChannel:        '',             // empty = use channels.errLogs
  },

  // ─── #11 Telegram bridge ──────────────────────────────────────────────
  telegram: {
    enabled:      false,
    botToken:     '',
    botUsername:  '',
    userId:       '',
    apiId:        '',
    apiHash:      '',
    channelId:    '',
    groupId:      '',
    bridgedChats: {},
  },
};