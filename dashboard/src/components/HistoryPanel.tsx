/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.21.0 — generic history view for every dashboard page (except Overview).
// Self-contained: fetches GET /api/history/:domain and renders the newest
// rows first. Every domain logged to the store's timeline_events table is
// renderable here — see src/lib/timelineLog.js for the domains wired up.

import { useCallback, useEffect, useState } from "react";
import { getHistory, type TimelineEvent } from "../lib/api";
import { Loading, ErrorMessage } from "./LoadingError";

type Props = {
  domain: string;
  title?: string;
  /** Optional entity filter (e.g. a jid). */
  entity?: string;
  limit?: number;
};

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

function shortJid(jid: string | null): string {
  if (!jid) return "";
  return jid.includes("@") ? jid.split("@")[0] : jid;
}

function Row({ ev }: { ev: TimelineEvent }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/5">
      <td className="px-4 py-2 text-xs text-slate-400 tabular-nums whitespace-nowrap">
        {fmtTs(ev.ts)}
      </td>
      <td className="px-4 py-2 font-mono text-xs">{shortJid(ev.entity_id) || "—"}</td>
      <td className="px-4 py-2 text-xs text-slate-300">{ev.field || "—"}</td>
      <td className="px-4 py-2 text-xs">
        {ev.old_value != null && ev.old_value !== "" ? (
          <span>
            <span className="text-slate-500 line-through">{ev.old_value}</span>
            <span className="mx-1 text-slate-600">→</span>
            <span className="text-slate-200">{ev.new_value ?? "—"}</span>
          </span>
        ) : (
          <span className="text-slate-200">{ev.new_value ?? "—"}</span>
        )}
      </td>
      <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
        {ev.actor ? shortJid(ev.actor) : ""}
      </td>
    </tr>
  );
}

export function HistoryPanel({ domain, title, entity, limit = 50 }: Props) {
  const [items, setItems] = useState<TimelineEvent[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await getHistory(domain, { entity, limit });
      setItems(result.items);
      setTotal(result.total);
      setError(null);
    } catch {
      setError(`Failed to load ${domain} history`);
    } finally {
      setLoading(false);
    }
  }, [domain, entity, limit]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-300">
          {title ?? `📜 ${domain} history`}
        </h3>
        <div className="text-xs text-slate-500">
          {total > 0 ? (
            <>
              {total} event{total === 1 ? "" : "s"} · newest first
            </>
          ) : (
            "no events yet"
          )}
        </div>
      </div>

      {loading && !items ? (
        <Loading />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : !items || items.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-500">
          No history recorded yet — events will appear here as they happen.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">What</th>
                <th className="px-4 py-2">Change</th>
                <th className="px-4 py-2">By</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ev, i) => (
                <Row key={ev.id ?? `${ev.ts}-${i}`} ev={ev} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 text-xs text-slate-600">
        Auto-refreshes every 60 seconds.
      </div>
    </div>
  );
}
