/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
'use strict';

/**
 * Group settings event-log schema.
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Append-only log of every detected change to a tracked group     │
 *   │  setting. Rows look like:                                        │
 *   │                                                                  │
 *   │    jid       — group JID (id of the group)                       │
 *   │    field     — one of TRACKED_FIELDS (see below)                 │
 *   │    old_value — stringified previous value (or null)              │
 *   │    new_value — stringified new value (or null)                   │
 *   │    actor     — JID who made the change (when Baileys tells us)   │
 *   │    ts        — unix seconds                                      │
 *   │                                                                  │
 *   │  Values are always coerced to string for uniform storage.        │
 *   │  Booleans serialise as 'true' / 'false'. Numbers as their        │
 *   │  decimal string. Null/undefined → null in the DB.                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Tracked fields (7) — covering everything SettingsPanel.tsx shows:
 *   subject              — group name
 *   desc                 — group description
 *   announce             — "only admins can send" mode
 *   restrict             — "only admins can edit group info" mode
 *   ephemeralDuration    — disappearing-messages timer in seconds
 *   memberAddMode        — "all members can add new members" mode
 *   joinApprovalMode     — "approve new members" mode
 *
 * Actor capture is best-effort:
 *   subject/desc usually arrive with subjectOwner/descOwner populated.
 *   announce/restrict/ephemeralDuration/memberAddMode/joinApprovalMode
 *   often don't have an actor attached — we write null in that case.
 *
 * Use cases:
 *   - GET /api/groups/:jid/settings/history — drill-down panel
 *   - Bundled into GET /api/groups/:jid/full alongside meta + participants
 *   - Future: anomaly detection ("this group changed name 5 times in 1 hour")
 */

const TRACKED_FIELDS = Object.freeze([
  'subject',
  'desc',
  'announce',
  'restrict',
  'ephemeralDuration',
  'memberAddMode',
  'joinApprovalMode',
]);

const TRACKED_FIELDS_SET = new Set(TRACKED_FIELDS);

/**
 * Coerce any value to a stable string representation suitable for storage
 * + equality comparison. null / undefined → null (intentional).
 */
function serialise(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  // Last resort: best-effort JSON. Should rarely fire for tracked fields.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Compare two values for "did this setting actually change?" purposes.
 * Uses serialised form so 0 vs '0' don't trigger spurious events.
 */
function isChanged(oldValue, newValue) {
  return serialise(oldValue) !== serialise(newValue);
}

/**
 * Diff two GroupMetadata-shaped objects (old vs new) and return a list
 * of { field, oldValue, newValue } records for every tracked field that
 * differs. If `oldMeta` is null/undefined treat every defined field in
 * newMeta as a brand-new value (for initial snapshots).
 */
function diff(oldMeta, newMeta) {
  if (!newMeta) return [];
  const out = [];
  for (const f of TRACKED_FIELDS) {
    const nv = newMeta[f];
    if (!oldMeta) {
      if (nv !== undefined && nv !== null) {
        out.push({ field: f, oldValue: null, newValue: nv });
      }
      continue;
    }
    const ov = oldMeta[f];
    // Only emit an event when BOTH sides have a value AND they differ,
    // OR the value transitioned from defined→undefined or vice versa.
    // We do NOT emit events for undefined→undefined.
    if (nv === undefined && ov === undefined) continue;
    if (isChanged(ov, nv)) {
      out.push({ field: f, oldValue: ov ?? null, newValue: nv ?? null });
    }
  }
  return out;
}

/**
 * Extract the actor JID for a given field from the merged old+new
 * metadata blob. Returns null when Baileys didn't tell us.
 *
 *   subject → subjectOwner
 *   desc    → descOwner
 *   else    → null (Baileys doesn't surface actors for these)
 */
function actorForField(field, newMeta) {
  if (!newMeta) return null;
  if (field === 'subject') return newMeta.subjectOwner || null;
  if (field === 'desc') return newMeta.descOwner || null;
  return null;
}

module.exports = {
  TRACKED_FIELDS,
  TRACKED_FIELDS_SET,
  serialise,
  isChanged,
  diff,
  actorForField,
};
