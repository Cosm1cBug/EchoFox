/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.16.0 — persisted mute history panel.
// Reads from /api/groups/:jid/full → muteHistory (added in v1.16.0).
// Backed by the mutes table created in v1.15.0.

interface MuteEvent {
  id: number | string;
  chat_jid: string;
  user_jid: string;
  created_at: number;
  expires_at: number;
  by_jid: string | null;
  reason: string | null;
  unmuted_at: number | null;
}

interface Props {
  events: MuteEvent[];
}

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
  const age = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  if (age < 86400 * 30) return `${Math.floor(age / 86400)}d ago`;
  return `${Math.floor(age / (86400 * 30))}mo ago`;
}

function fmtDuration(sec: number): string {
  if (sec <= 0) return "—";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtJid(jid: string): string {
  return jid.split("@")[0] || jid;
}

function statusBadge(e: MuteEvent): { label: string; cls: string } {
  const now = Math.floor(Date.now() / 1000);
  if (e.unmuted_at != null) {
    return {
      label: `unmuted ${fmtAge(e.unmuted_at)}`,
      cls: "bg-slate-700/60 text-slate-300",
    };
  }
  if (e.expires_at <= now) {
    return {
      label: `expired ${fmtAge(e.expires_at)}`,
      cls: "bg-slate-700/40 text-slate-400",
    };
  }
  return {
    label: `active until ${fmtDate(e.expires_at)}`,
    cls: "bg-rose-500/20 text-rose-200",
  };
}

export function MuteHistory({ events }: Props) {
  if (!events.length) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-400">
        <div className="font-medium text-slate-300">No mute history recorded.</div>
        <div className="mt-1 text-xs">
          Mute persistence shipped in v1.15.0. Once an admin uses{" "}
          <code className="text-slate-300">.mute @user 30m</code> in this group,
          entries will appear here in real time.
        </div>
      </div>
    );
  }

  const activeCount = events.filter((e) => {
    const now = Math.floor(Date.now() / 1000);
    return e.unmuted_at == null && e.expires_at > now;
  }).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-white/5 bg-slate-900/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-100">
          Mute history <span className="text-slate-400">({events.length})</span>
          {activeCount > 0 && (
            <span className="ml-2 rounded-full bg-rose-500/20 px-2 py-0.5 text-xs font-medium text-rose-200">
              {activeCount} active
            </span>
          )}
        </h3>
        <span className="text-xs text-slate-400">newest first</span>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <ul className="divide-y divide-white/5">
          {events.map((e) => {
            const badge = statusBadge(e);
            const durationSec = Math.max(0, e.expires_at - e.created_at);
            return (
              <li key={String(e.id)} className="px-4 py-3 text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="text-base leading-none">🔇</span>
                  <div className="flex-1">
                    <div className="text-slate-200">
                      <span className="font-mono text-slate-100">
                        {fmtJid(e.user_jid)}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        muted for{" "}
                        <span className="font-mono">{fmtDuration(durationSec)}</span>
                        {e.by_jid && (
                          <>
                            {" "}
                            by{" "}
                            <span className="font-mono text-slate-300">
                              {fmtJid(e.by_jid)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    {e.reason && (
                      <div className="mt-0.5 text-xs italic text-slate-400">
                        "{e.reason}"
                      </div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span title={fmtDate(e.created_at)}>
                        {fmtAge(e.created_at)} · {fmtDate(e.created_at)}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${badge.cls}`}>
                        {badge.label}
                      </span>
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
