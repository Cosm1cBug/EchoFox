/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — current group settings panel.
// Renders the Baileys GroupMetadata fields the dashboard cares about:
// description, creation timestamp, owner, announce/restrict modes,
// ephemeral message timer, plus a placeholder for the eventual
// settings-change history feature (deferred to v1.14.x — needs a new
// event-log table for the diff stream).

interface GroupMeta {
  id?: string;
  subject?: string;
  subjectOwner?: string;
  subjectTime?: number;
  creation?: number;
  owner?: string;
  desc?: string;
  descOwner?: string;
  descTime?: number;
  announce?: boolean; // true = only admins can send
  restrict?: boolean; // true = only admins can edit info
  ephemeralDuration?: number;
  memberAddMode?: string;
  joinApprovalMode?: boolean;
  size?: number;
}

interface Props {
  meta: GroupMeta;
}

function fmtDate(tsSec?: number): string {
  if (!tsSec) return "—";
  return new Date(tsSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtEphemeral(sec?: number): string {
  if (!sec) return "off";
  if (sec === 86400) return "24 hours";
  if (sec === 604800) return "7 days";
  if (sec === 7776000) return "90 days";
  return `${sec}s`;
}

function shortJid(jid?: string): string {
  if (!jid) return "—";
  return `+${jid.split("@")[0]}`;
}

export function SettingsPanel({ meta }: Props) {
  const rows: Array<{ label: string; value: React.ReactNode; mono?: boolean }> = [
    { label: "Subject", value: meta.subject || "(none)" },
    {
      label: "Subject changed",
      value: meta.subjectTime
        ? `${fmtDate(meta.subjectTime)} by ${shortJid(meta.subjectOwner)}`
        : "—",
    },
    { label: "Description", value: meta.desc || "(none)" },
    {
      label: "Description changed",
      value: meta.descTime
        ? `${fmtDate(meta.descTime)} by ${shortJid(meta.descOwner)}`
        : "—",
    },
    { label: "Created", value: fmtDate(meta.creation) },
    { label: "Owner", value: shortJid(meta.owner), mono: true },
    {
      label: "Send messages",
      value: meta.announce ? "Admins only" : "All participants",
    },
    {
      label: "Edit group info",
      value: meta.restrict ? "Admins only" : "All participants",
    },
    {
      label: "Disappearing messages",
      value: fmtEphemeral(meta.ephemeralDuration),
    },
    {
      label: "Approve new members",
      value: meta.joinApprovalMode ? "On" : "Off",
    },
    {
      label: "Member add mode",
      value: meta.memberAddMode === "admin_add" ? "Admins only" : "All members",
    },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
      <div className="border-b border-white/5 bg-slate-900/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-100">Group settings</h3>
      </div>
      <dl className="divide-y divide-white/5">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 text-sm">
            <dt className="w-44 shrink-0 text-xs uppercase tracking-wide text-slate-500">
              {r.label}
            </dt>
            <dd
              className={`flex-1 text-slate-200 ${r.mono ? "font-mono text-xs" : ""}`}
              style={{ wordBreak: "break-word" }}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-white/5 bg-slate-900/30 px-4 py-2.5 text-xs text-slate-500">
        💡 Settings change history is captured below as admins modify the group.
      </div>
    </div>
  );
}
