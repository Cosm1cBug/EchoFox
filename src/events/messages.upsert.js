'use strict';
/**
 * messages.upsert handler – Baileys 7.x compatible.
 *
 * Goals:
 *  • Parse-once: enrich the message into a flat `ctx` object so commands
 *    don't have to walk the `m.message[mtype]` tree themselves.
 *  • Skip non-actionable messages early (status, fromMe, empty).
 *  • Track stats / user joins ASYNC – never block the command path.
 *
 * The shape of `ctx` is intentionally a superset of what the original
 * code exposed so most existing command files keep working.
 */
const {
  getContentType,
  jidNormalizedUser,
  extractMessageContent,
  proto,
} = require('@whiskeysockets/baileys');

const { config } = require('../config');
const { correct } = require('../utils/stringMatch');
const { trackCommandUsage, recordMessage } = require('../services/analytics');
const { rememberUser } = require('../services/userDirectory');

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
    isGroup, isPrivate, isStatus,

    mtype,
    body: pickText(m),
    mentions: ctxInfo?.mentionedJid || [],
    quoted: ctxInfo?.quotedMessage
      ? {
          message: ctxInfo.quotedMessage,
          stanzaId: ctxInfo.stanzaId,
          participant: ctxInfo.participant,
          type: getContentType(ctxInfo.quotedMessage),
        }
      : null,

    // Convenience reply
    reply: (text, opts = {}) => sock.sendMessage(remoteJid, { text }, { quoted: m, ...opts }),
    react: (emoji)    => sock.sendMessage(remoteJid, { react: { text: emoji, key: m.key } }),
  };
}

module.exports = async function handleMessage({ sock, m, commands, store, logger }) {
  if (!m?.message) return;
  if (m.key?.fromMe) return;                                // ignore self
  if (m.message.protocolMessage) return;                    // ignore protocol
  if (m.key.remoteJid === 'status@broadcast' && !config.options.ReadStatus) return;

  const ctx = enrich(m, sock);

  // ─── Fire-and-forget analytics (never await – not on hot path) ──────
  recordMessage(ctx).catch(() => {});
  rememberUser(ctx, sock).catch(() => {});

  // ─── Mark read (cheap WS frame, doesn't block) ─────────────────────
  if (config.options.ReadMessages) {
    sock.readMessages([m.key]).catch(() => {});
  }

  // ─── Command parsing ───────────────────────────────────────────────
  const prefix = config.options.prefix;
  const text   = ctx.body || '';
  const match  = typeof prefix === 'string'
    ? (text.startsWith(prefix) ? prefix : null)
    : (text.match(prefix)?.[0] || null);

  if (!match) {
    if (text === 'Buggy' || text === 'EchoFox') {
      await ctx.reply('🦊 EchoFox online. Type `$menu` for commands.');
    }
    return;
  }

  const rest    = text.slice(match.length).trim();
  const [cmdName, ...args] = rest.split(/\s+/);
  if (!cmdName) return;

  const cmd = commands.resolve(cmdName);
  if (!cmd) {
    // Fuzzy-suggest closest match
    const pool = commands.all().flatMap((c) => [c.name, ...(c.alias || [])]);
    const guess = correct(cmdName.toLowerCase(), pool);
    if (guess.rating > 0.5) {
      await ctx.reply(`❓ Unknown command. Did you mean *${match}${guess.result}*?`);
    }
    return;
  }

  // ─── Permission / mode gating ──────────────────────────────────────
  if (cmd.admin && !(config.options.BAdmin || []).includes(ctx.sender)) {
    return ctx.reply('🔒 Admin-only command.');
  }
  if (cmd.group && !ctx.isGroup) return ctx.reply('👥 Group-only command.');

  // ─── Lazy fetch group metadata only when needed ────────────────────
  let metadata = null;
  if (ctx.isGroup && cmd.needsMetadata) {
    metadata = await store.getGroupMetadata(ctx.chat).catch(() => null)
            || await sock.groupMetadata(ctx.chat).catch(() => null);
  }

  try {
    trackCommandUsage(ctx.sender, cmd.name).catch(() => {});
    await cmd.start(sock, ctx.raw, {
      name: 'EchoFox',
      ctx,                    // ← new, preferred interface
      metadata,
      pushName: ctx.pushName,
      isPrivate: ctx.isPrivate,
      isGroup:   ctx.isGroup,
      body: ctx.body,
      arg:  args.map((a) => a.toLowerCase()),
      args,
      text: args.join(' '),
      prefix: match,
      command: cmd.name,
      commands,
      logger,
    });
  } catch (err) {
    logger.error({ err, cmd: cmd.name, sender: ctx.sender }, 'command threw');
    await ctx.reply(`💥 Command \`${cmd.name}\` crashed: ${err.message || err}`);
  }
};
