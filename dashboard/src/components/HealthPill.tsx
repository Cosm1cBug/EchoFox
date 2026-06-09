/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

/**
 * HealthPill — live health-dot + alert pill + version display.
 *   Ports the visual features from the old static dashboard at /
 *   into the React app's header.
 *
 *   Polls /api/health every 5s for uptime + backend info, and
 *   /api/alerts every 10s for the alert count.
 */

import { useEffect, useState } from "react";
import { getHealth, getAlerts } from "../lib/api";

type Health = {
  ok: boolean;
  uptime: number;
  version: string;
  backends: { store: string; auth: string; login: string };
};

type AlertsResponse = { active: Array<{ command: string }> };

function fmtUptime(secs: number): string {
  if (!secs || secs < 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function HealthPill() {
  const [health, setHealth] = useState<Health | null>(null);
  const [alertCount, setAlertCount] = useState<number>(0);
  const [healthy, setHealthy] = useState<boolean>(true);

  useEffect(() => {
    let live = true;
    const fetchHealth = async () => {
      try {
        const h = (await getHealth()) as Health;
        if (!live) return;
        setHealth(h);
        setHealthy(true);
      } catch {
        if (live) setHealthy(false);
      }
    };
    const fetchAlerts = async () => {
      try {
        const a = (await getAlerts()) as AlertsResponse;
        if (live) setAlertCount((a.active || []).length);
      } catch {
        /* ignore — alerts endpoint failure shouldn't degrade the pill */
      }
    };
    fetchHealth();
    fetchAlerts();
    const h = setInterval(fetchHealth, 5000);
    const a = setInterval(fetchAlerts, 10000);
    return () => { live = false; clearInterval(h); clearInterval(a); };
  }, []);

  const dotColour = healthy ? "bg-emerald-500" : "bg-red-500";
  const dotPing   = healthy ? "bg-emerald-400" : "bg-red-400";

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300 backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotPing} opacity-75`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColour}`} />
        </span>
        {healthy ? `up · ${fmtUptime(health?.uptime ?? 0)}` : "down"}
      </div>

      {health && (
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400 backdrop-blur">
          <span className="text-slate-500">v</span>
          <code className="text-slate-300">{health.version}</code>
          <span className="mx-1 text-slate-600">·</span>
          <code className="text-slate-300">{health.backends.store}/{health.backends.auth}</code>
        </div>
      )}

      {alertCount > 0 && (
        <div className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-300 backdrop-blur">
          <span>🚨</span>
          <span className="font-medium">{alertCount}</span>
          <span>alert{alertCount === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}