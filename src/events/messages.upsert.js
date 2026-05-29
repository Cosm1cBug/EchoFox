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
 * messages.upsert handler — Baileys 7.x compatible.
 *
 *   Pipeline per inbound message:
 *     1. Drop non-actionable (fromMe / status / protocol).
 *     2. Enrich into `ctx` (text, mtype, sender, isGroup, quoted,
 *        reply(), react(), downloadMsg(), …).
 *     3. Fire-and-forget analytics + user-directory writes.
 *     4. Mark as read (cheap WS frame, optional).
 *     5. Detect prefix (user `.` vs admin `$`) — dual prefix supported.
 *     6. Per-sender inbound rate limit (admins exempt).
 *     7. Resolve command, gate by admin/group/public-mode.
 *     8. Hand off to commandRunner.
 *
 *   Commands receive only `ctx` (no legacy `m.*` shim). See CONTRIBUTING.md.
 *
 *   ctx.downloadMsg(): a convenience helper. If the current message has
 *   a quoted media message, downloads THAT (most common case — user
 *   replies to a sticker with .toimg, etc.). Otherwise downloads media
 *   from the current message. Returns Buffer.
 */

const {
  getContentType,
  jidNormalizedUser,
  extractMessageContent,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');

const { config }          = require('../lib/configLoader');
const { correct }         = require('../lib/stringMatch');
const { rememberUser }    = require('../services/userDirectory');
const { run: runCommand } = require('../core/commandRunner');
const { makeRateLimiter } = require('../middleware/rateLimit');
const metrics             = require('../services/metrics');

// ─── Inbound rate limiter (token bucket per sender) ──────────────────────
//
//   capacity     = burst allowance (config.processing.userRateLimit, min 5)
//   refillPerSec = sustained rate (userRateLimit / 60 — per-minute → per-sec)
//
const senderLimiter = makeRateLimiter({
  capacity:     Math.max(config.processing.userRateLimit, 5),
  refillPerSec: config.processing.userRateLimit / 60,
});

// ─── Prefix matcher (string OR RegExp OR array) ─────────────────────────
function matchPrefix(text, p) {
  if (!text || p == null) return null;
  if (typeof p === 'string') return text.startsWith(p) ? p : null;
  if (p instanceof RegExp)   return (text.match(p) || [null])[0];
  if (Array.isArray(p)) {
    for (const x of p) {
      const m = matchPrefix(text, x);
      if (m) return m;
    }
  }
  return null;
}

// ─── Text extraction (handles every WhatsApp message body location) ─────
function pickText(m) {
  const msg = m.message;
  if (!msg) return '';
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msg.templateButtonReplyMessage?.selectedId ||
    msg.interactiveResponseMessage?.body?.text ||
    ''
  );
}

// ─── Enrichment: raw Baileys message → flat `ctx` object ────────────────
function enrich(m, sock) {
  const remoteJid = m.key.remoteJid;
  const isGroup   = remoteJid?.endsWith('@g.us');
  const isPrivate = remoteJid?.endsWith('@s.whatsapp.net');
  const isStatus  = remoteJid === 'status@broadcast';

  const sender = jidNormalizedUser(
    m.key.fromMe ? sock.user?.id :
    (m.key.participant || remoteJid || ''),
  );

  const innerContent = extractMessageContent(m.message) || {};
  const mtype  = getContentType(innerContent);
  const inner  = mtype ? innerContent[mtype] : null;
  const ctxInfo = inner?.contextInfo;

  return {
    raw: m,                        // the original Baileys message
    id: m.key.id,
    chat: remoteJid,
    from: remoteJid,
    sender,
    fromMe: !!m.key.fromMe,
    pushName: m.pushName || 'Unknown',
    timestamp: Number(m.messageTimestamp) || Math.floor(Date.now() / 1000),
    isGroup, isPrivate, isStatus,
    mtype,
    body: pickText(m),
    mentions: ctxInfo?.mentionedJid || [],

    quoted: ctxInfo?.quotedMessage
      ? {
          message:     ctxInfo.quotedMessage,
          stanzaId:    ctxInfo.stanzaId,
          participant: ctxInfo.participant,
          type:        getContentType(ctxInfo.quotedMessage),
          text:
            ctxInfo.quotedMessage.conversation ||
            ctxInfo.quotedMessage.extendedTextMessage?.text ||
            ctxInfo.quotedMessage.imageMessage?.caption ||
            ctxInfo.quotedMessage.videoMessage?.caption ||
            '',
        }
      : null,

    // ── Convenience senders ────────────────────────────────────────────
    reply: (text, opts = {}) => {
      const p = sock.sendMessage(remoteJid, { text }, { quoted: m, ...opts });
      p.then(() => metrics.incSent()).catch(() => {});
      return p;
    },
    react: (emoji) =>
      sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } }),

    /**
     * ctx.downloadMsg() — download media as a Buffer.
     *
     * If the message has a quoted media message, downloads the QUOTED one
     * (the most common case — user replies to an image with .toimg etc.).
     * Otherwise downloads media from this message itself.
     *
     *   const buf = await ctx.downloadMsg();
     *
     * Throws if there is no media to download. Always returns Buffer.
     */
    downloadMsg: async () => {
      let msgToDownload = m;
      if (ctxInfo?.quotedMessage) {
        msgToDownload = {
          key: {
            remoteJid,
            id:          ctxInfo.stanzaId,
            participant: ctxInfo.participant,
          },
          message: ctxInfo.quotedMessage,
        };
      }
      const buf = await downloadMediaMessage(
        msgToDownload,
        'buffer',
        {},
        {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );
      metrics.incMediaDown();
      return buf;
    },
  };
}

// ─── Main entry point ───────────────────────────────────────────────────
module.exports = async function handleMessage({ sock, m, commands, store, logger }) {
  if (!m?.message) return;
  if (m.key?.fromMe) return;
  if (m.message.protocolMessage) return;
  if (m.key.remoteJid === 'status@broadcast' && !config.features.readStatus) return;

  const ctx = enrich(m, sock);

  // Fire-and-forget side effects
  rememberUser(ctx, sock).catch(() => {});

  if (config.features.readMessages) sock.readMessages([m.key]).catch(() => {});

  // ── Prefix detection (admin prefix wins on tie) ────────────────────
  const text       = ctx.body || '';
  const adminMatch = matchPrefix(text, config.bot.adminPrefix);
  const userMatch  = adminMatch ? null : matchPrefix(text, config.bot.prefix);
  const matched    = adminMatch || userMatch;
  const isAdminCall = !!adminMatch;

  if (!matched) {
    if (/^(echofox|buggy)$/i.test(text.trim())) {
      await ctx.reply(`🦊 EchoFox online. Type \`${config.bot.prefix}menu\` for commands.`);
    }
    return;
  }

  const rest = text.slice(matched.length).trim();
  const [cmdName, ...args] = rest.split(/\s+/);
  if (!cmdName) return;

  // ── Inbound rate limit (admins exempt) ─────────────────────────────
  const isAdminUser = (config.admins || []).includes(ctx.sender);
  if (!isAdminUser && !senderLimiter.tryConsume(ctx.sender)) {
    metrics.incRateLimit();
    return ctx.reply('⏱️ Slow down a bit — try again in a few seconds.');
  }

  // ── Resolve command ────────────────────────────────────────────────
  const cmd = commands.resolve(cmdName);
  if (!cmd) {
    const pool  = commands.all().flatMap((c) => [c.name, ...(c.alias || [])]);
    const guess = correct(cmdName.toLowerCase(), pool);
    if (guess.rating > 0.5) {
      await ctx.reply(`❓ Unknown command. Did you mean *${matched}${guess.result}*?`);
    }
    return;
  }

  // ── Gating ─────────────────────────────────────────────────────────
  if (cmd.admin && !isAdminUser)   return ctx.reply('🔒 Admin-only command.');
  if (isAdminCall && !isAdminUser) return ctx.reply('🔒 The `$` prefix is reserved for admins.');
  if (!config.bot.public && !isAdminUser) return;
  if (cmd.group && !ctx.isGroup)   return ctx.reply('👥 Group-only command.');

  // ── Lazy group metadata fetch ──────────────────────────────────────
  let metadata = null;
  if (ctx.isGroup && cmd.needsMetadata) {
    metadata = await store.getGroupMetadata(ctx.chat).catch(() => null)
            || await sock.groupMetadata(ctx.chat).catch(() => null);
  }

  // ── Delegate to runner (timeout, cooldown, crash handling, metrics) ─
  await runCommand({
    sock, cmd, m, ctx,
    handlerArgs: {
      name:      config.bot.name,
      ctx,
      metadata,
      pushName:  ctx.pushName,
      isPrivate: ctx.isPrivate,
      isGroup:   ctx.isGroup,
      isAdmin:   isAdminUser,
      body:      ctx.body,
      arg:       args.map((a) => a.toLowerCase()),
      args,
      text:      args.join(' '),
      prefix:    matched,
      command:   cmd.name,
      commands,
      config,
      logger,
    },
  });
};
