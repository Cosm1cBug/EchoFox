/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const CENSOR = '[REDACTED]';
const credentialKey = (key) =>
  /^(?:apiKey|xApiKey|xOtxApiKey|token|botToken|accessToken|refreshToken|authorization|proxyAuthorization|cookie|setCookie|password|passphrase|encryptionPassphrase|secret|privateKey|creds|credentials|authInfo)$/i.test(
    String(key).replace(/[-_]/g, ''),
  );
const bodyKey = (key) =>
  /^(?:body|text|caption|conversation|quoted|message|prompt|oldBody|newBody|content)$/i.test(key);

/** Recursive redaction applies to structured objects AND free-form/error
 * strings. Credentials are always protected, independent of minimiseLogs.
 * Never serialize Axios request/response/config objects or arbitrary Error
 * properties: they often embed Authorization headers and Telegram token URLs.
 */
function makeSanitizer(getConfig = () => ({})) {
  let previous;
  let secrets = [];
  function settings() {
    const cfg = getConfig();
    if (cfg !== previous) {
      previous = cfg;
      secrets = [];
      const collect = (value) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (credentialKey(key) && typeof child === 'string' && child.length >= 8)
            secrets.push(child);
          else if (child && typeof child === 'object') collect(child);
        }
      };
      collect(cfg);
    }
    return cfg;
  }
  function cleanString(value) {
    let out = value;
    for (const secret of secrets) out = out.split(secret).join(CENSOR);
    return out
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${CENSOR}@`)
      .replace(/(api\.telegram\.org\/bot)[^/\s]+/gi, `$1${CENSOR}`)
      .replace(/([?&](?:api[-_]?key|token|secret|password|access_token)=)[^&#\s]*/gi, `$1${CENSOR}`)
      .replace(
        /((?:authorization|x-api-key|x-otx-api-key)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
        `$1${CENSOR}`,
      );
  }
  return function sanitize(value) {
    const cfg = settings();
    const seen = new WeakSet();
    function walk(current, key = '', depth = 0) {
      if (credentialKey(key) || (cfg.privacy?.minimiseLogs && bodyKey(key))) return CENSOR;
      if (typeof current === 'string') return cleanString(current);
      if (!current || typeof current !== 'object') return current;
      if (current instanceof Error) {
        return {
          type: cleanString(current.name),
          code: /^[A-Z_\d]{1,40}$/.test(current.code || '') ? current.code : undefined,
          status: Number.isInteger(current.response?.status) ? current.response.status : undefined,
          // Original error messages may contain unknown credentials, payloads,
          // or response bodies. Keep call-site frames, not the message/objects.
          stack: String(current.stack || '')
            .split('\n')
            .slice(1)
            .filter((line) => /^\s+at .*:\d+:\d+\)?$/.test(line))
            .map(cleanString)
            .join('\n'),
        };
      }
      if (Buffer.isBuffer(current)) return { type: 'Buffer', length: current.length };
      if (depth > 10) return '[depth limit]';
      if (seen.has(current)) return '[circular]';
      seen.add(current);
      if (Array.isArray(current)) return current.map((child) => walk(child, '', depth + 1));
      const result = {};
      for (const [childKey, child] of Object.entries(current)) {
        Object.defineProperty(result, childKey, {
          value: walk(child, childKey, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    return walk(value);
  };
}

module.exports = { makeSanitizer };
