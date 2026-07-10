/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.17.0 — Admin audit log tab.
//
//   • Window selector: 1d / 7d / 30d / 90d
//   • Filter by actor JID + command name
//   • Color-coded by outcome (success/failure/timeout/denied)
//   • Color-coded by kind (admin / group_admin)
//   • Bot-operator-only view (dashboard basic-auth gated)
//
// Backed by:
//   GET /api/audit?days=&limit=&offset=&actor=&cmd=
//   GET /api/audit/status

import { useEffect, useMemo, useState } from "react";
import { getAudit, getAuditStatus } from "../lib/api";
import type { AuditEvent } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

const WINDOWS = [
  { label: "1 day", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

const POLL_MS = 30_000;

function fmtRel(tsSec: number): string {
  if (!tsSec) return "—";
  const age = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

function fmtDate(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtJid(jid: string | null): string {
  if (!jid) return "—";
  return jid.split("@")[0] || jid;
}

const OUTCOME_CLS: Record<AuditEvent["outcome"], string> = {
  success: "bg-emerald-500/15 text-emerald-300",
  failure: "bg-rose-500/15 text-rose-300",
  timeout: "bg-amber-500/15 text-amber-300",
  denied: "bg-slate-500/15 text-slate-300",
};

const KIND_CLS: Record<AuditEvent["kind"], string> = {
  admin: "bg-indigo-500/15 text-indigo-300",
  group_admin: "bg-sky-500/15 text-sky-300",
};

export function AuditLog() {
  const [days, setDays] = useState<number>(7);
  const [actorFilter, setActorFilter] = useState<string>("");
  const [cmdFilter, setCmdFilter] = useState<string>("");
  const [appliedActor, setAppliedActor] = useState<string>("");
  const [appliedCmd, setAppliedCmd] = useState<string>("");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [status, setStatus] = useState<{
    retentionDays: number;
    total: number;
    lastPruneAt: number | null;
    lastPruneDeleted: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      setError(null);
      Promise.all([
        getAudit({
          days,
          limit: 200,
          actor: appliedActor || undefined,
          cmd: appliedCmd || undefined,
        }),
        getAuditStatus().catch(() => null),
      ])
        .then(([a, s]) => {
          if (cancelled) return;
          setEvents(a.events || []);
          setTotal(a.total ?? a.events?.length ?? 0);
          if (s) setStatus(s);
          setLoading(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message || "Failed to load audit log");
          setLoading(false);
        });
    };
    setLoading(true);
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [days, appliedActor, appliedCmd]);

  const applyFilters = () => {
    setAppliedActor(actorFilter.trim());
    setAppliedCmd(cmdFilter.trim());
  };

  const clearFilters = () => {
    setActorFilter("");
    setCmdFilter("");
    setAppliedActor("");
    setAppliedCmd("");
  };

  const filterIsActive = !!(appliedActor || appliedCmd);

  // Group by day for visual chunking
  const grouped = useMemo(() => {
    const groups = new Map<string, AuditEvent[]>();
    for (const e of events) {
      const key = new Date(e.ts * 1000).toLocaleDateString();
      const cur = groups.get(key) || [];
      cur.push(e);
      groups.set(key, cur);
    }
    return Array.from(groups.entries());
  }, [events]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">📜 Audit log</h2>
            <p className="mt-1 text-sm text-slate-400">
              Every privileged command invocation — admin <code>$</code> commands +
              group-admin moderation actions. Auto-pruned after{" "}
              <span className="text-slate-300">{status?.retentionDays ?? 90}</span> days.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Window
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-slate-100"
              >
                {WINDOWS.map((w) => (
                  <option key={w.days} value={w.days}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-xs text-slate-400">
            Actor JID
            <input
              type="text"
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              placeholder="e.g. 91xxx@s.whatsapp.net"
              className="mt-1 w-64 rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm font-mono text-slate-100"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-400">
            Command
            <input
              type="text"
              value={cmdFilter}
              onChange={(e) => setCmdFilter(e.target.value)}
              placeholder="e.g. leveling, mute, ai-admin"
              className="mt-1 w-48 rounded-md border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm font-mono text-slate-100"
            />
          </label>
          <button
            type="button"
            onClick={applyFilters}
            className="rounded-md bg-indigo-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Apply
          </button>
          {filterIsActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Clear
            </button>
          )}
          <div className="ml-auto text-xs text-slate-500">
            Showing <span className="text-slate-300">{events.length}</span>
            {filterIsActive ? " (filtered)" : ""}
            {total > events.length && <> of {total}</>}
            {status && (
              <>
                {" · "}prune {status.lastPruneAt ? fmtRel(status.lastPruneAt) : "never"}
                {status.lastPruneDeleted > 0 && ` (-${status.lastPruneDeleted})`}
              </>
            )}
          </div>
        </div>
      </div>

      {loading && !events.length && <Loading />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && events.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          <div className="text-base font-medium text-slate-300">
            No audit events {filterIsActive ? "match the filter" : "in the selected window"}.
          </div>
          <div className="mt-1 text-xs">
            Audit logging started in v1.17.0. As admins use{" "}
            <code>$</code>-prefix commands or group admins perform moderation
            actions, entries will appear here.
          </div>
        </div>
      )}

      {grouped.map(([day, evts]) => (
        <div key={day} className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {day}{" "}
            <span className="text-slate-600">({evts.length} {evts.length === 1 ? "event" : "events"})</span>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <ul className="divide-y divide-white/5">
              {evts.map((e) => (
                <li key={String(e.id)} className="px-4 py-3 text-sm">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${OUTCOME_CLS[e.outcome] || ""}`}
                      title={`outcome: ${e.outcome}`}
                    >
                      {e.outcome}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${KIND_CLS[e.kind] || ""}`}
                      title={`kind: ${e.kind}`}
                    >
                      {e.kind === "group_admin" ? "group" : "bot"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-slate-100">
                        <span className="text-amber-300">{e.prefix || ""}</span>
                        {e.cmd_name}
                        {e.args && (
                          <span className="ml-1 text-slate-400">{e.args}</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        by <span className="font-mono text-slate-300">{fmtJid(e.actor_jid)}</span>
                        {e.chat_jid && (
                          <>
                            {" "}in <span className="font-mono text-slate-400">{fmtJid(e.chat_jid)}</span>
                          </>
                        )}
                        {" · "}
                        <span title={fmtDate(e.ts)}>{fmtRel(e.ts)}</span>
                        {e.latency_ms != null && (
                          <>
                            {" · "}<span className="font-mono">{e.latency_ms}ms</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
