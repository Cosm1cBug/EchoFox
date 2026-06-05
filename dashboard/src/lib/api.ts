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
export const getDiagnostics = () => fetchJson("/api/diagnostics");
export const getAlerts = () => fetchJson("/api/alerts");