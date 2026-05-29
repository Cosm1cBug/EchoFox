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
 * The single zod schema for EchoFox configuration.
 * See src/lib/configLoader.js for how this is applied.
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
  }).default({}),

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
    omdb:       z.object({
      apiKey: z.string().default(''),
      url:    z.string().url().default('https://www.omdbapi.com/'),
    }).default({}),
    virustotal: z.object({ apiKey: z.string().default('') }).default({}),
    alienvault: z.object({ apiKey: z.string().default('') }).default({}),
    openai:     z.object({ apiKey: z.string().default('') }).default({}),
    gemini:     z.object({ apiKey: z.string().default('') }).default({}),
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
  }).default({}),

  store: z.object({
    instanceId: z.string().default('EchoFox'),
    storePath:  z.string().default('./src/store/'),
    runtimeDir: z.string().default('./src/store/runtime/'),
  }).default({}),
}).passthrough();   // tolerate extra keys (legacy or user additions)

module.exports = { schema, JID_USER, JID_GROUP, JID_LID };
