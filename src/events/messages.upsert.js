/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE. @license AGPL-3.0
 */
'use strict';

/**
 * messages.upsert handler — Baileys 7.x compatible.
 *
 *   Pipeline per inbound message:
 *     1. Drop non-actionable (fromMe / status / protocol).
 *     2. Privacy gates: skip excluded chats; optionally block unknown senders.
 *     3. Enrich into `ctx` (text, mtype, sender, isGroup, quoted,
 *        reply(), react(), downloadMsg(), …).
 *     4. Fire-and-forget analytics + user-directory writes.
 *     5. Mark as read (cheap WS frame, optional).
 *     6. Detect prefix (user `.` vs admin `$`) — dual prefix supported.
 *     7. Per-sender inbound rate limit (admins exempt).
 *     8. Resolve command, gate by admin/group/public-mode.
 *     9. Hand off to commandRunner.
 *
 *   Commands receive only `ctx` (no legacy `m.*` shim). See CONTRIBUTING.md.
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
const senderLimiter = makeRateLimiter({
  capacity:     Math.max(config.processing.userRateLimit, 5),
  refillPerSec: config.processing.userRateLimit / 60,
});

function matchPrefix(text, p) {
  if (!text || p == null) return null;
  if (typeof p === 'string') return text.startsWith(p) ? p : null;
  if (p instanceof RegExp) {
    // p comes from frozen config — its lastIndex can't be mutated.
    // Build a stateless clone (no g/y flags) so exec() doesn't crash.
    const re = new RegExp(p.source, p.flags.replace(/[gy]/g, ''));
    const m = re.exec(text);
    return m ? m[0] : null;
  }
  if (Array.isArray(p)) {
    for (const x of p) {
      const m = matchPrefix(text, x);
      if (m) return m;
    }
  }
  return null;
}

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
    raw: m,
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

    reply: (text, opts = {}) => {
      const p = sock.sendMessage(remoteJid, { text }, { quoted: m, ...opts });
      p.then(() => metrics.incSent()).catch(() => {});
      return p;
    },
    react: (emoji) =>
      sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } }),

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

module.exports = async function handleMessage({ sock, m, commands, store, logger }) {
  if (!m?.message) return;
  if (m.key?.fromMe) return;
  if (m.message.protocolMessage) return;
  if (m.key.remoteJid === 'status@broadcast' && !config.features.readStatus) return;

  // ─── Privacy: skip excluded chats entirely (no persistence, no handling) ──
  if ((config.privacy?.excludeFromStore || []).includes(m.key.remoteJid)) return;

  const ctx = enrich(m, sock);

  // ─── Privacy: block messages from unknown senders (private chats only) ──
  //   "Unknown" = the sender is not an admin and is not in the contacts store.
  //   Group messages are never blocked (admins control group membership).
  if (config.privacy?.blockUnknownSenders && ctx.isPrivate) {
    const isAdmin = (config.admins || []).includes(ctx.sender);
    if (!isAdmin) {
      try {
        const known = await store.db?.prepare?.('SELECT 1 FROM contacts WHERE jid = ? LIMIT 1')
          ?.get?.(ctx.sender);
        if (!known) {
          logger.debug?.({ sender: ctx.sender }, 'privacy: blocked unknown sender');
          return;
        }
      } catch {
        // Non-SQLite stores: fall back to "allow" — we don't have a
        // synchronous contacts check; future versions add a uniform method.
      }
    }
  }

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