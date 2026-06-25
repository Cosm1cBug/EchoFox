/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — rewritten as a tile grid with click-to-drill-down detail view.
// (Originally shipped in v1.13.0 but the file didn't make it through the
//  manual Copy-Item step; restored here in v1.14.0.)
//
// State machine:
//   selectedJid === null  → grid view (auto-refresh every 15s, like Overview)
//   selectedJid !== null  → drill-down detail view for that group
//                            (one-shot fetch, no polling)
//
// The grid honours a simple client-side filter (search by subject) and
// sorts active groups first (active → inactive → unknown), then by
// participant count desc.

import { useEffect, useMemo, useState } from "react";
import { getGroups } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";
import { GroupTile } from "../components/groups/GroupTile";
import { GroupDetail } from "../components/groups/GroupDetail";

interface Group {
  jid: string;
  subject?: string;
  participantCount?: number;
  active?: boolean | null;
  lastHumanMsgTs?: number | null;
  inactiveAfterDays?: number;
}

const POLL_MS = 15000;

export function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Polling fetch — runs every POLL_MS while in grid mode.
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = () => {
      getGroups()
        .then((g: any) => {
          if (!cancelled) {
            setGroups(g as Group[]);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || "Failed to load groups.");
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

  // Filter + sort
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? groups.filter(
          (g) =>
            (g.subject || "").toLowerCase().includes(q) ||
            g.jid.toLowerCase().includes(q),
        )
      : groups;

    return [...filtered].sort((a, b) => {
      const rank = (g: Group) =>
        g.active === true ? 0 : g.active === false ? 2 : 1;
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return (b.participantCount || 0) - (a.participantCount || 0);
    });
  }, [groups, search]);

  // ─── Detail mode ─────────────────────────────────────────────────
  if (selectedJid) {
    return <GroupDetail jid={selectedJid} onBack={() => setSelectedJid(null)} />;
  }

  // ─── Grid mode ───────────────────────────────────────────────────
  if (loading && !groups.length) return <Loading />;
  if (error && !groups.length) return <ErrorMessage message={error} />;

  const activeCount = visible.filter((g) => g.active === true).length;
  const inactiveCount = visible.filter((g) => g.active === false).length;
  const unknownCount = visible.filter((g) => g.active == null).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Groups</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {visible.length} total ·{" "}
            <span className="text-emerald-400">{activeCount} active</span>
            {" · "}
            <span className="text-rose-400">{inactiveCount} inactive</span>
            {unknownCount > 0 && (
              <>
                {" · "}
                <span className="text-slate-500">{unknownCount} unknown</span>
              </>
            )}
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search groups…"
          className="w-full max-w-xs rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-white/20 focus:outline-none sm:w-64"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 px-5 py-12 text-center text-slate-400">
          {groups.length === 0
            ? "No groups found. (Bot may not be a member of any groups yet.)"
            : `No groups match "${search}".`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((g) => (
            <GroupTile
              key={g.jid}
              group={g}
              onClick={(jid) => setSelectedJid(jid)}
            />
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-500">
        Auto-refreshing every {POLL_MS / 1000}s
      </p>
    </div>
  );
}
