/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from 'react';
import { getStats } from '../lib/api';
import { TopCommandsChart } from '../components/Chart/TopCommandsChart';
import { MostChangedGroups } from '../components/MostChangedGroups';
import { SoakStatus } from '../components/SoakStatus';
import { NewChatQuota } from '../components/NewChatQuota';
import { Loading, ErrorMessage } from '../components/LoadingError';

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 p-4">
      {' '}
      <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}{' '}
      </p>{' '}
      <p className="mt-2 text-2xl font-bold text-slate-50">{value} </p>{' '}
      <p className="mt-1 text-xs text-slate-400">{detail} </p>{' '}
    </div>
  );
}

export function Overview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const result = await getStats();
      setData(result);
      setError(null);
    } catch {
      setError('Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const topCommands = Object.entries(data.counters || {})
    .filter(([key]) => key.startsWith('commands_per_name__'))
    .map(([key, value]) => ({
      name: key.replace('commands_per_name__', ''),
      count: Number(value),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // v1.20.2 (H3): wire the cards to the real /api/stats payload (the old
  // version rendered literal "—" placeholders and a hardcoded fake trend).
  // Counters are cumulative since bot start; gauges are current values.
  const counters = (data.counters || {}) as Record<string, unknown>;
  const gauges = (data.gauges || {}) as Record<string, unknown>;
  const num = (v: unknown) => Number(v) || 0;
  const received = num(counters.messages_received_total);
  const sent = num(counters.messages_sent_total);
  const cmdsOk = num(counters.commands_success_total);
  const cmdsFailed = num(counters.commands_failed_total);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Messages processed"
          value={String(received + sent)}
          detail={`${received} in · ${sent} out`}
        />
        <MetricCard
          label="Commands run"
          value={String(num(counters.commands_total))}
          detail={`${cmdsOk} ok · ${cmdsFailed} failed`}
        />
        <MetricCard
          label="Active groups"
          value={String(num(gauges.groups_count))}
          detail="Currently tracked groups"
        />
        <MetricCard
          label="AI cost today"
          value={`$${num(gauges.ai_cost_usd_today).toFixed(2)}`}
          detail="AI usage statistics"
        />
        <MetricCard
          label="Rate-limit hits"
          value={String(num(counters.rate_limit_hits_total))}
          detail="Recorded events"
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-3">
          <MostChangedGroups />
        </div>

        <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 p-4 xl:col-span-2">
          <h2 className="mb-1 text-sm font-semibold text-slate-100">Top commands</h2>
          <p className="mb-4 text-xs text-slate-400">By invocation count (since bot start)</p>
          <div className="min-w-0">
            <TopCommandsChart data={topCommands} />
          </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-5">
        <section className="min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 p-4 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-100">System status</h2>
          <SoakStatus />
        </section>
        <div className="min-w-0 xl:col-span-3">
          <NewChatQuota />
        </div>
      </div>
    </div>
  );
}
