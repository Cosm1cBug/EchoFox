/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/** Canonical values win per field; a canonical section must not discard
 * legacy fallbacks in unrelated sections (or the fifteen newer sections).
 */
function translateLegacy(raw) {
  const o = raw && typeof raw === 'object' && raw.config ? raw.config : raw;
  if (!o || typeof o !== 'object' || Array.isArray(o))
    throw new Error('Configuration must export an object');
  const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  assertSafeKeys(o);
  const legacy = {
    bot: {
      prefix: o.options?.prefix ?? '.',
      adminPrefix: o.options?.adminPrefix ?? '$',
      sessionName: o.options?.sessionName ?? '@session',
      timezone: o.options?.timezone ?? 'Asia/Kolkata',
      language: o.options?.language ?? 'en',
      public: o.WorkMode?.public ?? true,
    },
    features: {
      readMessages: o.options?.ReadMessages ?? true,
      readStatus: o.options?.ReadStatus ?? true,
      reactStatus: o.options?.ReactStatus ?? false,
      antiCall: o.options?.antiCall ?? false,
      syncHistory: o.syncHistory ?? true,
    },
    channels: {
      syslogs: o.WApp?.Syslogs ?? '',
      botLogs: o.WApp?.BotLogs ?? '',
      userLogs: o.WApp?.UserLogs ?? '',
      groupUpdates: o.WApp?.GrpUpdates ?? '',
      callLogs: o.WApp?.CallLogs ?? '',
      errLogs: o.WApp?.ErrLogs ?? '',
      movGroup: o.WApp?.MovGrp ?? '',
    },
    apis: {
      omdb: {
        apiKey: o.omdb?.apiKey ?? o.omdb?.key ?? '',
        url: o.omdb?.url ?? 'https://www.omdbapi.com/',
      },
      virustotal: { apiKey: o.virustotal?.apiKey ?? o.virustotal?.key ?? '' },
      alienvault: { apiKey: o.alienvault?.apiKey ?? o.alienvault?.key ?? '' },
    },
    sticker: {
      packName: o.Exif?.packName ?? 'EchoFox',
      packAuthor: o.Exif?.packAuthor ?? 'COSM1CBUG',
    },
  };
  const out = { ...o };
  for (const [section, defaults] of Object.entries(legacy))
    out[section] =
      Object.hasOwn(o, section) && !object(o[section])
        ? o[section]
        : { ...defaults, ...o[section] };
  if (object(out.apis))
    for (const [api, defaults] of Object.entries(legacy.apis))
      out.apis[api] =
        o.apis && Object.hasOwn(o.apis, api) && !object(o.apis[api])
          ? o.apis[api]
          : { ...defaults, ...o.apis?.[api] };
  const legacyAdmins = o.options?.BAdmin ?? [];
  out.admins = Object.hasOwn(o, 'admins')
    ? o.admins
    : Array.isArray(legacyAdmins)
      ? legacyAdmins.filter((jid) => typeof jid !== 'string' || !jid.startsWith('1234567890'))
      : legacyAdmins;
  out.store =
    Object.hasOwn(o, 'store') && !object(o.store)
      ? o.store
      : {
          ...o.store,
          instanceId:
            o.store && Object.hasOwn(o.store, 'instanceId')
              ? o.store.instanceId
              : (o.store?.ininstanceID ?? 'EchoFox'),
        };
  if (!Object.hasOwn(o, 'ai') || object(o.ai))
    out.ai = {
      ...o.ai,
      providers: {
        ...o.ai?.providers,
        openai: { apiKey: o.OpenAI?.apiKey ?? '', ...o.ai?.providers?.openai },
        gemini: { apiKey: o.Gemini?.apiKey ?? '', ...o.ai?.providers?.gemini },
      },
    };
  if (object(o.ai) && Object.hasOwn(o.ai, 'providers') && !object(o.ai.providers))
    out.ai.providers = o.ai.providers;
  else if (object(o.ai?.providers)) {
    for (const name of ['openai', 'gemini'])
      if (Object.hasOwn(o.ai.providers, name) && !object(o.ai.providers[name]))
        out.ai.providers[name] = o.ai.providers[name];
  }
  return out;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertSafeKeys(value) {
  if (!value || typeof value !== 'object' || value instanceof RegExp) return;
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new Error('Unsafe configuration key');
    assertSafeKeys(value[key]);
  }
}

/** Resolve documented compact AND snake-case aliases to canonical schema paths.
 * Objects/arrays may be supplied as JSON; credentials and phone numbers stay strings.
 * Unknown keys fail rather than appearing to work. Values are never included in errors.
 */
function applyEnv(cfg, env = process.env) {
  assertSafeKeys(cfg);
  const defaults = require('./configSchema').schema.parse({});
  const paths = new Map();
  function visit(value, parts = []) {
    if (parts.length) paths.set(parts.join('').replace(/_/g, '').toUpperCase(), { parts, value });
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, [...parts, key]);
    }
  }
  visit(defaults);
  const seen = new Map();
  const overrides = Object.entries(env)
    .filter(([key]) => key.startsWith('ECHOFOX_') && key !== 'ECHOFOX_CONFIG')
    .map(([key, raw]) => {
      const entry = paths.get(key.slice(8).replace(/_/g, '').toUpperCase());
      if (!entry) throw new Error(`Unknown configuration environment variable: ${key}`);
      const alias = entry.parts.join('.');
      if (seen.has(alias) && seen.get(alias).raw !== raw)
        throw new Error(
          `Conflicting configuration environment variables: ${seen.get(alias).key}, ${key}`,
        );
      seen.set(alias, { key, raw });
      return { key, raw, ...entry };
    })
    .sort((a, b) => a.parts.length - b.parts.length);
  // A leaf override always wins over whole-section JSON, independently of env order.
  for (const { key, raw, ...entry } of overrides) {
    let value = raw;
    try {
      if (typeof entry.value === 'boolean') {
        if (raw !== 'true' && raw !== 'false') throw new Error();
        value = raw === 'true';
      } else if (typeof entry.value === 'number') {
        if (!String(raw).trim() || !Number.isFinite(Number(raw))) throw new Error();
        value = Number(raw);
      } else if (entry.value && typeof entry.value === 'object') {
        value = JSON.parse(raw);
        if (
          Array.isArray(entry.value) !== Array.isArray(value) ||
          !value ||
          typeof value !== 'object'
        )
          throw new Error();
      }
      assertSafeKeys(value);
    } catch {
      throw new Error(`Invalid configuration environment variable: ${key}`);
    }
    let target = cfg;
    for (const part of entry.parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part]))
        target[part] = {};
      target = target[part];
    }
    target[entry.parts.at(-1)] = value;
  }
  return cfg;
}

module.exports = { translateLegacy, applyEnv, assertSafeKeys };
