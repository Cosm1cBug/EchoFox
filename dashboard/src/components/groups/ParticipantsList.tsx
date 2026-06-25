/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.13.0 — current participants section of the group detail view.
// Cross-references the current-participants list (from event log)
// against the live Baileys metadata to surface 'admin' / 'superadmin'
// tags. Sorted: admins first (by role), then everyone else alpha by jid.

interface Participant {
  participant: string;
  last_action?: string;
  last_ts?: number;
}

interface MetaParticipant {
  id: string;
  admin?: "admin" | "superadmin" | null;
}

interface Props {
  participants: Participant[];
  metaParticipants?: MetaParticipant[];
}

export function ParticipantsList({ participants, metaParticipants = [] }: Props) {
  // Build a quick adminness lookup from Baileys meta (more authoritative
  // than the event-log's promote/demote chain, which can have gaps).
  const adminMap = new Map<string, "admin" | "superadmin">();
  for (const p of metaParticipants) {
    if (p.admin) adminMap.set(p.id, p.admin);
  }

  // Sort: superadmins → admins → members → alpha within group
  const sorted = [...participants].sort((a, b) => {
    const aRole = adminMap.get(a.participant);
    const bRole = adminMap.get(b.participant);
    const aRank = aRole === "superadmin" ? 0 : aRole === "admin" ? 1 : 2;
    const bRank = bRole === "superadmin" ? 0 : bRole === "admin" ? 1 : 2;
    if (aRank !== bRank) return aRank - bRank;
    return a.participant.localeCompare(b.participant);
  });

  if (!sorted.length) {
    return (
      <p className="rounded-xl border border-white/5 bg-slate-900/40 p-4 text-sm text-slate-400">
        No participants recorded yet.
      </p>
    );
  }

  const adminCount = sorted.filter((p) => adminMap.has(p.participant)).length;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-white/5 bg-slate-900/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-100">
          Current participants <span className="text-slate-400">({sorted.length})</span>
        </h3>
        <span className="text-xs text-slate-400">
          {adminCount} admin{adminCount !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <tbody>
            {sorted.map((p) => {
              const role = adminMap.get(p.participant);
              const phoneShort = p.participant.split("@")[0];
              return (
                <tr key={p.participant} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-slate-300">+{phoneShort}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {role === "superadmin" ? (
                      <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">
                        ⭐ superadmin
                      </span>
                    ) : role === "admin" ? (
                      <span className="inline-flex items-center rounded-md bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-300 ring-1 ring-inset ring-orange-500/30">
                        admin
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">member</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
