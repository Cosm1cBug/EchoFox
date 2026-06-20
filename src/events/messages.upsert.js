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
 *     2. Privacy gates: skip excluded chats; optionally block unknown senders.
 *     3. Enrich into `ctx` (text, mtype, sender, isGroup, quoted, reply(), react(), downloadMsg(), …).
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

const { config } = require('../lib/configLoader');
const { correct } = require('../lib/stringMatch');
const { rememberUser } = require('../services/userDirectory');
const { run: runCommand } = require('../core/commandRunner');
const ai = require('../services/ai');
const { makeRateLimiter } = require('../middleware/rateLimit');
const metrics = require('../services/metrics');
const afkState = require('../services/afkState');
const antilink = require('../services/antilinkService');
const muteService = require('../services/muteService');

// ─── Inbound rate limiter (token bucket per sender) ──────────────────────
const senderLimiter = makeRateLimiter({
  capacity: Math.max(config.processing.userRateLimit, 5),
  refillPerSec: config.processing.userRateLimit / 60,
});

function matchPrefix(text, p) {
  if (!text || p == null) return null;

  if (typeof p === 'string') {
    return text.startsWith(p) ? p : null;
  }
  if (p instanceof RegExp) {
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
  const isGroup = remoteJid?.endsWith('@g.us');
  const isPrivate = remoteJid?.endsWith('@s.whatsapp.net');
  const isStatus = remoteJid === 'status@broadcast';
  const sender = jidNormalizedUser(
    m.key.fromMe ? sock.user?.id : m.key.participant || remoteJid || '',
  );
  const innerContent = extractMessageContent(m.message) || {};
  const mtype = getContentType(innerContent);
  const inner = mtype ? innerContent[mtype] : null;
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
    isGroup,
    isPrivate,
    isStatus,
    mtype,
    body: pickText(m),
    mentions: ctxInfo?.mentionedJid || [],
    quoted: ctxInfo?.quotedMessage
      ? {
          message: ctxInfo.quotedMessage,
          stanzaId: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
          type: getContentType(ctxInfo.quotedMessage),
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
    react: (emoji) => sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } }),
    downloadMsg: async () => {
      let msgToDownload = m;
      if (ctxInfo?.quotedMessage) {
        msgToDownload = {
          key: {
            remoteJid,
            id: ctxInfo.stanzaId,
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

  // Privacy: block unknown senders in private chats
  if (config.privacy?.blockUnknownSenders && ctx.isPrivate) {
    const isAdmin = (config.admins || []).includes(ctx.sender);
    if (!isAdmin) {
      const known = await store.hasContact?.(ctx.sender);
      if (!known) {
        logger.debug?.({ sender: ctx.sender }, 'privacy: blocked unknown sender');
        return;
      }
    }
  }

  // Fire-and-forget side effects
  rememberUser(ctx, sock).catch(() => {});

  // ─── v1.6.0 AFK auto-handler ──────────────────────────────────────
  // 1) If the sender was AFK, clear it and welcome them back.
  // 2) For any mentions or quoted-reply of an AFK user, announce their
  //    AFK status once per 30 s per (mentioned-user × chat) pair.
  if (afkState.isAfk(ctx.sender)) {
    const entry = afkState.get(ctx.sender);
    afkState.clear(ctx.sender);
    const dur = afkState.formatDuration(Date.now() - (entry?.since || Date.now()));
    ctx.reply(`👋 Welcome back! You were AFK for ${dur}.`).catch(() => {});
  }
  for (const mentioned of ctx.mentions || []) {
    if (!afkState.isAfk(mentioned)) continue;
    if (!afkState.shouldAnnounce(mentioned)) continue;
    const e = afkState.get(mentioned);
    if (!e) continue;
    const dur = afkState.formatDuration(Date.now() - e.since);
    ctx.reply(`💤 That user is *AFK* (${dur} ago)\n*Reason:* ${e.reason}`).catch(() => {});
  }
  if (ctx.quoted?.participant && afkState.isAfk(ctx.quoted.participant)) {
    if (afkState.shouldAnnounce(ctx.quoted.participant)) {
      const e = afkState.get(ctx.quoted.participant);
      if (e) {
        const dur = afkState.formatDuration(Date.now() - e.since);
        ctx.reply(`💤 That user is *AFK* (${dur} ago)\n*Reason:* ${e.reason}`).catch(() => {});
      }
    }
  }

  if (config.features.readMessages) {
    sock.readMessages([m.key]).catch(() => {});
  }

  // ─── v1.8.0 antilink hook ────────────────────────────────────────
  // Per-group, opt-in. Group admins are exempt. Bot must be group admin
  // for the delete action to work. Whitelist supports host suffixes.
  if (ctx.isGroup && antilink.containsLink(ctx.body)) {
    try {
      const alCfg = await antilink.getConfig(ctx.chat);
      if (alCfg.enabled) {
        const host = antilink.findFirstHost(ctx.body);
        const whitelisted = antilink.isWhitelisted(host, alCfg.whitelist);
        const callerIsAdmin = (config.admins || []).includes(ctx.sender);
        // Group-admin exemption — fetch metadata lazily
        let groupAdmin = callerIsAdmin;
        if (!groupAdmin) {
          try {
            const meta =
              (await store.getGroupMetadata(ctx.chat).catch(() => null)) ||
              (await sock.groupMetadata(ctx.chat).catch(() => null));
            const p = meta?.participants?.find((x) => x.id === ctx.sender);
            groupAdmin = !!p?.admin;
          } catch (_e) {
            /* fall back to non-admin */
          }
        }
        if (!groupAdmin && !whitelisted) {
          const wantDelete = alCfg.action === 'delete' || alCfg.action === 'delete+warn';
          const wantWarn = alCfg.action === 'warn' || alCfg.action === 'delete+warn';
          if (wantDelete) {
            sock
              .sendMessage(ctx.chat, { delete: m.key })
              .catch((e) => logger.debug?.({ err: e }, 'antilink delete failed'));
          }
          if (wantWarn) {
            sock
              .sendMessage(ctx.chat, {
                text: `🚫 *Antilink* — links are not allowed here.\n@${ctx.sender.split('@')[0]}, please avoid posting links.`,
                mentions: [ctx.sender],
              })
              .catch((e) => logger.debug?.({ err: e }, 'antilink warn failed'));
          }
          return; // don't process further (no command dispatch on offending msg)
        }
      }
    } catch (e) {
      logger.debug?.({ err: e, chat: ctx.chat }, 'antilink check failed');
    }
  }

  // ── Prefix detection (admin prefix wins on tie) ────────────────────
  const text = ctx.body || '';
  const adminMatch = matchPrefix(text, config.bot.adminPrefix);
  const userMatch = adminMatch ? null : matchPrefix(text, config.bot.prefix);
  const matched = adminMatch || userMatch;
  const isAdminCall = !!adminMatch;

  if (!matched) {
    if (/^(echofox|buggy)$/i.test(text.trim())) {
      await ctx.reply(`🦊 EchoFox online. Type \`${config.bot.prefix}menu\` for commands.`);
      return;
    }

    // ─── v1.2.0 AI fallback ────────────────────────────────
    if (config.ai?.enabled) {
      try {
        const decision = await ai.router.shouldRespond({
          chatJid: ctx.chat,
          userJid: ctx.sender,
          text,
          isDM: ctx.isPrivate,
        });
        if (decision.respond) {
          // Typing indicator while we generate (UX choice: typing_indicator)
          let typingTimer = null;
          if (config.ai.typingWhileGenerating) {
            try {
              await sock.sendPresenceUpdate('composing', ctx.chat);
            } catch (_) {
              /* ignore */
            }
            typingTimer = setInterval(() => {
              sock.sendPresenceUpdate('composing', ctx.chat).catch(() => {});
            }, 8_000).unref();
          }
          try {
            const out = await ai.chat({
              chatJid: ctx.chat,
              userJid: ctx.sender,
              text,
              optIn: decision.optIn,
            });
            if (out?.reply) await ctx.reply(out.reply);
          } finally {
            if (typingTimer) clearInterval(typingTimer);
            try {
              await sock.sendPresenceUpdate('paused', ctx.chat);
            } catch (_) {
              /* ignore */
            }
          }
        } else if (decision.reason === 'rate_limit_user' || decision.reason === 'rate_limit_chat') {
          // Quiet drop — don't spam every blocked message
          logger.debug({ chat: ctx.chat, reason: decision.reason }, 'ai: rate-limited');
        } else if (decision.reason === 'cost_cap') {
          logger.warn({ chat: ctx.chat }, 'ai: daily cost cap reached — dropping');
        }
      } catch (e) {
        logger.warn({ err: e, chat: ctx.chat }, 'ai fallback failed');
      }
    }
    return;
  }

  const rest = text.slice(matched.length).trim();
  const [cmdName, ...args] = rest.split(/\s+/);
  if (!cmdName) return;

  // Rate limiting
  const isAdminUser = (config.admins || []).includes(ctx.sender);
  if (!isAdminUser && !senderLimiter.tryConsume(ctx.sender)) {
    metrics.incRateLimit();
    return ctx.reply('⏱️ Slow down a bit — try again in a few seconds.');
  }

  // Resolve command
  const cmd = commands.resolve(cmdName);
  if (!cmd) {
    const pool = commands.all().flatMap((c) => [c.name, ...(c.alias || [])]);
    const guess = correct(cmdName.toLowerCase(), pool);
    if (guess.rating > 0.5) {
      await ctx.reply(`❓ Unknown command. Did you mean ${matched}${guess.result}?`);
    }
    return;
  }

  // Gating
  if (cmd.admin && !isAdminUser) return ctx.reply('🔒 Admin-only command.');
  if (isAdminCall && !isAdminUser) return ctx.reply('🔒 The `$` prefix is reserved for admins.');
  if (!config.bot.public && !isAdminUser) return;
  if (cmd.group && !ctx.isGroup) return ctx.reply('👥 Group-only command.');

  // Lazy group metadata fetch
  let metadata = null;
  if (ctx.isGroup && cmd.needsMetadata) {
    metadata =
      (await store.getGroupMetadata(ctx.chat).catch(() => null)) ||
      (await sock.groupMetadata(ctx.chat).catch(() => null));
  }

  // ─── v1.12.0 mute check ─────────────────────────────────────────
  // Silently drop the command for muted users in this group. Their
  // non-command messages still flow normally (mute is soft).
  if (ctx.isGroup && muteService.isMuted(ctx.chat, ctx.sender)) {
    logger.debug?.({ chat: ctx.chat, sender: ctx.sender }, 'mute: command dropped');
    return;
  }

  // Delegate to command runner
  await runCommand({
    sock,
    cmd,
    m,
    ctx,
    handlerArgs: {
      name: config.bot.name,
      ctx,
      metadata,
      pushName: ctx.pushName,
      isPrivate: ctx.isPrivate,
      isGroup: ctx.isGroup,
      isAdmin: isAdminUser,
      body: ctx.body,
      arg: args.map((a) => a.toLowerCase()),
      args,
      text: args.join(' '),
      prefix: matched,
      command: cmd.name,
      commands,
      config,
      logger,
    },
  });
};
