/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — group detail drill-down view.
// Renders the bundled /api/groups/:jid/full response: header card +
// SettingsPanel + ParticipantsList + HistoryTimeline.

import { useEffect, useState } from "react";
import { getGroupFull } from "../../lib/api";
import { Loading, ErrorMessage } from "../LoadingError";
import { SettingsPanel } from "./SettingsPanel";
import { SettingsHistory } from "./SettingsHistory";
import { ParticipantsList } from "./ParticipantsList";
import { HistoryTimeline } from "./HistoryTimeline";

interface Props {
  jid: string;
  onBack: () => void;
}

interface FullResponse {
  jid: string;
  meta: any;
  participants: any[];
  history: any[];
  settingsHistory: any[];
  lastHumanMsgTs: number | null;
  active: boolean | null;
  inactiveAfterDays: number;
}

function fmtRel(tsSec: number | null): string {
  if (!tsSec) return "never";
  const age = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

export function GroupDetail({ jid, onBack }: Props) {
  const [data, setData] = useState<FullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGroupFull(jid)
      .then((d: any) => {
        if (!cancelled) setData(d as FullResponse);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load group");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jid]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const dotColour =
    data.active === true
      ? "bg-emerald-400 shadow-emerald-400/40"
      : data.active === false
        ? "bg-rose-500 shadow-rose-500/40"
        : "bg-slate-500";
  const dotLabel =
    data.active === true
      ? "Active"
      : data.active === false
        ? `Inactive (${data.inactiveAfterDays}d+ silence)`
        : "Unknown — no message data";

  const subject = data.meta?.subject || "(no subject)";
  const participantCount = data.participants?.length || 0;

  return (
    <div>
      {/* Back button */}
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-100"
      >
        ← Back to groups
      </button>

      {/* Header card */}
      <div className="mb-6 rounded-2xl border border-white/5 bg-slate-900/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full shadow ${dotColour}`}
                title={dotLabel}
              />
              <span className="text-xs uppercase tracking-wide text-slate-400">
                {dotLabel}
              </span>
            </div>
            <h2 className="break-words text-2xl font-semibold text-slate-100">
              {subject}
            </h2>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{data.jid}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Participants" value={String(participantCount)} />
          <Stat
            label="Events recorded"
            value={String(data.history?.length || 0)}
          />
          <Stat
            label="Last human message"
            value={fmtRel(data.lastHumanMsgTs)}
          />
          <Stat
            label="Inactive threshold"
            value={`${data.inactiveAfterDays} days`}
          />
        </div>
      </div>

      {/* Two-column body */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <SettingsPanel meta={data.meta} />
          <SettingsHistory events={data.settingsHistory || []} />
        </div>
        <div className="space-y-6">
          <ParticipantsList
            participants={data.participants}
            metaParticipants={data.meta?.participants || []}
          />
          <HistoryTimeline events={data.history} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-slate-100" title={value}>
        {value}
      </div>
    </div>
  );
}
