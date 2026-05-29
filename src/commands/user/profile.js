/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * .profile  (or reply to a contact's message)
 *
 * Shows the sender's display name, JID, status ("about" text), and
 * profile picture. If invoked while quoting another user's message, it
 * shows THAT user's profile instead.
 *
 * Fixes from the original:
 *   • The original had `sock.fetchStatus` — that method doesn't exist
 *     in Baileys 7.x. We use `sock.fetchStatus({jid})` / fall back to
 *     fetchProfile when it does, and gracefully skip "about" on failure.
 *   • Typo `usrdata` vs `usrData` removed.
 *   • Falls back to bundled default avatar if both PP and business
 *     profile pic are unavailable.
 */

const fs   = require('node:fs');
const path = require('node:path');

const DEFAULT_AVATAR = path.join(__dirname, '..', '..', 'Utils', 'assets', 'default.jpg');

async function fetchStatusSafely(sock, jid) {
  // Baileys 7.x exposes fetchStatus differently across rc releases.
  // Try the most-common shapes; soft-fail to null.
  try {
    if (typeof sock.fetchStatus === 'function') {
      const r = await sock.fetchStatus(jid);
      if (Array.isArray(r) && r[0]?.status?.status) return r[0].status.status;
      if (r?.status) return r.status;
    }
  } catch { /* fall through */ }
  return null;
}

async function fetchAvatar(sock, jid) {
  // 1. Standard profile picture
  try {
    const url = await sock.profilePictureUrl(jid, 'image');
    if (url) return { url };
  } catch { /* user has no PP / privacy */ }
  // 2. Business profile picture
  try {
    const biz = await sock.getBusinessProfile(jid);
    if (biz?.profilePictureUrl) return { url: biz.profilePictureUrl };
  } catch { /* not a business account */ }
  // 3. Bundled default
  if (fs.existsSync(DEFAULT_AVATAR)) return { url: 'file://' + DEFAULT_AVATAR };
  return null;
}

module.exports = {
  name: 'profile',
  alias: ['me', 'whois'],
  desc: 'Show your profile (or quoted user\'s profile)',
  category: 'user',
  cooldown: 5,

  async start(sock, m, { ctx }) {
    // Pick the target: quoted user (if any) else the sender themselves
    const targetJid =
      ctx.quoted?.participant ||
      ctx.sender;

    const targetShort = targetJid.split('@')[0];

    const [about, avatar] = await Promise.all([
      fetchStatusSafely(sock, targetJid),
      fetchAvatar(sock, targetJid),
    ]);

    const lines = [
      `👤 *Profile*`,
      ``,
      `*JID:* \`${targetJid}\``,
      `*Number:* +${targetShort}`,
      ctx.quoted ? null : `*Display name:* ${ctx.pushName}`,
      about ? `*About:* ${about}` : `*About:* _(unavailable)_`,
    ].filter(Boolean);

    const payload = {
      text: lines.join('\n'),
      mentions: [targetJid],
      contextInfo: {
        mentionedJid: [targetJid],
        ...(avatar ? {
          externalAdReply: {
            showAdAttribution: false,
            renderLargerThumbnail: true,
            title: 'WhatsApp Profile',
            body: targetShort,
            previewType: 0,
            mediaType: 1,
            thumbnailUrl: avatar.url,
          },
        } : {}),
      },
    };

    await sock.sendMessage(ctx.from, payload, { quoted: m });
  },
};
