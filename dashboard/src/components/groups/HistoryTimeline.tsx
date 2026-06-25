/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — chronological event log of every participant change.
// Renders the append-only group_participants_events feed: who, what,
// when. Newest-first.
//
// The 9 action types from src/store/schema/participants.js:
//   add | join | leave | kick | promote | demote
//   request | approve | reject

interface Event {
  participant: string;
  action: string;
  actor?: string | null;
  ts: number;
}

interface Props {
  events: Event[];
}

const ACTION_META: Record<string, { emoji: string; label: string; colour: string }> = {
  add: { emoji: "➕", label: "added", colour: "text-emerald-300" },
  join: { emoji: "🚪", label: "joined", colour: "text-emerald-300" },
  leave: { emoji: "👋", label: "left", colour: "text-amber-300" },
  kick: { emoji: "🚫", label: "kicked", colour: "text-rose-300" },
  promote: { emoji: "⭐", label: "promoted to admin", colour: "text-orange-300" },
  demote: { emoji: "⬇️", label: "demoted", colour: "text-slate-400" },
  request: { emoji: "📥", label: "requested to join", colour: "text-sky-300" },
  approve: { emoji: "✅", label: "approved", colour: "text-emerald-300" },
  reject: { emoji: "❌", label: "rejected", colour: "text-rose-300" },
};

function fmtDate(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAge(tsSec: number): string {
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  if (ageSec < 86400 * 30) return `${Math.floor(ageSec / 86400)}d ago`;
  return `${Math.floor(ageSec / (86400 * 30))}mo ago`;
}

export function HistoryTimeline({ events }: Props) {
  if (!events.length) {
    return (
      <p className="rounded-xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-400">
        No participant events recorded yet. (Events accumulate as people join, leave,
        get promoted, etc. — this view will populate over time.)
      </p>
    );
  }

  // Events come pre-sorted newest-first from /api/groups/:jid/full
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-white/5 bg-slate-900/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-100">
          Participant history <span className="text-slate-400">({events.length})</span>
        </h3>
        <span className="text-xs text-slate-400">newest first</span>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <ul className="divide-y divide-white/5">
          {events.map((e, i) => {
            const meta = ACTION_META[e.action] || {
              emoji: "•",
              label: e.action,
              colour: "text-slate-300",
            };
            const who = `+${e.participant.split("@")[0]}`;
            const byWho = e.actor ? `+${e.actor.split("@")[0]}` : null;

            return (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 text-base leading-none">{meta.emoji}</span>
                <div className="flex-1 text-sm">
                  <div className="text-slate-200">
                    <span className="font-mono text-xs text-slate-300">{who}</span>
                    <span className={`ml-2 ${meta.colour}`}>{meta.label}</span>
                    {byWho && byWho !== who && (
                      <span className="ml-2 text-xs text-slate-400">
                        by <span className="font-mono">{byWho}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500" title={fmtDate(e.ts)}>
                    {fmtAge(e.ts)} · {fmtDate(e.ts)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
