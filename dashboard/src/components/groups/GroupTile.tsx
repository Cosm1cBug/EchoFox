/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — single group card. Renders subject, JID short-id,
// participant count, and an active-status dot driven by the
// `active` boolean from the enriched /api/groups response.
//
// Clicking the tile invokes onClick(jid) which the parent uses to
// switch into drill-down detail mode.

interface Group {
  jid: string;
  subject?: string;
  participantCount?: number;
  active?: boolean | null;
  lastHumanMsgTs?: number | null;
  inactiveAfterDays?: number;
}

interface Props {
  group: Group;
  onClick: (jid: string) => void;
}

function fmtRelativeTs(tsSec: number | null | undefined): string {
  if (!tsSec) return "never";
  const ageSec = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (ageSec < 60) return `${ageSec}s ago`;
  if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
  return `${Math.floor(ageSec / 86400)}d ago`;
}

export function GroupTile({ group, onClick }: Props) {
  // Three states:
  //   active === true  → green dot, recent activity
  //   active === false → red dot, no human msgs in `inactiveAfterDays` days
  //   active === null  → grey dot, we have no message data (fresh install,
  //                       redis store, or just-joined group)
  const dotColour =
    group.active === true
      ? "bg-emerald-400 shadow-emerald-400/40"
      : group.active === false
        ? "bg-rose-500 shadow-rose-500/40"
        : "bg-slate-500 shadow-slate-500/30";
  const dotLabel =
    group.active === true
      ? "Active"
      : group.active === false
        ? `Inactive (${group.inactiveAfterDays || 14}d+ silence)`
        : "Unknown";

  const subject = group.subject || "(no subject)";
  const jidShort = group.jid.split("@")[0];

  return (
    <button
      type="button"
      onClick={() => onClick(group.jid)}
      className="group flex w-full flex-col rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-left transition-all hover:border-white/10 hover:bg-slate-900/70 hover:shadow-lg"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3
          className="line-clamp-2 flex-1 text-sm font-semibold text-slate-100 group-hover:text-white"
          title={subject}
        >
          {subject}
        </h3>
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow ${dotColour}`}
          title={dotLabel}
        />
      </div>

      <div className="mt-auto space-y-1 text-xs text-slate-400">
        <div className="flex items-center justify-between">
          <span>👥 {group.participantCount ?? "?"} members</span>
          <span title={group.lastHumanMsgTs ? new Date(group.lastHumanMsgTs * 1000).toISOString() : ""}>
            🕒 {fmtRelativeTs(group.lastHumanMsgTs)}
          </span>
        </div>
        <div className="truncate font-mono text-[10px] text-slate-500" title={group.jid}>
          {jidShort}
        </div>
      </div>
    </button>
  );
}
