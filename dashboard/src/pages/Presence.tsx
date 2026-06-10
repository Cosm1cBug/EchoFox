/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getRecentPresence } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type PresenceEntry = {
  jid: string;
  last_state: string | null;
  last_seen_ts: number | null;
  chat_jid: string | null;
  updated_at: number;
};

const STATE_ICONS: Record<string, { icon: string; label: string; className: string }> = {
  composing:    { icon: "💬", label: "typing",    className: "text-emerald-400" },
  recording:    { icon: "🎤", label: "recording", className: "text-amber-400" },
  available:    { icon: "🟢", label: "online",    className: "text-emerald-400" },
  unavailable:  { icon: "⚪", label: "offline",   className: "text-slate-500" },
  paused:       { icon: "⏸",  label: "paused",    className: "text-slate-400" },
};

function getStateDisplay(state: string | null) {
  if (!state) return { icon: "❓", label: "unknown", className: "text-slate-500" };
  return STATE_ICONS[state] || { icon: "❓", label: state, className: "text-slate-400" };
}

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

function fmtRelative(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fmtLastSeen(ts: number | null): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

export function Presence() {
  const [data, setData] = useState<PresenceEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);  // re-render every 10s for relative timestamps

  const fetchData = async () => {
    try {
      const result = await getRecentPresence(100);
      setData(result as PresenceEntry[]);
      setError(null);
    } catch {
      setError("Failed to load presence");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 10_000);
    const tickId = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => { clearInterval(id); clearInterval(tickId); };
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  // Group by state for the summary
  const counts: Record<string, number> = {};
  for (const e of data) {
    const key = e.last_state || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">👁️ Presence</h2>
        <div className="text-xs text-slate-500">
          {data.length} recent {data.length === 1 ? "entry" : "entries"} · auto-refresh 10s
        </div>
      </div>

      {/* Summary chips */}
      {Object.keys(counts).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(counts).map(([state, count]) => {
            const display = getStateDisplay(state);
            return (
              <div
                key={state}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
              >
                <span>{display.icon}</span>
                <span className={display.className}>{display.label}</span>
                <span className="font-mono text-slate-400">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {data.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
          No presence data yet. Populated as users type/record/come online in tracked chats.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          <table className="w-full text-sm" data-tick={tick}>
            <thead className="border-b border-white/10 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">In chat</th>
                <th className="px-5 py-3 text-right">Last update</th>
                <th className="px-5 py-3 text-right">Last seen (real time)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => {
                const display = getStateDisplay(e.last_state);
                return (
                  <tr key={e.jid + "_" + e.updated_at} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1">
                        <span>{display.icon}</span>
                        <span className={`text-xs ${display.className}`}>{display.label}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-300">{fmtJid(e.jid)}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{e.chat_jid ? fmtJid(e.chat_jid) : "—"}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-400">{fmtRelative(e.updated_at)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500 tabular-nums">{fmtLastSeen(e.last_seen_ts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
