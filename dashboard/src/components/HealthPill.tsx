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

import { useEffect, useState } from 'react';
import { getHealth, getAlerts, ApiError } from '../lib/api';

type Health = {
  ok: boolean;
  degraded?: boolean;
  uptime: number;
  version: string;
  backends: { store: string; auth: string; login: string };
  checks?: Record<string, unknown>;
};

type AlertsResponse = { active: Array<{ command: string }> };

function fmtUptime(secs: number): string {
  if (!secs || secs < 0) return '—';
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
  // 'up' = 200 from /api/health; 'degraded' = 503 WITH the health body
  // (server reachable but a check is failing); 'down' = no usable answer
  // (network error, proxy error, or non-JSON body).
  const [status, setStatus] = useState<'up' | 'degraded' | 'down'>('up');

  useEffect(() => {
    let live = true;
    const fetchHealth = async () => {
      try {
        const h = (await getHealth()) as Health;
        if (!live) return;
        setHealth(h);
        setStatus('up');
      } catch (err) {
        if (!live) return;
        // C2: a degraded server answers 503 WITH the same health body
        // (ok:false, degraded:true, checks, backends). Render that state —
        // with what is failing — instead of a bare "down" dot.
        const body = err instanceof ApiError ? (err.body as Health | null) : null;
        if (body && typeof body === 'object' && typeof body.uptime === 'number') {
          setHealth(body);
          setStatus('degraded');
        } else {
          setStatus('down');
        }
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
    return () => {
      live = false;
      clearInterval(h);
      clearInterval(a);
    };
  }, []);

  // Failing checks from a 503 body (values that are explicitly `false`);
  // shown as the pill's tooltip so "degraded" says *what* is degraded.
  const failing =
    status === 'degraded'
      ? Object.entries(health?.checks ?? {})
          .filter(([, v]) => v === false)
          .map(([k]) => k)
      : [];
  const tooltip =
    status === 'degraded'
      ? failing.length > 0
        ? `Failing checks: ${failing.join(', ')}`
        : 'Degraded'
      : undefined;

  const dotColour =
    status === 'up' ? 'bg-emerald-500' : status === 'degraded' ? 'bg-amber-500' : 'bg-red-500';
  const dotPing =
    status === 'up' ? 'bg-emerald-400' : status === 'degraded' ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" title={tooltip}>
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-300 backdrop-blur">
        <span className="relative flex h-2 w-2">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotPing} opacity-75`}
          />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColour}`} />
        </span>
        {status === 'down' ? 'down' : `${status} · ${fmtUptime(health?.uptime ?? 0)}`}
      </div>

      {health && (
        <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-400 backdrop-blur">
          <span className="text-slate-500">v</span>
          <code className="text-slate-300">{health.version}</code>
          <span className="mx-1 text-slate-600">·</span>
          <code className="text-slate-300">
            {health.backends.store}/{health.backends.auth}
          </code>
        </div>
      )}

      {alertCount > 0 && (
        <div className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-red-300 backdrop-blur">
          <span>🚨</span>
          <span className="font-medium">{alertCount}</span>
          <span>alert{alertCount === 1 ? '' : 's'}</span>
        </div>
      )}
    </div>
  );
}
