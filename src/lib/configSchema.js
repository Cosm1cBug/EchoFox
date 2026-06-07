/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Single zod schema for EchoFox configuration.
 *
 * Sections (in declaration order):
 *   • bot              identity + prefixes
 *   • features         behavioural switches
 *   • login            QR / pairing-code
 *   • auth             MULTIFILE / SQLITE / REDIS / POSTGRES
 *   • storeDB          SQLITE / POSTGRES / MONGODB / REDIS
 *   • dashboard        built-in web UI
 *   • processing       concurrency / rate-limit knobs
 *   • antiBan          human-like presence + ban-mitigation
 *   • admins[]         user JIDs with elevated privileges
 *   • channels         WhatsApp group JIDs for log streams
 *   • apis             external API keys (omdb / virustotal / alienvault)
 *   • sticker          sticker pack metadata
 *   • runtime          log level + ports + health/metrics + stability (v0.4.5)
 *   • store            storage paths
 *
 *   ─── v0.4.4 production sections ───
 *   • network          outbound proxy + fetch tuning + extra CAs
 *   • backup           scheduled session/store backups
 *   • metrics          dedicated Prometheus exporter
 *   • webhooks         outbound HTTP webhooks on bot events
 *   • i18n             multi-language bot replies
 *   • groupSettings    per-group override map
 *   • schedules[]      cron jobs running commands automatically
 *   • privacy          GDPR-friendly toggles
 *   • ai               LLM provider abstraction
 *   • telegram         Telegram bridge (was: legacy Tele section)
 *
 *   ─── v0.4.5 stability section ───
 *   • alerts           per-command failure-rate alert engine
 *
 * Every section is `.passthrough()` so user-defined extras survive
 * validation; every field has a sensible default so an empty config.js
 * still boots.
 */
const { z } = require('zod');

const JID_USER  = /^\d+@s\.whatsapp\.net$/;
const JID_GROUP = /^(\d+-\d+|\d+)@g\.us$/;
const JID_LID   = /^\d+@lid$/;

const optionalGroupJid = z
  .string()
  .transform((s) => (s || '').trim())
  .refine((s) => s === '' || s === '@g.us' || JID_GROUP.test(s), {
    message: 'must be a group JID like 1234567890@g.us, or empty to disable',
  })
  .transform((s) => (s === '@g.us' ? '' : s));

const optionalUserJid = z
  .string()
  .transform((s) => (s || '').trim())
  .refine((s) => s === '' || JID_USER.test(s) || JID_LID.test(s), {
    message: 'must be a user JID like 1234567890@s.whatsapp.net, or empty',
  });

const phoneNumber = z
  .string()
  .transform((s) => (s || '').replace(/\D/g, ''))
  .refine((s) => s === '' || (s.length >= 7 && s.length <= 15), {
    message: 'must be digits only (no +, spaces or dashes); 7–15 digits',
  });

// Cron-expression sanity check (5 or 6 space-separated tokens).
const cronExpr = z.string().refine(
  (s) => /^\S+(\s+\S+){4,5}$/.test(s.trim()),
  { message: 'must be a 5- or 6-field cron expression' },
);

const schema = z.object({

  bot: z.object({
    name:        z.string().min(1).default('EchoFox'),
    prefix:      z.union([z.string().min(1), z.instanceof(RegExp)]).default('.'),
    adminPrefix: z.union([z.string().min(1), z.instanceof(RegExp)]).default('$'),
    sessionName: z.string().min(1).default('@session'),
    timezone:    z.string().min(1).default('Asia/Kolkata'),
    language:    z.string().length(2).default('en'),
    public:      z.boolean().default(true),
  }).default({}),

  features: z.object({
    readMessages: z.boolean().default(true),
    readStatus:   z.boolean().default(true),
    reactStatus:  z.boolean().default(false),
    antiCall:     z.boolean().default(false),
    syncHistory:  z.boolean().default(true),
  }).default({}),

  login: z.object({
    type:        z.enum(['QR', 'PAIRING']).default('QR'),
    phoneNumber: phoneNumber.default(''),
  }).default({}).refine(
    (l) => l.type !== 'PAIRING' || l.phoneNumber.length > 0,
    { message: 'login.phoneNumber is required when login.type = "PAIRING"' },
  ),

  auth: z.object({
    method:      z.enum(['MULTIFILE', 'REDIS', 'SQLITE', 'POSTGRES']).default('MULTIFILE'),
    redisUrl:    z.string().default('redis://localhost:6379'),
    sqlitePath:  z.string().default('./src/store/auth.db'),
    postgresUrl: z.string().default('postgresql://postgres:postgres@localhost:5432/echofox'),
  }).default({}),

  storeDB: z.object({
    type:        z.enum(['SQLITE', 'POSTGRES', 'MONGODB', 'REDIS']).default('SQLITE'),
    sqlitePath:  z.string().default('./src/store/runtime/wa.db'),
    postgresUrl: z.string().default('postgresql://postgres:postgres@localhost:5432/echofox'),
    mongoUri:    z.string().default('mongodb://localhost:27017/echofox'),
    redisUrl:    z.string().default('redis://localhost:6379'),
    runMigrationsOnBoot: z.boolean().default(true),

  dashboard: z.object({
    enabled:  z.boolean().default(false),
    port:     z.coerce.number().int().min(1).max(65535).default(3001),
    username: z.string().default('admin'),
    password: z.string().default('change-me-please'),
  }).default({}),

  processing: z.object({
    concurrencyPerChat: z.coerce.number().int().min(1).max(16).default(1),
    globalRateLimit:    z.coerce.number().int().min(1).default(20),
    userRateLimit:      z.coerce.number().int().min(1).default(10),
    sendConcurrency:    z.coerce.number().int().min(1).max(16).default(4),
    messageBatch: z.object({
      maxBatch:      z.coerce.number().int().min(1).max(10_000).default(100),
      maxWaitMs:     z.coerce.number().int().min(10).max(60_000).default(250),
      maxBufferSize: z.coerce.number().int().min(100).max(1_000_000).default(5_000),
    }).default({}),
  }).default({}),

  antiBan: z.object({
    typingIndicator: z.boolean().default(true),
    shortReplyChars: z.coerce.number().int().min(0).default(40),
    pauseAfterSend:  z.boolean().default(true),
    typingDelayMs:   z.object({
      min: z.coerce.number().int().min(0).default(800),
      max: z.coerce.number().int().min(0).default(2500),
    }).default({}),

    presenceOnConnect: z.enum(['available', 'unavailable', 'composing']).default('available'),
    warmupMode:        z.boolean().default(false),
    warmupDays:        z.coerce.number().int().min(0).default(14),
    warmupMultiplier:  z.coerce.number().min(0.1).max(10).default(3),
    maxGroupsPerDay:   z.coerce.number().int().min(0).default(0),
    maxNewContactsPerHour: z.coerce.number().int().min(0).default(0),
  }).passthrough().default({}),

  admins: z.array(optionalUserJid).default([]),

  channels: z.object({
    syslogs:      optionalGroupJid.default(''),
    botLogs:      optionalGroupJid.default(''),
    userLogs:     optionalGroupJid.default(''),
    groupUpdates: optionalGroupJid.default(''),
    callLogs:     optionalGroupJid.default(''),
    errLogs:      optionalGroupJid.default(''),
    movGroup:     optionalGroupJid.default(''),
  }).default({}),

  apis: z.object({
    omdb: z.object({
      apiKey: z.string().default(''),
      url:    z.string().url().default('https://www.omdbapi.com/'),
    }).default({}),
    virustotal: z.object({ apiKey: z.string().default('') }).default({}),
    alienvault: z.object({ apiKey: z.string().default('') }).default({}),
    thehackersnews: z.object({ checkIntervalMin: z.number().min(5).default(60) }).default({ checkIntervalMin: 60 }),
  }).default({}),

  sticker: z.object({
    packName:   z.string().default('EchoFox'),
    packAuthor: z.string().default('COSM1CBUG'),
  }).default({}),

  runtime: z.object({
    logLevel:    z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
    port:        z.coerce.number().int().min(1).max(65535).default(3000),
    healthPath:  z.string().startsWith('/').default('/healthz'),
    metricsPath: z.string().startsWith('/').default('/metrics'),

    maxHeapPercent:   z.coerce.number().min(50).max(100).default(90),
    autoRestart:      z.boolean().default(true),
    checkIntervalMs:  z.coerce.number().int().min(5_000).default(30_000),
    gracePeriodMs:    z.coerce.number().int().min(1_000).default(5_000),
    logFile: z.object({
      enabled:    z.boolean().default(false),
      dir:        z.string().default('./logs'),
      prefix:     z.string().default('echofox'),
    }).default({}),
  }).default({}),

  store: z.object({
    instanceId: z.string().default('EchoFox'),
    storePath:  z.string().default('./src/store/'),
    runtimeDir: z.string().default('./src/store/runtime/'),
  }).default({}),

  network: z.object({
    httpProxy:    z.string().default(''),
    httpsProxy:   z.string().default(''),
    socksProxy:   z.string().default(''),
    noProxy:      z.array(z.string()).default([]),
    fetchTimeoutMs: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
    extraCaCertPath: z.string().default(''),
    userAgent:    z.string().default('EchoFox/0.4 (+https://github.com/Cosm1cBug/EchoFox)'),
  }).default({}),

  backup: z.object({
    enabled:     z.boolean().default(false),
    schedule:    cronExpr.default('0 3 * * *'),
    destination: z.string().default(''),
    retain:      z.coerce.number().int().min(1).max(365).default(7),
    include:     z.array(z.string()).default(['@session', 'store/runtime']),
    encryptionPassphrase: z.string().default(''),
  }).default({}),

  metrics: z.object({
    enabled:           z.boolean().default(true),
    prometheusEnabled: z.boolean().default(false),
    prometheusPort:    z.coerce.number().int().min(1).max(65535).default(9100),
    retentionDays:     z.coerce.number().int().min(1).max(3650).default(90),
  }).default({}),

  webhooks: z.object({
    enabled:  z.boolean().default(false),
    endpoints: z.array(z.object({
      url:     z.string().url(),
      events:  z.array(z.string()).default([]),
      secret:  z.string().default(''),
      headers: z.record(z.string()).default({}),
    })).default([]),
    retries:    z.coerce.number().int().min(0).max(10).default(3),
    timeoutMs:  z.coerce.number().int().min(500).default(5000),
  }).default({}),

  i18n: z.object({
    defaultLocale:  z.string().length(2).default('en'),
    enabledLocales: z.array(z.string().length(2)).default(['en']),
    perGroupLocale: z.record(z.string().length(2)).default({}),
    fallbackToDefault: z.boolean().default(true),
  }).default({}),

  groupSettings: z.record(z.object({
    public:           z.boolean().optional(),
    prefix:           z.string().optional(),
    disabledCommands: z.array(z.string()).default([]),
    locale:           z.string().length(2).optional(),
    silentMode:       z.boolean().default(false),
  }).passthrough()).default({}),

  schedules: z.array(z.object({
    name:    z.string().min(1),
    cron:    cronExpr,
    command: z.string().min(1),
    target:  z.string().default(''),
    enabled: z.boolean().default(true),
  })).default([]),

  privacy: z.object({
    storeMessageBodies:       z.boolean().default(true),
    messageBodyRetentionDays: z.coerce.number().int().min(0).max(3650).default(0),
    blockUnknownSenders:      z.boolean().default(false),
    forwardingDisabled:       z.boolean().default(false),
    excludeFromStore:         z.array(z.string()).default([]),
    minimiseLogs:             z.boolean().default(false),
  }).default({}),

  ai: z.object({
    enabled:         z.boolean().default(false),
    defaultProvider: z.enum(['openai', 'gemini', 'anthropic', 'local']).default('openai'),
    model:           z.string().default('gpt-4o-mini'),
    maxTokens:       z.coerce.number().int().min(1).max(200_000).default(500),
    costCapPerDayUsd: z.coerce.number().min(0).default(5),
    providers: z.object({
      openai:    z.object({ apiKey: z.string().default(''), baseUrl: z.string().default('') }).default({}),
      gemini:    z.object({ apiKey: z.string().default(''), baseUrl: z.string().default('') }).default({}),
      anthropic: z.object({ apiKey: z.string().default(''), baseUrl: z.string().default('') }).default({}),
      local:     z.object({ baseUrl: z.string().default('http://localhost:11434') }).default({}),
    }).default({}),
  }).default({}),

  telegram: z.object({
    enabled:      z.boolean().default(false),
    botToken:     z.string().default(''),
    botUsername:  z.string().default(''),
    userId:       z.string().default(''),
    apiId:        z.string().default(''),
    apiHash:      z.string().default(''),
    channelId:    z.string().default(''),
    groupId:      z.string().default(''),
    bridgedChats: z.record(z.string()).default({}),
  }).default({}),

  // ─── v0.4.5 NEW: per-command failure-rate alerts ────────────────────────
  alerts: z.object({
    enabled:              z.boolean().default(true),
    windowMinutes:        z.coerce.number().int().min(5).max(1440).default(60),
    minInvocations:       z.coerce.number().int().min(1).default(10),
    failureRateThreshold: z.coerce.number().min(0).max(1).default(0.30),
    notifyChannel:        z.string().default(''),   // override config.channels.errLogs if set
  }).default({}),

}).passthrough();   // tolerate any extras the user adds at the top level

module.exports = { schema, JID_USER, JID_GROUP, JID_LID };