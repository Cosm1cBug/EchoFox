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

// v1.20.1 (C3): fired whenever a request fails with HTTP 401 so the app can
// drop the dead session and return to the Login screen (e.g. the password
// changed on the server, or the browser's cached Basic credentials are
// wrong). Registered by App.tsx; cleared on unmount.
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

// v1.20.1 (C2): non-2xx responses used to throw a bare Error whose message
// skimmed only `body.error` and discarded the rest of the payload. But
// /api/health and /api/diagnostics answer 503 WITH a rich JSON report
// exactly when the UI needs it (the "Degraded" views). ApiError keeps the
// status and the parsed body so consumers can render them.
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    // Keep `instanceof ApiError` reliable even if the build target is ever
    // downleveled (TypeScript's recommended pattern for Error subclasses).
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

// `init` lets callers issue non-GET requests. Before v1.19.0 this helper
// accepted no second argument, so a caller passing { method: 'POST' } silently
// issued a GET instead — the request "succeeded" with the wrong verb.
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string>) || {}),
  };
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(path, { ...init, headers, credentials: 'include' });
  if (!res.ok) {
    // Surface the server's error code when there is one (e.g. not_connected,
    // text_too_long) instead of a bare status number — and KEEP the parsed
    // body on the thrown error (C2). The body survives even when it has no
    // `error` code: a 503 from /api/health or /api/diagnostics carries the
    // full report the UI is supposed to show.
    let body: unknown = null;
    let detail = '';
    try {
      body = await res.json();
      const code = (body as { error?: unknown } | null)?.error;
      if (typeof code === 'string' && code) detail = ` (${code})`;
    } catch {
      /* non-JSON error body */
    }
    // 401 = the session is dead (bad/revoked credentials) → notify the app
    // before rejecting, so it can clear auth and show the Login screen.
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, `API Error: ${res.status}${detail}`, body);
  }
  return res.json();
}

export const getHealth = () => fetchJson('/api/health');
export const getStats = () => fetchJson('/api/stats');
export const getGroups = () => fetchJson('/api/groups');

// v1.13.0 — bundled drill-down endpoint: meta + participants + history + activity
export const getGroupFull = (jid: string, historyLimit = 200) =>
  fetchJson(`/api/groups/${encodeURIComponent(jid)}/full?historyLimit=${historyLimit}`);

// v1.14.0 — group settings change history (also bundled into getGroupFull)
export const getGroupSettingsHistory = (jid: string, limit = 200) =>
  fetchJson(`/api/groups/${encodeURIComponent(jid)}/settings/history?limit=${limit}`);

export const getDiagnostics = () => fetchJson('/api/diagnostics');
export const getAlerts = () => fetchJson('/api/alerts');
export const getSubscriptions = () => fetchJson('/api/subscriptions');

export const getBlocklist = () => fetchJson('/api/blocklist');

export const getContacts = (limit = 100, offset = 0) =>
  fetchJson(`/api/contacts?limit=${limit}&offset=${offset}`);

export const getConversation = (jid: string, limit = 100) =>
  fetchJson(`/api/conversations/${encodeURIComponent(jid)}/messages?limit=${limit}`);

export const sendMessage = (jid: string, text: string) =>
  fetchJson('/api/conversations/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, text }),
  });

export const getStatuses = (days = 30) => fetchJson(`/api/statuses?days=${days}`);

export const getStatusViewers = (id: string) =>
  fetchJson(`/api/statuses/${encodeURIComponent(id)}/viewers`);

export const getChats = (params?: { limit?: number; offset?: number }) => {
  const query = params
    ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
    : '';
  return fetchJson('/api/chats' + query);
};

// v1.20.2 (M4): full drill-down details for one chat — wired to the
// ChatDetail component from the Chats tab (endpoint predates the client).
export const getChatFull = (jid: string) =>
  fetchJson<{
    jid: string;
    contact: Record<string, unknown> | null;
    presence: Record<string, unknown> | null;
    stats: { sent?: number; received?: number; byType?: Record<string, number> } | null;
    seen: Record<string, unknown> | null;
    commands: unknown[];
    enrichment: Record<string, unknown> | null;
  }>(`/api/chats/${encodeURIComponent(jid)}/full`);

export const getRecentPresence = (limit = 50) => fetchJson(`/api/presence?limit=${limit}`);

export const getLabels = () => fetchJson('/api/labels');

export const getLabelAssociations = (id: string) =>
  fetchJson(`/api/labels/${encodeURIComponent(id)}/associations`);

export const getNewsletters = () => fetchJson('/api/newsletters');

export const getNewsletter = (id: string) =>
  fetchJson(`/api/newsletters/${encodeURIComponent(id)}`);

export const getNewsletterViews = (id: string, limit = 100) =>
  fetchJson(`/api/newsletters/${encodeURIComponent(id)}/views?limit=${limit}`);

export const getAiStats = (days = 30) => fetchJson(`/api/ai/stats?days=${days}`);

export const getAiChats = () => fetchJson('/api/ai/chats');

export const getAiConfig = () => fetchJson('/api/ai/config');

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

// v1.17.0 — admin audit log
export interface AuditEvent {
  id: number | string;
  ts: number;
  actor_jid: string;
  chat_jid: string | null;
  cmd_name: string;
  prefix: string | null;
  args: string | null;
  kind: 'admin' | 'group_admin';
  outcome: 'success' | 'failure' | 'timeout' | 'denied';
  latency_ms: number | null;
}

export const getAudit = (
  opts: { days?: number; limit?: number; offset?: number; actor?: string; cmd?: string } = {},
) => {
  const qs = new URLSearchParams();
  qs.set('days', String(opts.days ?? 7));
  qs.set('limit', String(opts.limit ?? 100));
  qs.set('offset', String(opts.offset ?? 0));
  if (opts.actor) qs.set('actor', opts.actor);
  if (opts.cmd) qs.set('cmd', opts.cmd);
  return fetchJson<{
    days: number;
    limit: number;
    offset: number;
    actor: string | null;
    cmd: string | null;
    total: number;
    events: AuditEvent[];
  }>(`/api/audit?${qs.toString()}`);
};

export const getAuditStatus = () =>
  fetchJson<{
    retentionDays: number;
    timerActive: boolean;
    lastPruneAt: number | null;
    lastPruneDeleted: number;
    total: number;
  }>('/api/audit/status');

// v1.20.0 — account-level "new chat" message quota (Baileys
// `message-capping.update` → NewChatMessageCapInfo). Powers the
// New-chat quota box on the Overview tab.
export interface NewChatQuotaInfo {
  total_quota: number | null;
  used_quota: number | null;
  cycle_start_timestamp: string | null;
  cycle_end_timestamp: string | null;
  server_sent_timestamp: string | null;
  ote_status: string | null;
  mv_status: string | null;
  capping_status: string | null;
}

export const getMessageCapping = () =>
  fetchJson<{
    available: boolean;
    info: NewChatQuotaInfo | null;
    updatedAt: number | null;
  }>('/api/message-capping');

// v1.21.0 — generic change timeline (dashboard history views). One call
// powers every page's HistoryPanel.
export interface TimelineEvent {
  id: number | string | null;
  domain: string;
  entity_id: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string | null;
  source: string | null;
  ts: number;
}

export const getHistory = (
  domain: string,
  opts: { entity?: string; limit?: number; offset?: number; days?: number } = {},
) => {
  const qs = new URLSearchParams();
  if (opts.entity) qs.set('entity', opts.entity);
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.offset) qs.set('offset', String(opts.offset));
  if (opts.days) qs.set('days', String(opts.days));
  const query = qs.toString();
  return fetchJson<{
    domain: string;
    entity: string | null;
    days: number;
    limit: number;
    offset: number;
    total: number;
    items: TimelineEvent[];
  }>(`/api/history/${encodeURIComponent(domain)}${query ? `?${query}` : ''}`);
};
