/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.14.0 — group settings change history panel.
// Reads from the new group_settings_events log: every detected change
// to subject / desc / announce / restrict / ephemeralDuration /
// memberAddMode / joinApprovalMode, with actor when Baileys reported it.
//
// Empty state explains that history is captured forwards from the v1.14.0
// upgrade — so freshly-upgraded deployments start with a snapshot row
// per current setting (added by the boot-time seed in worker.js).

interface SettingsEvent {
  id: number | string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor: string | null;
  ts: number;
}

interface Props {
  events: SettingsEvent[];
}

const FIELD_LABELS: Record<string, string> = {
  subject: "Subject",
  desc: "Description",
  announce: "Send messages",
  restrict: "Edit group info",
  ephemeralDuration: "Disappearing messages",
  memberAddMode: "Member add mode",
  joinApprovalMode: "Approve new members",
};

const FIELD_EMOJIS: Record<string, string> = {
  subject: "📝",
  desc: "📄",
  announce: "📢",
  restrict: "🔒",
  ephemeralDuration: "⏱️",
  memberAddMode: "➕",
  joinApprovalMode: "✅",
};

function fmtDate(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleString(undefined, {
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

/**
 * Render a stored value for display. Booleans and ephemeral seconds get
 * pretty-printed; everything else is shown verbatim.
 */
function fmtValue(field: string, value: string | null): string {
  if (value == null) return "—";
  if (field === "announce" || field === "restrict") {
    return value === "true" ? "admins only" : "everyone";
  }
  if (field === "memberAddMode") {
    return value === "true" ? "all members" : "admins only";
  }
  if (field === "joinApprovalMode") {
    return value === "true" ? "on" : "off";
  }
  if (field === "ephemeralDuration") {
    const sec = Number(value);
    if (!sec) return "off";
    if (sec === 86400) return "24 hours";
    if (sec === 604800) return "7 days";
    if (sec === 7776000) return "90 days";
    return `${sec}s`;
  }
  if (field === "subject" || field === "desc") {
    return value.length > 80 ? value.slice(0, 80) + "…" : value;
  }
  return value;
}

export function SettingsHistory({ events }: Props) {
  if (!events.length) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-400">
        <div className="font-medium text-slate-300">No settings changes recorded yet.</div>
        <div className="mt-1 text-xs">
          The bot started capturing settings-change events in v1.14.0. As group
          admins update the subject, description, or modes, entries will appear
          here in real time.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-white/5 bg-slate-900/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-100">
          Settings change history <span className="text-slate-400">({events.length})</span>
        </h3>
        <span className="text-xs text-slate-400">newest first</span>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <ul className="divide-y divide-white/5">
          {events.map((e) => {
            const label = FIELD_LABELS[e.field] || e.field;
            const emoji = FIELD_EMOJIS[e.field] || "•";
            const oldDisp = fmtValue(e.field, e.old_value);
            const newDisp = fmtValue(e.field, e.new_value);
            const byWho = e.actor ? `+${e.actor.split("@")[0]}` : null;
            const isInitial = e.old_value === null;
            return (
              <li key={e.id} className="px-4 py-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="text-base leading-none">{emoji}</span>
                  <div className="flex-1">
                    <div className="text-slate-200">
                      <span className="font-medium">{label}</span>
                      {isInitial ? (
                        <span className="ml-2 text-xs text-slate-400">
                          set to <span className="font-mono text-slate-200">{newDisp}</span>
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-slate-400">
                          <span className="font-mono text-slate-400 line-through">{oldDisp}</span>
                          {" → "}
                          <span className="font-mono text-slate-100">{newDisp}</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500" title={fmtDate(e.ts)}>
                      {fmtAge(e.ts)} · {fmtDate(e.ts)}
                      {byWho && (
                        <>
                          {" · "}by <span className="font-mono">{byWho}</span>
                        </>
                      )}
                      {!byWho && !isInitial && (
                        <span className="ml-1 italic text-slate-600">(actor unknown)</span>
                      )}
                      {isInitial && (
                        <span className="ml-1 italic text-slate-600">(initial snapshot)</span>
                      )}
                    </div>
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
