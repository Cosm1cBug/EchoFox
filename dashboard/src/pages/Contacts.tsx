/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useMemo, useState } from "react";
import { getContacts } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type Contact = {
  jid: string;
  name: string | null;
  notify: string | null;
  img_url: string | null;
  status: string | null;
  verified_name: string | null;
};

type ContactsResponse = {
  items: Contact[];
  total: number;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 50;

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

export function Contacts() {
  const [data, setData] = useState<ContactsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");

  const fetchData = async (off: number) => {
    setLoading(true);
    try {
      const result = await getContacts(PAGE_SIZE, off);
      setData(result as ContactsResponse);
      setError(null);
    } catch {
      setError("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(offset);
  }, [offset]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    if (!q) return data.items;
    return data.items.filter((c) => {
      const name = (c.name || c.notify || c.verified_name || "").toLowerCase();
      return name.includes(q) || c.jid.toLowerCase().includes(q);
    });
  }, [data, search]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">👥 Contacts</h2>
        <div className="text-xs text-slate-500">
          {data.total} total
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter by name or JID (this page only)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-white/30 focus:outline-none"
        />
      </div>

      {data.total === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-slate-400">
          No contacts recorded yet. They populate as the bot receives messages.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Verified Name</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-slate-400">
                      No contacts on this page match the filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.jid} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-5 py-3">
                        <div className="font-medium">{c.name || c.notify || "—"}</div>
                        {c.notify && c.name && c.notify !== c.name && (
                          <div className="text-xs text-slate-500">notify: {c.notify}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-400">{fmtJid(c.jid)}</td>
                      <td className="px-5 py-3 text-xs text-slate-300">{c.verified_name || "—"}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{c.status || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded-md border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>
            <div className="text-xs text-slate-500">
              Page {currentPage} of {totalPages}
            </div>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= data.total}
              className="rounded-md border border-white/10 px-3 py-1.5 text-slate-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
