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
 * EchoFox configuration template.
 *
 *   1. Copy this file:  cp src/config.example.js src/config.js
 *   2. Edit src/config.js with your values (it's gitignored — safe).
 *   3. Optionally override any field with an environment variable:
 *        ECHOFOX_<SECTION>_<KEY>=value
 *      e.g.   ECHOFOX_APIS_OMDB_APIKEY=abc123
 *             ECHOFOX_BOT_PREFIX=!
 *             ECHOFOX_RUNTIME_PORT=4000
 *
 * Any commands that need keys you haven't set will simply not load
 * (warning, not crash). See docs/configuration.md for the full reference.
 */
module.exports = {

  // ─── Bot identity & prefixes ────────────────────────────────────────────
  bot: {
    name:         'EchoFox',
    prefix:       '.',                    // user commands: ".ping"
    adminPrefix:  '$',                    // admin commands: "$eval"
    sessionName:  '@session',             // folder under src/ for WA auth files
    timezone:     'Asia/Kolkata',
    language:     'en',
    public:       true,                   // false = bot only responds to admins
  },

  // ─── Behavioural switches ───────────────────────────────────────────────
  features: {
    readMessages: true,                   // mark incoming msgs as read
    readStatus:   true,                   // mark statuses as read
    reactStatus:  false,                  // auto-react to statuses
    antiCall:     false,                  // auto-reject incoming calls
  },

  // ─── Admins (full JIDs, ending in @s.whatsapp.net) ──────────────────────
  admins: [
    // '1234567890@s.whatsapp.net',
  ],

  // ─── WhatsApp log channels (group JIDs, ending in @g.us) ────────────────
  //    Leave empty to silently skip the related notification.
  channels: {
    syslogs:      '',                     // bot connection / restart events
    botLogs:      '',                     // generic bot-side logs
    userLogs:     '',                     // first-time user records
    groupUpdates: '',                     // join/leave/promote/demote
    callLogs:     '',                     // incoming call events
    errLogs:      '',                     // uncaught command errors
    movGroup:     '',                     // optional moderator group
  },

  // ─── External API keys ──────────────────────────────────────────────────
  //    Each command that needs a key declares `requires: ['apis.<x>.apiKey']`
  //    and is auto-skipped at load time if its key is empty.
  apis: {
    omdb:       { apiKey: '', url: 'https://www.omdbapi.com/' },
    virustotal: { apiKey: '' },
    alienvault: { apiKey: '' },
    openai:     { apiKey: '' },
    gemini:     { apiKey: '' },
  },

  // ─── Sticker pack metadata ──────────────────────────────────────────────
  sticker: {
    packName:   'EchoFox',
    packAuthor: 'COSM1CBUG',
  },

  // ─── Runtime / observability ────────────────────────────────────────────
  runtime: {
    logLevel:    'info',                  // trace | debug | info | warn | error | fatal
    port:        3000,                    // /healthz + /metrics live here
    healthPath:  '/healthz',
    metricsPath: '/metrics',
  },

  // ─── Storage paths (rarely needs changing) ──────────────────────────────
  store: {
    instanceId: 'EchoFox',
    storePath:  './src/store/',
    runtimeDir: './src/store/runtime/',
  },
};
