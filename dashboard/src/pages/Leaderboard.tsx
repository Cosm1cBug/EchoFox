/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.16.0 — Global top-N users-by-XP leaderboard.
//
//   • Window selector: 7d / 30d / 90d / all-time
//   • Limit selector:  10 / 25 / 50
//   • Refreshes once per minute (no polling)
//   • Bot-operator-only view (basic auth required like the rest of /dashboard)
//
// Privacy note: the user JID is shown but trimmed at the @-sign to
// keep the display reasonable. We never show phone numbers in full.

import { useEffect, useMemo, useState } from "react";
import { getLeaderboard } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

interface LeaderboardUser {
  jid: string;
  xp: number;
  last_at: number;
}

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: 36500 },
] as const;

const LIMITS = [10, 25, 50] as const;

const POLL_MS = 60_000;

/* ─── pure helpers (mirror levelingService.describe) ───────────── */

const BASE_THRESHOLD = 100;
const GROWTH_FACTOR = 1.5;
function levelFor(xp: number): number {
  let level = 1;
  let floor = 0;
  let step = BASE_THRESHOLD;
  while (level < 100 && xp >= floor + step) {
    floor += step;
    level += 1;
    step = Math.round(step * GROWTH_FACTOR);
  }
  return level;
}

function fmtJid(jid: string): string {
  return jid.split("@")[0] || jid;
}

function fmtRel(tsSec: number): string {
  if (!tsSec) return "never";
  const age = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

const RANK_EMOJI: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export function Leaderboard() {
  const [days, setDays] = useState<number>(7);
  const [limit, setLimit] = useState<number>(10);
  const [users, setUsers] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      setError(null);
      getLeaderboard(days, limit)
        .then((d) => {
          if (cancelled) return;
          setUsers(d.users || []);
          setGeneratedAt(d.generatedAt || null);
          setLoading(false);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message || "Failed to load leaderboard");
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
  }, [days, limit]);

  const maxXp = useMemo(
    () => (users.length ? Math.max(...users.map((u) => u.xp)) : 0),
    [users],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">
              🏆 Top users by XP
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Most active users across all chats. Updates every minute.
            </p>
          </div>
          <div className="flex items-center gap-3">
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
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Show
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="rounded-md border border-white/10 bg-slate-950/60 px-2 py-1 text-sm text-slate-100"
              >
                {LIMITS.map((l) => (
                  <option key={l} value={l}>
                    Top {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {generatedAt && (
          <div className="mt-3 text-xs text-slate-500">
            Last refreshed {fmtRel(generatedAt)}
          </div>
        )}
      </div>

      {loading && !users.length && <Loading />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && users.length === 0 && (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-8 text-center text-sm text-slate-400">
          <div className="text-base font-medium text-slate-300">
            No XP recorded yet.
          </div>
          <div className="mt-1 text-xs">
            Run a command in any chat to start earning XP — this leaderboard
            will populate from <code>user_levels</code>.
          </div>
        </div>
      )}

      {users.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          <div className="grid grid-cols-12 gap-2 border-b border-white/5 bg-slate-900/60 px-4 py-2.5 text-xs uppercase tracking-wide text-slate-400">
            <div className="col-span-1">#</div>
            <div className="col-span-6">User</div>
            <div className="col-span-1 text-center">Lvl</div>
            <div className="col-span-3 text-right">XP</div>
            <div className="col-span-1 text-right">Active</div>
          </div>
          <ul className="divide-y divide-white/5">
            {users.map((u, i) => {
              const rank = i + 1;
              const lvl = levelFor(u.xp);
              const widthPct = maxXp > 0 ? Math.max(2, (u.xp / maxXp) * 100) : 0;
              const rankEmoji = RANK_EMOJI[rank] || `#${rank}`;
              return (
                <li
                  key={u.jid}
                  className="relative grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm"
                >
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 -z-0 rounded-r-md bg-gradient-to-r from-indigo-500/10 to-transparent"
                    style={{ width: `${widthPct}%` }}
                  />
                  <div className="z-10 col-span-1 font-mono text-xs text-slate-400">
                    {rankEmoji}
                  </div>
                  <div className="z-10 col-span-6 min-w-0">
                    <div className="truncate font-mono text-sm text-slate-200" title={u.jid}>
                      {fmtJid(u.jid)}
                    </div>
                  </div>
                  <div className="z-10 col-span-1 text-center text-sm font-semibold text-amber-300">
                    {lvl}
                  </div>
                  <div className="z-10 col-span-3 text-right font-mono text-sm text-slate-100">
                    {u.xp.toLocaleString()}
                  </div>
                  <div className="z-10 col-span-1 text-right text-xs text-slate-500" title={u.last_at ? new Date(u.last_at * 1000).toISOString() : ""}>
                    {fmtRel(u.last_at)}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="text-xs text-slate-500">
        XP is earned per successful command run. Categories:{" "}
        <span className="text-slate-400">5 XP</span> (general / tools / convert
        / download / entertainment),{" "}
        <span className="text-slate-400">10 XP</span> (admin / group / user /
        misc / main), <span className="text-slate-400">15 XP</span> (AI). Global
        multiplier and decay configurable via{" "}
        <code className="text-slate-400">config.leveling</code> or{" "}
        <code className="text-slate-400">$leveling</code> admin command.
      </div>
    </div>
  );
}
