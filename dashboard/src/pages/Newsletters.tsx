/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getNewsletters, getNewsletter, getNewsletterViews } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type Newsletter = {
  newsletter_id: string;
  name: string | null;
  description: string | null;
  picture_url: string | null;
  verification: string | null;
  subscribers: number;
  created_at: number;
  updated_at: number;
};

type NewsletterDetail = Newsletter & {
  meta: Record<string, unknown> | null;
  settings: Record<string, unknown> | null;
};

type ViewEntry = {
  message_id: string;
  view_count: number;
  updated_at: number;
};

function fmtTs(ts: number | null): string {
  if (!ts) return "—";
  const ms = ts < 1e12 ? ts * 1000 : ts;
  return new Date(ms).toLocaleString();
}

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function Newsletters() {
  const [list, setList] = useState<Newsletter[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<NewsletterDetail | null>(null);
  const [views, setViews] = useState<ViewEntry[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = async () => {
    try {
      const result = await getNewsletters();
      setList(result as Newsletter[]);
      setError(null);
    } catch {
      setError("Failed to load newsletters");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
    const id = setInterval(fetchList, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null); setViews(null);
      return;
    }
    setDetailLoading(true);
    Promise.all([
      getNewsletter(selected).then((r) => setDetail(r as NewsletterDetail)).catch(() => setDetail(null)),
      getNewsletterViews(selected, 50).then((r) => setViews(r as ViewEntry[])).catch(() => setViews([])),
    ]).finally(() => setDetailLoading(false));
  }, [selected]);

  if (loading && !list) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!list) return null;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">📰 Newsletters</h2>
        <div className="text-xs text-slate-500">
          {list.length} {list.length === 1 ? "newsletter" : "newsletters"}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
          No newsletters tracked yet. Newsletters appear here when the bot
          receives a <code className="rounded bg-white/10 px-1">newsletter.upsert</code>
          event (e.g. after following one).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Newsletter list */}
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <div className="border-b border-white/10 px-5 py-3 text-xs text-slate-500">All newsletters</div>
            <ul className="divide-y divide-white/5">
              {list.map((n) => (
                <li
                  key={n.newsletter_id}
                  onClick={() => setSelected(n.newsletter_id)}
                  className={`flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-white/5 ${
                    selected === n.newsletter_id ? "bg-white/10" : ""
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{n.name || "(unnamed)"}</span>
                      {n.verification === "VERIFIED" && (
                        <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-xs text-blue-300" title="Verified">✓</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-slate-500">{n.newsletter_id}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium tabular-nums">{fmtNumber(n.subscribers)}</div>
                    <div className="text-xs text-slate-500">subs</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Detail panel */}
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <div className="border-b border-white/10 px-5 py-3 text-xs text-slate-500">
              {selected ? "Details + view counts" : "Click a newsletter for details"}
            </div>

            {selected && detailLoading && <Loading />}

            {selected && detail && (
              <div className="p-5">
                <h3 className="text-lg font-semibold">{detail.name || "(unnamed)"}</h3>
                {detail.description && (
                  <p className="mt-1 text-sm text-slate-300">{detail.description}</p>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">Subscribers</dt>
                    <dd className="font-mono text-sm">{fmtNumber(detail.subscribers)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Verification</dt>
                    <dd className="font-mono">{detail.verification || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Created</dt>
                    <dd className="font-mono text-slate-300">{fmtTs(detail.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Last update</dt>
                    <dd className="font-mono text-slate-300">{fmtTs(detail.updated_at)}</dd>
                  </div>
                </dl>

                {detail.settings && Object.keys(detail.settings).length > 0 && (
                  <div className="mt-4 rounded-md bg-black/40 p-3">
                    <div className="text-xs text-slate-500">Per-user settings</div>
                    <pre className="mt-1 overflow-x-auto text-xs text-slate-300">{JSON.stringify(detail.settings, null, 2)}</pre>
                  </div>
                )}

                {views && views.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 text-xs text-slate-500">View counts (top messages)</div>
                    <table className="w-full text-xs">
                      <thead className="text-left text-slate-500">
                        <tr>
                          <th className="px-2 py-1">Message ID</th>
                          <th className="px-2 py-1 text-right">Views</th>
                          <th className="px-2 py-1 text-right">Last update</th>
                        </tr>
                      </thead>
                      <tbody>
                        {views.slice(0, 10).map((v) => (
                          <tr key={v.message_id} className="border-t border-white/5">
                            <td className="px-2 py-1 font-mono text-slate-300">{v.message_id}</td>
                            <td className="px-2 py-1 text-right font-mono">{fmtNumber(v.view_count)}</td>
                            <td className="px-2 py-1 text-right text-slate-500">{fmtTs(v.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {views.length > 10 && (
                      <div className="mt-2 text-xs text-slate-500">
                        … and {views.length - 10} more messages
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!selected && (
              <div className="p-8 text-center text-sm text-slate-500">
                Select a newsletter from the left for details + view counts.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
