/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */
import { useEffect, useState } from "react";
import { getSubscriptions } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type Subscriber = {
  jid: string;
  last_seen_pulse_ts: number | null;
  meta: { topics?: string[] } | null;
};

type SubscriptionsResponse = Record<string, Subscriber[]>;

const SERVICE_LABELS: Record<string, { name: string; emoji: string }> = {
  alienvault:     { name: "AlienVault",        emoji: "🛡️" },
  thehackersnews: { name: "The Hacker News",   emoji: "📰" },
  rss:            { name: "RSS Feeds",         emoji: "📡" },
  github:         { name: "GitHub",            emoji: "🐙" },
  vtwatch:        { name: "VirusTotal Watch",  emoji: "🦠" },
};

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  // ts is either seconds (sqlite) or ms (alienvault uses ms via Date.now()).
  // Heuristic: anything < 10^12 is seconds, >= is ms.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

export function Subscriptions() {
  const [data, setData] = useState<SubscriptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const result = await getSubscriptions();
      setData(result as SubscriptionsResponse);
      setError(null);
    } catch {
      setError("Failed to fetch subscriptions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000);
    return () => clearInterval(id);
  }, []);

  if (loading && !data) return <Loading />;
  if (error)             return <ErrorMessage message={error} />;
  if (!data)             return null;

  const services = Object.keys(data);
  if (services.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
        No subscription services configured.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {services.map((svc) => {
        const subs = data[svc] || [];
        const label = SERVICE_LABELS[svc] || { name: svc, emoji: "📡" };
        return (
          <div key={svc} className="rounded-lg border border-white/10 bg-white/5">
            <div className="flex items-baseline justify-between border-b border-white/10 px-6 py-3">
              <h2 className="text-base font-semibold text-white">
                {label.emoji} {label.name}
              </h2>
              <span className="rounded-full bg-white/10 px-3 py-0.5 text-xs text-slate-300">
                {subs.length} subscriber{subs.length === 1 ? "" : "s"}
              </span>
            </div>
            {subs.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-slate-500">
                No subscribers yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-white/5">
                    <th className="px-6 py-3 text-left font-medium">Subscriber</th>
                    <th className="px-6 py-3 text-left font-medium">Topic filter</th>
                    <th className="px-6 py-3 text-left font-medium">Last delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((sub) => (
                    <tr key={sub.jid} className="border-b border-white/5 last:border-b-0">
                      <td className="px-6 py-3 font-mono text-xs text-slate-300">
                        {fmtJid(sub.jid)}
                      </td>
                      <td className="px-6 py-3 text-slate-400">
                        {sub.meta?.topics?.length ? (
                          <div className="flex flex-wrap gap-1">
                            {sub.meta.topics.map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-300"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-500 italic">no filter</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-500">
                        {fmtTs(sub.last_seen_pulse_ts)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}