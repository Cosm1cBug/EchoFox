/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

type ChatDetailProps = {
  detail: any;
};

export function ChatDetail({ detail }: ChatDetailProps) {
  if (!detail) return null;

  const {
    contact,
    presence,
    stats,
    seen,
    commands,
    enrichment,
  } = detail;

  return (
    <div className="space-y-8 text-sm">
      {/* Basic Information */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Basic Information</h3>
        <div className="grid grid-cols-2 gap-y-2">
          <div className="text-slate-400">Name</div>
          <div>{contact?.name || contact?.notify || "—"}</div>

          <div className="text-slate-400">Verified Name</div>
          <div>{contact?.verified_name || "—"}</div>

          <div className="text-slate-400">JID</div>
          <div className="font-mono text-xs break-all">{detail.jid}</div>

          <div className="text-slate-400">LID</div>
          <div className="font-mono text-xs break-all">
            {detail.jid.includes("@lid") ? detail.jid : "—"}
          </div>
        </div>
      </div>

      {/* Presence */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Presence</h3>
        <div>
          Status: <span className="font-medium">{presence?.state || "unknown"}</span>
          <br />
          Last Seen: {presence?.last_seen_ts 
            ? new Date(presence.last_seen_ts * 1000).toLocaleString() 
            : "—"}
        </div>
      </div>

      {/* Message Statistics */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Message Statistics</h3>
        <div>
          <p>Sent: <span className="font-mono">{stats?.sent || 0}</span></p>
          <p>Received: <span className="font-mono">{stats?.received || 0}</span></p>

          {stats?.byType && Object.keys(stats.byType).length > 0 && (
            <div className="mt-2">
              <p className="text-slate-400 mb-1">By Message Type:</p>
              <ul className="pl-4 list-disc">
                {Object.entries(stats.byType).map(([type, count]) => (
                  <li key={type}>
                    {type}: <span className="font-mono">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Command Usage */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Command Usage</h3>
        {commands && commands.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-white/10">
                <th className="py-1">Command</th>
                <th className="py-1 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((cmd: any, index: number) => (
                <tr key={index} className="border-b border-white/10">
                  <td className="py-1">{cmd.command}</td>
                  <td className="py-1 text-right font-mono">{cmd.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-400">No command usage recorded.</p>
        )}
      </div>

      {/* Phone Enrichment */}
      {enrichment && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Phone Information</h3>
          <div className="grid grid-cols-2 gap-y-1">
            <div className="text-slate-400">Country</div>
            <div>{enrichment.country || "—"}</div>

            <div className="text-slate-400">Country Code</div>
            <div>{enrichment.countryCode || "—"}</div>

            <div className="text-slate-400">National Number</div>
            <div>{enrichment.nationalNumber || "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
