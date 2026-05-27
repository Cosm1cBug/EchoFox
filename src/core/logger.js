'use strict';
/**
 * Pino logger – one shared instance.
 * Use child loggers per module: logger.child({ mod: 'messages' })
 */
const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  base: { app: 'echofox' },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProd ? {} : {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,app' },
    },
  }),
});

module.exports = logger;
