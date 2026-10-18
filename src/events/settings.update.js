/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

const logger = require('../core/logger').child({ mod: 'settings.update' });
const { recordTimeline, safeGetStore } = require('../lib/timelineLog');

/**
 * settings.update — account-level WhatsApp settings synced from app-state.
 *
 * Baileys 7.x payload (verified: Types/Events.ts) — a discriminated union:
 *   { setting: 'unarchiveChats', value: boolean }
 *   { setting: 'locale', value: string }
 *   { setting: 'disableLinkPreviews', value: proto.….IPrivacySettingDisableLinkPreviewsAction }
 *   { setting: 'timeFormat', value: proto.….ITimeFormatAction }
 *   { setting: 'privacySettingRelayAllCalls', value: proto.….IPrivacySettingRelayAllCalls }
 *   { setting: 'statusPrivacy', value: proto.….IStatusPrivacyAction }
 *   { setting: 'notificationActivitySetting', value: enum number }
 *   { setting: 'channelsPersonalisedRecommendation', value: proto.….I…Action }
 *
 * v1.20.2 (E9): previously NOT BOUND (silently dropped). EchoFox consumes
 * no account settings today (the dashboard shows none), so this binding
 * observes them in the logs rather than inventing storage no one reads.
 * Cheap scalars (`unarchiveChats`, `locale`) are worth persisting if the
 * dashboard ever surfaces account settings.
 */
module.exports = async ({ u }) => {
  if (!u) return;
  const list = Array.isArray(u) ? u : [u];
  for (const ev of list) {
    if (!ev?.setting) continue;
    // Protobuf action objects are large — log the setting name and only a
    // compact summary of the value.
    const v = ev.value;
    const summary =
      v == null ? null : typeof v === 'object' ? Object.keys(v).slice(0, 6).join(',') : v;
    logger.info({ setting: ev.setting, value: summary }, 'account setting synced');
    // v1.21.0 — settings history (queryable via GET /api/history/settings).
    await recordTimeline(safeGetStore(), {
      domain: 'settings',
      entityId: ev.setting,
      field: 'setting',
      newValue: summary == null ? null : String(summary),
      source: 'settings.update',
    });
  }
};
