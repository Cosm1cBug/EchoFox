/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

/**
 * SoakStatus tile — heap-trend mini-bar + leak-suspected indicator.
 *   Reads the heap_used_mb gauge from /api/stats (set by the
 *   leakDetector service every 10 min by default).
 */

import { useEffect, useState } from "react";
import { getStats } from "../lib/api";

type Stats = {
  counters?: Record<string, number>;
  gauges?:   Record<string, number>;
};

export function SoakStatus() {
  const [heapMB, setHeapMB] = useState<number | null>(null);
  const [leak, setLeak] = useState<boolean>(false);
  const [uptimeSecs, setUptimeSecs] = useState<number>(0);

  useEffect(() => {
    let live = true;
    const fetch = async () => {
      try {
        const s = (await getStats()) as Stats;
        if (!live) return;
        const g = s.gauges || {};
        setHeapMB(typeof g.heap_used_mb === 'number' ? g.heap_used_mb : null);
        setLeak(g.leak_suspected === 1);
        setUptimeSecs(typeof g.bot_uptime_seconds === 'number' ? g.bot_uptime_seconds : 0);
      } catch { /* silent */ }
    };
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const verdict = leak
    ? { label: '🔥 Leak suspected', className: 'border-red-500/40 bg-red-500/10 text-red-300' }
    : heapMB == null
      ? { label: 'No data yet',     className: 'border-white/10 bg-white/5 text-slate-400' }
      : { label: 'Heap stable',     className: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' };

  const uptimeStr = (() => {
    if (uptimeSecs < 60) return `${Math.floor(uptimeSecs)}s`;
    const m = Math.floor(uptimeSecs / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  })();

  return (
    <div className={`rounded-lg border p-4 ${verdict.className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs uppercase tracking-wide opacity-70">Soak status</div>
        <div className="text-xs opacity-60">uptime {uptimeStr}</div>
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <div className="font-medium">{verdict.label}</div>
        <div className="text-sm">
          {heapMB != null && (
            <>
              heap <span className="font-mono">{heapMB}</span> MB
            </>
          )}
        </div>
      </div>
    </div>
  );
}