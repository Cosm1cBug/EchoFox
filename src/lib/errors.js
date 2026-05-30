/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * Typed error classes for EchoFox.
 *
 *   Today every command does `throw new Error('something')` and the
 *   runner can't tell if it's the user's fault, an upstream API's
 *   fault, or a real bot bug. With these classes:
 *
 *     throw new UserError('Usage: .ping')
 *       → friendly reply, no ❌ reaction, no stack-trace log,
 *         no errLogs channel post, doesn't count as command failure
 *         in the alert engine.
 *
 *     throw new UpstreamError('OMDb returned 503', { retryAfterMs: 2000 })
 *       → marked as transient; doesn't trigger failure-rate alerts;
 *         dashboard groups by upstream name.
 *
 *     throw new ConfigError('apis.omdb.apiKey is empty')
 *       → bot operator's problem; friendly reply asks them to fix config;
 *         logged but doesn't burn cooldown budget on the user.
 *
 *     throw new RateLimitError(retryAfterSec)
 *       → tells user when to try again; doesn't burn alerts/quota.
 *
 *     throw new Error(...)        // (any plain Error)
 *       → treated as a real bug: ❌ react, log stack, post to errLogs,
 *         counts toward failure-rate alert engine.
 *
 *   Convention: each subclass MUST set `this.kind` for fast dispatch.
 */

class BotError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = this.constructor.name;
    this.kind = 'bot';
    if (opts.cause) this.cause = opts.cause;
    Object.assign(this, opts);
  }
}

/**
 * User did something wrong — wrong args, missing reply, malformed URL.
 * No stack-trace log, no ❌ reaction, no errLogs post.
 */
class UserError extends BotError {
  constructor(message, opts = {}) {
    super(message, opts);
    this.kind = 'user';
  }
}

/**
 * Third-party API failed (4xx/5xx, timeout, DNS). Transient.
 * Doesn't trigger failure-rate alerts; dashboard groups by `upstream`.
 *
 *   throw new UpstreamError('OMDb 503', { upstream: 'omdb', retryAfterMs: 2000 });
 */
class UpstreamError extends BotError {
  constructor(message, opts = {}) {
    super(message, opts);
    this.kind = 'upstream';
    this.upstream = opts.upstream || 'unknown';
    this.retryAfterMs = opts.retryAfterMs || 0;
  }
}

/**
 * Bot operator misconfiguration — missing API key, bad JID, etc.
 * Friendly reply asking operator to fix config.
 */
class ConfigError extends BotError {
  constructor(message, opts = {}) {
    super(message, opts);
    this.kind = 'config';
    this.configPath = opts.configPath || '';
  }
}

/**
 * User hit a rate limit / cooldown. Doesn't count as failure for alerts.
 *
 *   throw new RateLimitError(15);   // → "wait 15 s"
 */
class RateLimitError extends BotError {
  constructor(retryAfterSec, message) {
    super(message || `Try again in ${retryAfterSec}s`);
    this.kind = 'ratelimit';
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Convenience predicate for the runner.
 *   isUserFacingError(err) === true  → don't ❌ react, don't post to errLogs
 */
function isUserFacingError(err) {
  return err instanceof UserError ||
         err instanceof RateLimitError;
}

/**
 * Should this error count toward "command is broken" failure-rate alerts?
 *   - bug          → yes
 *   - upstream     → no  (third-party fault)
 *   - user         → no  (user fault)
 *   - config       → no  (operator fault, not the command)
 *   - ratelimit    → no
 */
function shouldCountAsFailure(err) {
  if (!err) return false;
  if (err instanceof UserError)      return false;
  if (err instanceof UpstreamError)  return false;
  if (err instanceof ConfigError)    return false;
  if (err instanceof RateLimitError) return false;
  return true;
}

module.exports = {
  BotError,
  UserError,
  UpstreamError,
  ConfigError,
  RateLimitError,
  isUserFacingError,
  shouldCountAsFailure,
};
