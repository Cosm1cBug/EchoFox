/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Single zod schema for EchoFox configuration.
 * Extended to cover the new (post-M3) sections:
 *   • login            — QR vs pairing-code
 *   • auth             — MULTIFILE / REDIS / SQLITE backends
 *   • storeDB          — SQLITE / POSTGRES / MONGODB / REDIS
 *   • dashboard        — built-in web UI
 *   • processing       — concurrency & rate-limit knobs
 *   • syncHistory      — toggle Baileys history sync
 *
 * Each field has a sensible default → an empty config.js still boots.
 * See src/lib/configLoader.js for how the schema is applied + how legacy
 * v5/v6 config shapes are auto-translated.
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

// Phone number for pairing-code login (digits only, no +/spaces/dashes)
const phoneNumber = z
  .string()
  .transform((s) => (s || '').replace(/\D/g, ''))
  .refine((s) => s === '' || (s.length >= 7 && s.length <= 15), {
    message: 'must be digits only (no +, spaces or dashes); 7–15 digits',
  });

const schema = z.object({

  // ─── Bot identity & prefixes ────────────────────────────────────────────
  bot: z.object({
    name:        z.string().min(1).default('EchoFox'),
    prefix:      z.union([z.string().min(1), z.instanceof(RegExp)]).default('.'),
    adminPrefix: z.union([z.string().min(1), z.instanceof(RegExp)]).default('$'),
    sessionName: z.string().min(1).default('@session'),
    timezone:    z.string().min(1).default('Asia/Kolkata'),
    language:    z.string().length(2).default('en'),
    public:      z.boolean().default(true),
  }).default({}),

  // ─── Behavioural switches ───────────────────────────────────────────────
  features: z.object({
    readMessages: z.boolean().default(true),
    readStatus:   z.boolean().default(true),
    reactStatus:  z.boolean().default(false),
    antiCall:     z.boolean().default(false),
    syncHistory:  z.boolean().default(true),
  }).default({}),

  // ─── Login: QR or Pairing Code ──────────────────────────────────────────
  login: z.object({
    type:        z.enum(['QR', 'PAIRING']).default('QR'),
    phoneNumber: phoneNumber.default(''),
  }).default({}).refine(
    (l) => l.type !== 'PAIRING' || l.phoneNumber.length > 0,
    { message: 'login.phoneNumber is required when login.type = "PAIRING"' },
  ),

  // ─── Auth state backend ─────────────────────────────────────────────────
  auth: z.object({
    method:      z.enum(['MULTIFILE', 'REDIS', 'SQLITE']).default('MULTIFILE'),
    redisUrl:    z.string().default('redis://localhost:6379'),
    sqlitePath:  z.string().default('./src/store/auth.db'),
  }).default({}),

  // ─── Data store backend ─────────────────────────────────────────────────
  storeDB: z.object({
    type:        z.enum(['SQLITE', 'POSTGRES', 'MONGODB', 'REDIS']).default('SQLITE'),
    sqlitePath:  z.string().default('./src/store/runtime/wa.db'),
    postgresUrl: z.string().default('postgresql://postgres:postgres@localhost:5432/echofox'),
    mongoUri:    z.string().default('mongodb://localhost:27017/echofox'),
    redisUrl:    z.string().default('redis://localhost:6379'),
  }).default({}),

  // ─── Built-in web dashboard ─────────────────────────────────────────────
  dashboard: z.object({
    enabled:     z.boolean().default(false),
    port:        z.coerce.number().int().min(1).max(65535).default(3001),
    username:    z.string().default('admin'),
    password:    z.string().default('change-me-please'),
  }).default({}),

  // ─── Processing / concurrency / rate-limit ──────────────────────────────
  processing: z.object({
    concurrencyPerChat: z.coerce.number().int().min(1).max(16).default(1),
    globalRateLimit:    z.coerce.number().int().min(1).default(20),  // cmds/sec across whole bot
    userRateLimit:      z.coerce.number().int().min(1).default(10),  // cmds/minute per sender
    sendConcurrency:    z.coerce.number().int().min(1).max(16).default(4),
  }).default({}),

  // ─── Admins (user JIDs) ─────────────────────────────────────────────────
  admins: z.array(optionalUserJid).default([]),

  // ─── Notification channels (group JIDs; empty = disabled) ──────────────
  channels: z.object({
    syslogs:      optionalGroupJid.default(''),
    botLogs:      optionalGroupJid.default(''),
    userLogs:     optionalGroupJid.default(''),
    groupUpdates: optionalGroupJid.default(''),
    callLogs:     optionalGroupJid.default(''),
    errLogs:      optionalGroupJid.default(''),
    movGroup:     optionalGroupJid.default(''),
  }).default({}),

  // ─── External API keys (commands auto-skip if empty) ────────────────────
  apis: z.object({
    omdb:       z.object({
      apiKey: z.string().default(''),
      url:    z.string().url().default('https://www.omdbapi.com/'),
    }).default({}),
    virustotal: z.object({ apiKey: z.string().default('') }).default({}),
    alienvault: z.object({ apiKey: z.string().default('') }).default({}),
    openai:     z.object({ apiKey: z.string().default('') }).default({}),
    gemini:     z.object({ apiKey: z.string().default('') }).default({}),
  }).default({}),

  // ─── Sticker pack metadata ──────────────────────────────────────────────
  sticker: z.object({
    packName:   z.string().default('EchoFox'),
    packAuthor: z.string().default('COSM1CBUG'),
  }).default({}),

  // ─── Runtime / observability ────────────────────────────────────────────
  runtime: z.object({
    logLevel:    z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
    port:        z.coerce.number().int().min(1).max(65535).default(3000),
    healthPath:  z.string().startsWith('/').default('/healthz'),
    metricsPath: z.string().startsWith('/').default('/metrics'),
  }).default({}),

  // ─── Storage paths (rarely changes) ─────────────────────────────────────
  store: z.object({
    instanceId: z.string().default('EchoFox'),
    storePath:  z.string().default('./src/store/'),
    runtimeDir: z.string().default('./src/store/runtime/'),
  }).default({}),
}).passthrough();   // tolerate extra keys (legacy or future additions)

module.exports = { schema, JID_USER, JID_GROUP, JID_LID };