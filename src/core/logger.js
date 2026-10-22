/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Pino logger – one shared instance.
 * Use child loggers per module: logger.child({ mod: 'messages' })
 *
 * Privacy:
 *   • config.privacy.minimiseLogs: true → install redaction list
 *     that strips message bodies / quoted text / captions from logs.
 *
 * v0.4.5 — optional log file rotation:
 *   • config.runtime.logFile.enabled: true → also write JSON logs to
 *     `<dir>/<prefix>-YYYY-MM-DD.log`, with daily rotation in the
 *     configured timezone.
 */
const pino = require('pino');
const { makeSanitizer } = require('../lib/logSanitizer');

const isProd = process.env.NODE_ENV === 'production';

let _config = null;
try {
  _config = require('../lib/configLoader').config;
} catch {
  /* config not ready — defaults to off */
}

const sanitize = makeSanitizer(
  () => require('../lib/configLoader').__getCurrent?.() || _config || {},
);

const _privacyOn = !!_config?.privacy?.minimiseLogs;
const _logFileEnabled = !!_config?.runtime?.logFile?.enabled;
const _tz = _config?.bot?.timezone;

const REDACT_PATHS = _privacyOn
  ? [
      'msg.message.conversation',
      'msg.message.extendedTextMessage.text',
      'msg.message.imageMessage.caption',
      'msg.message.videoMessage.caption',
      'msg.message.documentMessage.fileName',
      '*.body',
      '*.text',
      '*.caption',
      'body',
      'text',
      'caption',
    ]
  : [];

// Build the optional file-rotator stream and a pino multistream destination.
let destination;
if (_logFileEnabled) {
  try {
    const { makeDailyFileStream } = require('../lib/logRotator');
    const fileStream = makeDailyFileStream({
      dir: _config.runtime.logFile.dir || './logs',
      prefix: _config.runtime.logFile.prefix || 'echofox',
      tz: _tz,
    });
    // pino-multi-stream is built into pino since v7: pass an array.
    destination = pino.multistream([{ stream: process.stdout }, { stream: fileStream }]);
  } catch (err) {
    // Fall back to stdout-only if rotator fails to initialise
    console.warn('[logger] log file rotator failed:', sanitize(err));
  }
}

const baseOpts = {
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: { app: 'echofox' },
  hooks: {
    logMethod(args, method) {
      method.apply(
        this,
        args.map((arg) => sanitize(arg)),
      );
    },
  },
  formatters: { bindings: (bindings) => sanitize(bindings) },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(REDACT_PATHS.length
    ? {
        redact: { paths: REDACT_PATHS, censor: '[redacted by privacy.minimiseLogs]' },
      }
    : {}),
};

let logger;
if (destination) {
  // multistream path — pretty-printing isn't supported by pino multistream
  // out of the box, so we go raw JSON when a file destination is used.
  logger = pino(baseOpts, destination);
} else if (!isProd && process.stdout.isTTY) {
  // Pretty output is for interactive terminals only. Piped/CI/test logs stay
  // JSON and do not create a background transport worker/exit-flush barrier.
  logger = pino({
    ...baseOpts,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,app' },
    },
  });
} else {
  logger = pino(baseOpts);
}

// Pino's bindings formatter is not applied to child bindings. Sanitize them
// before Pino serializes/caches them; descendants inherit this wrapper.
const rawChild = logger.child;
logger.child = function safeChild(bindings, options) {
  return rawChild.call(this, sanitize(bindings), options);
};

module.exports = logger;
