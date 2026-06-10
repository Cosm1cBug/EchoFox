/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getLabels, getLabelAssociations } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type Label = {
  label_id: string;
  name: string;
  color: number | null;
  deleted: number;
  updated_at: number;
};

type Association = {
  label_id: string;
  target_type: "chat" | "message";
  target_jid: string;
  target_msg_id: string | null;
  associated_at: number;
};

// WhatsApp Business label colors (approximate hex palette by integer index)
const LABEL_COLORS: Record<number, string> = {
  0: "#ef4444",  // red
  1: "#f97316",  // orange
  2: "#eab308",  // yellow
  3: "#22c55e",  // green
  4: "#3b82f6",  // blue
  5: "#8b5cf6",  // purple
  6: "#ec4899",  // pink
  7: "#14b8a6",  // teal
  8: "#84cc16",  // lime
  9: "#94a3b8",  // slate
};

function colorOf(c: number | null): string {
  if (c == null) return "#64748b";
  return LABEL_COLORS[c % 10] || "#64748b";
}

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

export function Labels() {
  const [labels, setLabels] = useState<Label[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [assocs, setAssocs] = useState<Association[] | null>(null);
  const [assocLoading, setAssocLoading] = useState(false);

  const fetchLabels = async () => {
    try {
      const result = await getLabels();
      setLabels(result as Label[]);
      setError(null);
    } catch {
      setError("Failed to load labels");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLabels();
    const id = setInterval(fetchLabels, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) {
      setAssocs(null);
      return;
    }
    setAssocLoading(true);
    getLabelAssociations(selected)
      .then((r) => setAssocs(r as Association[]))
      .catch(() => setAssocs([]))
      .finally(() => setAssocLoading(false));
  }, [selected]);

  if (loading && !labels) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!labels) return null;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">🏷️ Labels</h2>
        <div className="text-xs text-slate-500">
          {labels.length} {labels.length === 1 ? "label" : "labels"} (WhatsApp Business)
        </div>
      </div>

      {labels.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
          No WA Business labels recorded. Labels appear here if your linked
          account is a WhatsApp Business account.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Labels list */}
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <div className="border-b border-white/10 px-5 py-3 text-xs text-slate-500">All labels</div>
            <ul className="divide-y divide-white/5">
              {labels.map((l) => (
                <li
                  key={l.label_id}
                  onClick={() => setSelected(l.label_id)}
                  className={`flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-white/5 ${
                    selected === l.label_id ? "bg-white/10" : ""
                  }`}
                >
                  <span
                    className="inline-block h-4 w-4 rounded"
                    style={{ backgroundColor: colorOf(l.color) }}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{l.name}</div>
                    <div className="font-mono text-xs text-slate-500">{l.label_id}</div>
                  </div>
                  <div className="text-xs text-slate-400">color {l.color ?? "—"}</div>
                </li>
              ))}
            </ul>
          </div>

          {/* Associations panel */}
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <div className="border-b border-white/10 px-5 py-3 text-xs text-slate-500">
              {selected ? `Associations for ${selected}` : "Click a label to view associations"}
            </div>
            {selected && assocLoading && <Loading />}
            {selected && assocs && (
              assocs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">
                  No chats or messages have this label.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-white/10 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2">Type</th>
                      <th className="px-5 py-2">Target</th>
                      <th className="px-5 py-2">Message ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assocs.map((a, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="px-5 py-2 text-xs">
                          <span
                            className={`rounded px-2 py-0.5 ${
                              a.target_type === "chat"
                                ? "bg-blue-500/20 text-blue-300"
                                : "bg-purple-500/20 text-purple-300"
                            }`}
                          >
                            {a.target_type}
                          </span>
                        </td>
                        <td className="px-5 py-2 font-mono text-xs text-slate-300">{fmtJid(a.target_jid)}</td>
                        <td className="px-5 py-2 font-mono text-xs text-slate-500">{a.target_msg_id || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {!selected && (
              <div className="p-8 text-center text-sm text-slate-500">
                Select a label from the left to see its associations.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
