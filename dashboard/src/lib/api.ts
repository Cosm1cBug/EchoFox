/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
let authHeader: string | null = null;

export function setAuth(username: string, password: string) {
  const token = btoa(`${username}:${password}`);
  authHeader = `Basic ${token}`;
}

export function clearAuth() {
  authHeader = null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const headers: HeadersInit = {};
  if (authHeader) headers["Authorization"] = authHeader;

  const res = await fetch(path, { headers, credentials: "include" });
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

export const getHealth = () => fetchJson("/api/health");
export const getStats = () => fetchJson("/api/stats");
export const getGroups = () => fetchJson("/api/groups");

// v1.13.0 — bundled drill-down endpoint: meta + participants + history + activity
export const getGroupFull = (jid: string, historyLimit = 200) =>
  fetchJson(`/api/groups/${encodeURIComponent(jid)}/full?historyLimit=${historyLimit}`);

// v1.14.0 — group settings change history (also bundled into getGroupFull)
export const getGroupSettingsHistory = (jid: string, limit = 200) =>
  fetchJson(`/api/groups/${encodeURIComponent(jid)}/settings/history?limit=${limit}`);

export const getDiagnostics = () => fetchJson("/api/diagnostics");
export const getAlerts = () => fetchJson("/api/alerts");
export const getSubscriptions = () => fetchJson("/api/subscriptions");

export const getBlocklist = () => fetchJson("/api/blocklist");

export const getContacts = (limit = 100, offset = 0) =>
  fetchJson(`/api/contacts?limit=${limit}&offset=${offset}`);

export const getContact = (jid: string) =>
  fetchJson(`/api/contacts/${encodeURIComponent(jid)}`);

export const getChats = () => fetchJson("/api/chats");

export const getChat = (jid: string) =>
  fetchJson(`/api/chats/${encodeURIComponent(jid)}`);

export const getRecentPresence = (limit = 50) =>
  fetchJson(`/api/presence?limit=${limit}`);

export const getPresence = (jid: string) =>
  fetchJson(`/api/presence/${encodeURIComponent(jid)}`);

export const getChatPresence = (jid: string) =>
  fetchJson(`/api/chats/${encodeURIComponent(jid)}/presence`);

export const getLabels = () => fetchJson("/api/labels");

export const getLabelAssociations = (id: string) =>
  fetchJson(`/api/labels/${encodeURIComponent(id)}/associations`);

export const getChatLabels = (jid: string) =>
  fetchJson(`/api/chats/${encodeURIComponent(jid)}/labels`);

export const getNewsletters = () => fetchJson("/api/newsletters");

export const getNewsletter = (id: string) =>
  fetchJson(`/api/newsletters/${encodeURIComponent(id)}`);

export const getNewsletterViews = (id: string, limit = 100) =>
  fetchJson(`/api/newsletters/${encodeURIComponent(id)}/views?limit=${limit}`);

export const getNewsletterReactions = (id: string, msgId: string) =>
  fetchJson(`/api/newsletters/${encodeURIComponent(id)}/${encodeURIComponent(msgId)}/reactions`);

export const getLidMapping = (lid: string) =>
  fetchJson(`/api/lid-mapping/${encodeURIComponent(lid)}`);

export const getAiStats = (days = 30) =>
  fetchJson(`/api/ai/stats?days=${days}`);

export const getAiChats = () => fetchJson("/api/ai/chats");

export const getAiConfig = () => fetchJson("/api/ai/config");

// v1.16.0 — leaderboard tab
export const getLeaderboard = (days = 7, limit = 10) =>
  fetchJson<{
    days: number;
    limit: number;
    generatedAt: number;
    users: Array<{ jid: string; xp: number; last_at: number }>;
  }>(`/api/leaderboard?days=${days}&limit=${limit}`);

// v1.16.0 — Overview most-changed-groups card
export const getMostChangedGroups = (days = 7, limit = 5) =>
  fetchJson<{
    days: number;
    limit: number;
    generatedAt: number;
    groups: Array<{ jid: string; count: number; subject: string | null }>;
  }>(`/api/stats/most-changed-groups?days=${days}&limit=${limit}`);

// v1.16.0 — field-scoped settings history filter (when `field` is omitted, returns ALL)
export const getGroupSettingsHistoryFiltered = (
  jid: string,
  opts: { field?: string | null; limit?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (opts.field) qs.set("field", opts.field);
  qs.set("limit", String(opts.limit ?? 200));
  return fetchJson<{
    jid: string;
    field: string | null;
    events: Array<{
      id: number | string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      actor: string | null;
      ts: number;
    }>;
  }>(`/api/groups/${encodeURIComponent(jid)}/settings/history?${qs.toString()}`);
};
