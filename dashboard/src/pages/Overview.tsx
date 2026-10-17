/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getStats } from "../lib/api";
import { TopCommandsChart } from "../components/Chart/TopCommandsChart";
import { MessageTrendChart } from "../components/Chart/MessageTrendChart";
import { SoakStatus } from "../components/SoakStatus";
import { Loading, ErrorMessage } from "../components/LoadingError";

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
      setError("Failed to fetch dashboard data");
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
    .filter(([key]) => key.startsWith("commands_per_name__"))
    .map(([key, value]) => ({
      name: key.replace("commands_per_name__", ""),
      count: Number(value),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const messageTrend = [
    { time: "00:00", sent: 120, received: 340 },
    { time: "06:00", sent: 280, received: 410 },
    { time: "12:00", sent: 450, received: 620 },
    { time: "18:00", sent: 390, received: 580 },
    { time: "23:59", sent: 210, received: 310 },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Messages processed" value="—" detail="Total messages" />
        <MetricCard label="Commands run (24h)" value="—" detail="Command activity" />
        <MetricCard label="Active groups" value="—" detail="Currently tracked groups" />
        <MetricCard label="AI cost today" value="—" detail="AI usage statistics" />
        <MetricCard label="Rate-limit hits" value="—" detail="Recorded events" />
      </div>

      <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 p-4 xl:col-span-3">
        <h2 className="mb-1 text-sm font-semibold text-slate-100"> Message volume — last 24 hours </h2>
        <p className="mb-4 text-xs text-slate-400">Message activity over time </p>
        <div className="min-w-0">
          <MessageTrendChart data={messageTrend} />
        </div>
      </div>

      <div className="min-w-0 rounded-lg border border-slate-700 bg-slate-800 p-4 xl:col-span-2">
        <h2 className="mb-1 text-sm font-semibold text-slate-100">Top commands (24h)</h2>
        <p className="mb-4 text-xs text-slate-400">By invocation count</p>
        <div className="min-w-0">
          <TopCommandsChart data={topCommands} />
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-5">
        <section className="min-w-0 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 p-4 xl:col-span-2">
          <h2 className="mb-4 text-sm font-semibold text-slate-100">System status</h2>
          <SoakStatus />
        </section>
      </div>
    </div>
  );
}
