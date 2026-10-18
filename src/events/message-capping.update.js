/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'message-capping.update' });
const { getStore } = require('../store/instance');
const { recordTimeline } = require('../lib/timelineLog');

/**
 * message-capping.update — WhatsApp's "new chat" messaging quota.
 *
 * Baileys 7.x payload is NewChatMessageCapInfo (verified: Types/State.ts +
 * the ONLY emit site Socket/messages-recv.ts:350, which forwards the raw MEX
 * `xwa2_notify_new_chat_messages_capping_info_update` object):
 *
 *   {
 *     total_quota?:            number,   // messages to NEW chats allowed per cycle
 *     used_quota?:             number,   // how many you have used this cycle
 *     cycle_start_timestamp?:  string,
 *     cycle_end_timestamp?:    string,
 *     server_sent_timestamp?:  string,
 *     ote_status?:  'NOT_ELIGIBLE' | 'ELIGIBLE' | 'ACTIVE_IN_CURRENT_CYCLE' | 'EXHAUSTED',
 *     mv_status?:   'NOT_ELIGIBLE' | 'NOT_ACTIVE' | 'ACTIVE' | 'ACTIVE_UPGRADE_AVAILABLE',
 *     capping_status?: 'NONE' | 'FIRST_WARNING' | 'SECOND_WARNING' | 'CAPPED',
 *   }
 *
 * This is an ACCOUNT-LEVEL quota — there is no jid and no per-chat cap.
 *
 * v1.20.0 (E5 fix): the previous handler expected `ev.jid` +
 * `ev.cap_value/cap/maxMessages` — none of which exist — so every event was
 * silently dropped. The real fields are now persisted via
 * `store.setMessageCapInfo()` (reserved '@account' row) and surfaced on the
 * dashboard (GET /api/message-capping → New-chat quota box).
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const store = getStore();
  if (!store?.setMessageCapInfo) return;
  const list = Array.isArray(u) ? u : [u];
  for (const ev of list) {
    // Sanity gate: at least one recognisable quota field must be present.
    if (
      ev?.total_quota == null &&
      ev?.used_quota == null &&
      !ev?.capping_status &&
      !ev?.ote_status &&
      !ev?.mv_status
    ) {
      continue;
    }
    // Whitelist the documented fields — never persist unknown blobs.
    const info = {
      total_quota: ev.total_quota ?? null,
      used_quota: ev.used_quota ?? null,
      cycle_start_timestamp: ev.cycle_start_timestamp ?? null,
      cycle_end_timestamp: ev.cycle_end_timestamp ?? null,
      server_sent_timestamp: ev.server_sent_timestamp ?? null,
      ote_status: ev.ote_status ?? null,
      mv_status: ev.mv_status ?? null,
      capping_status: ev.capping_status ?? null,
    };
    try {
      await store.setMessageCapInfo(info);
      // v1.21.0 — quota history (queryable via GET /api/history/quota).
      await recordTimeline(store, {
        domain: 'quota',
        entityId: '@account',
        field: 'used_quota',
        newValue:
          `${info.used_quota ?? '?'}/${info.total_quota ?? '?'} ${info.capping_status || ''}`.trim(),
        source: 'message-capping.update',
      });
      logger.info(
        {
          used: info.used_quota,
          total: info.total_quota,
          status: info.capping_status,
        },
        'account message-capping quota updated',
      );
    } catch (err) {
      logger.debug({ err }, 'setMessageCapInfo failed');
    }
  }
};
