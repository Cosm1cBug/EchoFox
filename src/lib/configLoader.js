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
 * Configuration loader for EchoFox.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  WHY NOT JUST `require('../config')`?                                 │
 * │                                                                       │
 * │  The user's editable config lives at `src/config.js` (gitignored).    │
 * │  Older commands already do `require('../../config')` and get back a   │
 * │  flat `{ config: {...} }` object — we MUST preserve that contract.    │
 * │                                                                       │
 * │  This loader is a separate module that:                               │
 * │    1. reads `src/config.js` (or example) from disk,                   │
 * │    2. auto-translates legacy v5/v6-style configs into the new shape,  │
 * │    3. applies optional ECHOFOX_* env overrides,                       │
 * │    4. validates everything via zod,                                   │
 * │    5. deep-freezes,                                                   │
 * │    6. glues back a `config.options`, `config.WApp`, … compat shim,    │
 * │    7. exports `{ config, warnIfChannelMissing }`.                     │
 * │                                                                       │
 * │  Internal modules import THIS loader, not the raw file:               │
 * │      const { config } = require('../lib/configLoader');               │
 * │                                                                       │
 * │  User-authored commands that still do `require('../../config')` keep  │
 * │  working — they just bypass validation and use their own raw object.  │
 * │  We tolerate this for backwards compatibility.                        │
 * └──────────────────────────────────────────────────────────────────────┘
 */

const fs   = require('node:fs');
const path = require('node:path');
const { schema } = require('./configSchema');

const PATHS = {
  real:    path.join(__dirname, '..', 'config.js'),
  example: path.join(__dirname, '..', 'config.example.js'),
};

// ─── 1. Read raw config object from disk ─────────────────────────────────
function loadRaw() {
  if (fs.existsSync(PATHS.real)) {
    delete require.cache[require.resolve(PATHS.real)];
    return { source: 'config.js', raw: require(PATHS.real) };
  }
  if (fs.existsSync(PATHS.example)) {
    delete require.cache[require.resolve(PATHS.example)];
    // First-run helper: silently copy example → real so the user has an
    // editable file. They'll see this message only once.
    try {
      fs.copyFileSync(PATHS.example, PATHS.real);
      console.warn('[config] no config.js found — initialised from config.example.js. Edit src/config.js with your values.');
      delete require.cache[require.resolve(PATHS.real)];
      return { source: 'config.js (newly initialised)', raw: require(PATHS.real) };
    } catch {
      return { source: 'config.example.js', raw: require(PATHS.example) };
    }
  }
  return { source: '<defaults>', raw: {} };
}

// ─── 2. Legacy auto-translator (v5/v6 → new schema) ──────────────────────
function translateLegacy(raw) {
  let o = raw && typeof raw === 'object' && raw.config ? raw.config : raw;
  if (!o || typeof o !== 'object') return {};

  // Already-new shape? has at least one new top-level key
  const NEW_KEYS = ['bot','features','channels','apis','sticker','runtime'];
  if (NEW_KEYS.some((k) => k in o)) return o;

  return {
    bot: {
      prefix:       o.options?.prefix       ?? '.',
      adminPrefix:  o.options?.adminPrefix  ?? '$',
      sessionName:  o.options?.sessionName  ?? '@session',
      timezone:     o.options?.timezone     ?? 'Asia/Kolkata',
      language:     o.options?.language     ?? 'en',
      public:       o.WorkMode?.public      ?? true,
    },
    features: {
      readMessages: o.options?.ReadMessages ?? true,
      readStatus:   o.options?.ReadStatus   ?? true,
      reactStatus:  o.options?.ReactStatus  ?? false,
      antiCall:     o.options?.antiCall     ?? false,
    },
    admins: Array.isArray(o.options?.BAdmin) ? o.options.BAdmin.filter((j) => j && !j.startsWith('1234567890')) : [],
    channels: {
      syslogs:      o.WApp?.Syslogs    ?? '',
      botLogs:      o.WApp?.BotLogs    ?? '',
      userLogs:     o.WApp?.UserLogs   ?? '',
      groupUpdates: o.WApp?.GrpUpdates ?? '',
      callLogs:     o.WApp?.CallLogs   ?? '',
      errLogs:      o.WApp?.ErrLogs    ?? '',
      movGroup:     o.WApp?.MovGrp     ?? '',
    },
    apis: {
      omdb: {
        apiKey: o.omdb?.apiKey ?? o.omdb?.key ?? '',
        url:    o.omdb?.url    ?? 'https://www.omdbapi.com/',
      },
      virustotal: { apiKey: o.virustotal?.apiKey ?? o.virustotal?.key ?? '' },
      alienvault: { apiKey: o.alienvault?.apiKey ?? o.alienvault?.key ?? '' },
      openai:     { apiKey: o.OpenAI?.apiKey     ?? '' },
      gemini:     { apiKey: o.Gemini?.apiKey     ?? '' },
    },
    sticker: {
      packName:   o.Exif?.packName   ?? 'EchoFox',
      packAuthor: o.Exif?.packAuthor ?? 'COSM1CBUG',
    },
    store: {
      instanceId: o.store?.ininstanceID ?? o.store?.instanceId ?? 'EchoFox',
      storePath:  o.store?.storePath    ?? './src/store/',
      runtimeDir: './src/store/runtime/',
    },
  };
}

// ─── 3. Env-var overrides ────────────────────────────────────────────────
function coerce(v) {
  if (v === 'true')  return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
function applyEnv(cfg) {
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^ECHOFOX_([A-Z][A-Z0-9]*)_(.+)$/);
    if (!m) continue;
    const section = m[1].toLowerCase();
    const key = m[2].toLowerCase().split('_').map((p, i) =>
      i === 0 ? p : p[0].toUpperCase() + p.slice(1),
    ).join('');
    if (!cfg[section] || typeof cfg[section] !== 'object') cfg[section] = {};
    cfg[section][key] = coerce(v);
  }
  return cfg;
}

// ─── 4. Legacy compat shim (so old commands keep working unchanged) ──────
function attachLegacyAliases(cfg) {
  cfg.options = {
    prefix:       cfg.bot.prefix,
    adminPrefix:  cfg.bot.adminPrefix,
    sessionName:  cfg.bot.sessionName,
    timezone:     cfg.bot.timezone,
    language:     cfg.bot.language,
    ReadMessages: cfg.features.readMessages,
    ReadStatus:   cfg.features.readStatus,
    ReactStatus:  cfg.features.reactStatus,
    antiCall:     cfg.features.antiCall,
    BAdmin:       cfg.admins,
  };
  cfg.WApp = {
    Syslogs:    cfg.channels.syslogs,
    BotLogs:    cfg.channels.botLogs,
    UserLogs:   cfg.channels.userLogs,
    GrpUpdates: cfg.channels.groupUpdates,
    CallLogs:   cfg.channels.callLogs,
    ErrLogs:    cfg.channels.errLogs,
    MovGrp:     cfg.channels.movGroup,
  };
  cfg.Exif       = { ...cfg.sticker };
  cfg.omdb       = { ...cfg.apis.omdb,       key: cfg.apis.omdb.apiKey };
  cfg.virustotal = { ...cfg.apis.virustotal, key: cfg.apis.virustotal.apiKey };
  cfg.alienvault = { ...cfg.apis.alienvault, key: cfg.apis.alienvault.apiKey };
  cfg.OpenAI     = { apiKey: cfg.apis.openai.apiKey };
  cfg.Gemini     = { apiKey: cfg.apis.gemini.apiKey };
  cfg.WorkMode   = { public: cfg.bot.public };
  cfg.store      = cfg.store || { instanceId: 'EchoFox', storePath: './src/store/' };
  return cfg;
}

// ─── 5. Helpers ──────────────────────────────────────────────────────────
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

const _warnedChannels = new Set();
function warnIfChannelMissing(channelKey, contextLabel) {
  if (_warnedChannels.has(channelKey)) return false;
  _warnedChannels.add(channelKey);
  try {
    require('../core/logger').child({ mod: 'config' }).warn(
      { channel: channelKey, context: contextLabel },
      `channel '${channelKey}' is not configured — skipping (set channels.${channelKey} in config.js to enable)`,
    );
  } catch {
    console.warn(`[config] channel '${channelKey}' not configured — skipping${contextLabel ? ' ('+contextLabel+')' : ''}`);
  }
  return true;
}

// ─── 6. Build & export ───────────────────────────────────────────────────
function load() {
  const { source, raw } = loadRaw();
  const translated = translateLegacy(raw);
  const withEnv    = applyEnv(translated);

  let parsed;
  try {
    parsed = schema.parse(withEnv);
  } catch (err) {
    console.error('\n❌ EchoFox configuration is invalid:\n');
    if (err.errors) {
      for (const e of err.errors) {
        console.error(`  • ${e.path.join('.') || '(root)'}: ${e.message}`);
      }
    } else {
      console.error(err);
    }
    console.error(`\nSource: ${source}`);
    console.error('See src/config.example.js for the expected shape.\n');
    process.exit(1);
  }

  attachLegacyAliases(parsed);
  Object.defineProperty(parsed, '__meta', {
    value: { source, loadedAt: new Date().toISOString() },
    enumerable: false, writable: false,
  });
  return deepFreeze(parsed);
}

const config = load();

module.exports = { config, warnIfChannelMissing };
