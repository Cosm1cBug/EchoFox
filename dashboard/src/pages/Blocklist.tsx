/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getBlocklist } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type BlockEntry = {
  jid: string;
  added_at: number | null;
};

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  // Heuristic: <10^12 → seconds, else ms (sqlite uses seconds, others ms)
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

export function Blocklist() {
  const [data, setData] = useState<BlockEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const result = await getBlocklist();
      setData(result as BlockEntry[]);
      setError(null);
    } catch {
      setError("Failed to load blocklist");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">🚫 Blocklist</h2>
        <div className="text-xs text-slate-500">
          {data.length} blocked {data.length === 1 ? "contact" : "contacts"}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
          No contacts are blocked.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3">Phone / JID</th>
                <th className="px-5 py-3">Full JID</th>
                <th className="px-5 py-3 text-right">Blocked at</th>
              </tr>
            </thead>
            <tbody>
              {data.map((entry) => (
                <tr key={entry.jid} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-5 py-3 font-mono text-sm">{fmtJid(entry.jid)}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{entry.jid}</td>
                  <td className="px-5 py-3 text-right text-xs text-slate-400 tabular-nums">{fmtTs(entry.added_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-500">
        Auto-refreshes every 30 seconds. Updates appear here when the bot receives
        <code className="mx-1 rounded bg-white/10 px-1 py-0.5">blocklist.set</code>
        or <code className="mx-1 rounded bg-white/10 px-1 py-0.5">blocklist.update</code> events.
      </div>
    </div>
  );
}
