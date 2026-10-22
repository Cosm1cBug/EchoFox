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
 * │  Internal modules should require THIS file (not ../config) so they   │
 * │  get the validated + frozen config + legacy shim.                    │
 * │                                                                       │
 * │  The user's editable config still lives at src/config.js (gitignored)│
 * │  in any shape they prefer (legacy v5/v6 flat shape OR new shape).    │
 * │  We auto-translate on load — they never touch the new schema unless  │
 * │  they want to.                                                       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Resolution order:
 *   1. ECHOFOX_CONFIG             (explicit external configuration file)
 *   2. src/config.js              (legacy user data location)
 *   3. src/config.example.js      (committed template, never copied on load)
 *   4. schema defaults            (empty config still boots)
 *
 * Override mechanism:
 *   ECHOFOX_<SECTION>_<CAMELCASE_KEY>=value
 *   e.g.  ECHOFOX_BOT_PREFIX=!
 *         ECHOFOX_APIS_OMDB_APIKEY=xyz
 *         ECHOFOX_STOREDB_TYPE=POSTGRES
 *         ECHOFOX_DASHBOARD_ENABLED=true
 */

const fs = require('node:fs');
const path = require('node:path');
const { schema } = require('./configSchema');
const { translateLegacy, applyEnv, assertSafeKeys } = require('./configTransforms');

const PATHS = {
  real: path.join(__dirname, '..', 'config.js'),
  example: path.join(__dirname, '..', 'config.example.js'),
};

function loadRaw() {
  const specified = process.env.ECHOFOX_CONFIG;
  const real = specified ? path.resolve(process.cwd(), specified) : PATHS.real;
  if (specified && !fs.existsSync(real)) {
    throw new Error('ECHOFOX_CONFIG does not point to an existing configuration file');
  }
  const file = fs.existsSync(real) ? real : PATHS.example;
  if (!fs.existsSync(file)) return { source: '<defaults>', raw: {} };
  try {
    delete require.cache[require.resolve(file)];
    return { source: file, raw: require(file) };
  } catch {
    // Configuration code can throw an error containing a credential. Do not echo it.
    throw Object.assign(new Error(`Cannot load configuration file: ${file}`), {
      code: 'CONFIG_LOAD_FAILED',
    });
  }
}

function attachLegacyAliases(cfg) {
  cfg.options = {
    prefix: cfg.bot.prefix,
    adminPrefix: cfg.bot.adminPrefix,
    sessionName: cfg.bot.sessionName,
    timezone: cfg.bot.timezone,
    language: cfg.bot.language,
    ReadMessages: cfg.features.readMessages,
    ReadStatus: cfg.features.readStatus,
    ReactStatus: cfg.features.reactStatus,
    antiCall: cfg.features.antiCall,
    BAdmin: cfg.admins,
  };
  cfg.WApp = {
    Syslogs: cfg.channels.syslogs,
    BotLogs: cfg.channels.botLogs,
    UserLogs: cfg.channels.userLogs,
    GrpUpdates: cfg.channels.groupUpdates,
    CallLogs: cfg.channels.callLogs,
    ErrLogs: cfg.channels.errLogs,
    MovGrp: cfg.channels.movGroup,
  };
  cfg.Exif = { ...cfg.sticker };
  cfg.omdb = { ...cfg.apis.omdb, key: cfg.apis.omdb.apiKey };
  cfg.virustotal = { ...cfg.apis.virustotal, key: cfg.apis.virustotal.apiKey };
  cfg.alienvault = { ...cfg.apis.alienvault, key: cfg.apis.alienvault.apiKey };

  cfg.OpenAI = { apiKey: cfg.ai?.providers?.openai?.apiKey || '' };
  cfg.Gemini = { apiKey: cfg.ai?.providers?.gemini?.apiKey || '' };
  cfg.WorkMode = { public: cfg.bot.public };
  cfg.syncHistory = cfg.features.syncHistory;
  return cfg;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

function deepMerge(target, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch === null || typeof patch !== 'object') return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const k of Object.keys(patch)) {
    out[k] = k in out ? deepMerge(out[k], patch[k]) : deepMerge(undefined, patch[k]);
  }
  return out;
}

const _warnedChannels = new Set();
function warnIfChannelMissing(channelKey, contextLabel) {
  if (_warnedChannels.has(channelKey)) return false;
  _warnedChannels.add(channelKey);
  try {
    require('../core/logger')
      .child({ mod: 'config' })
      .warn(
        { channel: channelKey, context: contextLabel },
        `channel '${channelKey}' is not configured — skipping (set channels.${channelKey} in config.js to enable)`,
      );
  } catch {
    console.warn(
      `[config] channel '${channelKey}' not configured${contextLabel ? ' (' + contextLabel + ')' : ''}`,
    );
  }
  return true;
}

// ─── 6. Build & export ───────────────────────────────────────────────────
function load() {
  const { source, raw } = loadRaw();
  assertSafeKeys(raw);
  const translated = translateLegacy(raw);
  const withEnv = applyEnv(translated);

  let parsed;
  try {
    parsed = schema.parse(withEnv);
  } catch (err) {
    console.error('\n❌ EchoFox configuration is invalid:\n');
    if (err.errors) {
      for (const e of err.errors) {
        console.error(`  • ${e.path.join('.') || '(root)'}: invalid configuration (${e.code})`);
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
    enumerable: false,
    writable: false,
  });
  return deepFreeze(parsed);
}

let _current = load();

const config = new Proxy(
  {},
  {
    get(_target, prop, receiver) {
      if (prop === '__meta') return _current.__meta;
      return Reflect.get(_current, prop, receiver);
    },
    has(_target, prop) {
      return Reflect.has(_current, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(_current);
    },
    getOwnPropertyDescriptor(_target, prop) {
      // Make enumerable so spread/Object.keys behave correctly.
      const d = Reflect.getOwnPropertyDescriptor(_current, prop);
      if (!d) return undefined;
      return { ...d, configurable: true };
    },
    // Mutation traps — silently reject writes/deletes (matches the frozen
    // contract). Strict-mode writes will throw; sloppy-mode no-op.
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  },
);

function _warnIfNotTestEnv(method) {
  if (process.env.NODE_ENV !== 'test') {
    // We deliberately use console.warn (not the structured logger) so
    // the warning shows up even before logger is configured, and so it
    // can't be silenced by a misbehaving log config in production.
    // eslint-disable-next-line no-console
    console.warn(
      `[configLoader] ${method}() called with NODE_ENV='${process.env.NODE_ENV ?? '(unset)'}' — ` +
        `this API is intended for tests only and MUST NOT be called in production code.`,
    );
  }
}

function __testOverride(obj) {
  _warnIfNotTestEnv('__testOverride');
  if (!obj || typeof obj !== 'object') {
    throw new TypeError('__testOverride: argument must be an object');
  }
  assertSafeKeys(obj);
  // Strip __meta + legacy aliases so we re-validate the canonical shape.
  // (Zod's schema allows extra keys to pass through, but we want a clean
  // merge so legacy aliases get regenerated from the new values.)
  const base = { ..._current };
  delete base.__meta;
  const merged = deepMerge(base, obj);
  const parsed = schema.parse(merged);
  attachLegacyAliases(parsed);
  Object.defineProperty(parsed, '__meta', {
    value: {
      ..._current.__meta,
      source: `${_current.__meta?.source || 'unknown'} + __testOverride`,
      overriddenAt: new Date().toISOString(),
    },
    enumerable: false,
    writable: false,
  });
  _current = deepFreeze(parsed);
  return _current;
}

function __resetForTests() {
  _warnIfNotTestEnv('__resetForTests');
  _current = load();
  return _current;
}

function __getCurrent() {
  return _current;
}

module.exports = {
  config,
  warnIfChannelMissing,
  __testOverride,
  __resetForTests,
  __getCurrent,
};
