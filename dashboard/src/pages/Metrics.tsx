/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getStats } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

export function Metrics() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStats()
      .then(setData)
      .catch(() => setError("Failed to load metrics."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const counters = Object.entries(data.counters || {});
  const gauges = Object.entries(data.gauges || {});

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="mb-3 text-lg font-semibold">Counters</h3>
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
          {counters.length > 0 ? (
            counters.map(([key, value]: any, i) => (
              <div key={i} className="flex justify-between border-b border-white/5 py-2 text-sm">
                <span className="font-mono text-emerald-400">{key}</span>
                <span>{value}</span>
              </div>
            ))
          ) : (
            <p className="text-slate-400">No counters available.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-semibold">Gauges</h3>
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
          {gauges.length > 0 ? (
            gauges.map(([key, value]: any, i) => (
              <div key={i} className="flex justify-between border-b border-white/5 py-2 text-sm">
                <span className="font-mono text-emerald-400">{key}</span>
                <span>{value}</span>
              </div>
            ))
          ) : (
            <p className="text-slate-400">No gauges available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
