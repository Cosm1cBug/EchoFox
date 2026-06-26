/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.16.0 — Overview tab card: "Most-changed groups this week".
//
// Surfaces the top 5 groups by group_settings_events count over the
// last 7 days. Useful for spotting which groups are getting a lot of
// admin churn (subject changes, restrict/announce toggles, etc).
//
// Lives in components/ rather than pages/ because it's mounted inside
// the Overview page alongside other stats cards.

import { useEffect, useState } from "react";
import { getMostChangedGroups } from "../lib/api";

interface ChangedGroup {
  jid: string;
  count: number;
  subject: string | null;
}

const POLL_MS = 60_000;

export function MostChangedGroups() {
  const [groups, setGroups] = useState<ChangedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      getMostChangedGroups(7, 5)
        .then((d) => {
          if (cancelled) return;
          setGroups(d.groups || []);
          setError(null);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message || "Failed to load");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    fetchOnce();
    const id = setInterval(fetchOnce, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const maxCount = groups.length ? Math.max(...groups.map((g) => g.count)) : 0;

  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-100">
          ⚙️ Most-changed groups
        </h3>
        <span className="text-xs text-slate-400">last 7 days</span>
      </div>

      {loading && !groups.length && (
        <div className="mt-4 h-32 animate-pulse rounded-md bg-slate-800/40" />
      )}

      {error && (
        <div className="mt-4 text-xs text-rose-300">⚠️ {error}</div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="mt-4 text-xs text-slate-400">
          No settings changes recorded across any group in the last 7 days.
        </div>
      )}

      {groups.length > 0 && (
        <ul className="mt-4 space-y-2">
          {groups.map((g) => {
            const widthPct = maxCount > 0 ? Math.max(8, (g.count / maxCount) * 100) : 0;
            const subject = g.subject || "(no subject)";
            const shortJid = g.jid.split("@")[0];
            return (
              <li key={g.jid} className="relative">
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 -z-0 rounded-md bg-indigo-500/10"
                  style={{ width: `${widthPct}%` }}
                />
                <div className="relative z-10 flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200" title={g.jid}>
                      {subject}
                    </div>
                    <div className="truncate font-mono text-[10px] text-slate-500">
                      {shortJid}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-sm font-semibold text-amber-300">
                    {g.count}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
