/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.19.0 — merged into a single identity card per person.
//
// Backed by GET /api/chats, which returns one row per contact/chat with:
//   savedName    — the name YOU saved them as (contacts.name)
//   pushName     — the name THEY set for themselves (contacts.notify)
//   phoneJid     — @s.whatsapp.net form (when known)
//   lid          — @lid form (when known)
//   firstSeenTs  — oldest inbound message
//   lastSeenTs   — newest inbound message
//   presenceState— available | unavailable | composing | recording | paused
//
// The three-state dot mirrors GroupTile:
//   green  = available / composing / recording  (actively online)
//   red    = unavailable                        (seen, currently offline)
//   grey   = no presence data at all
//
// Presence stickers expire after ~10s in WhatsApp, so "available" only ever
// means "online as of the last update we received".

import { useEffect, useMemo, useState } from "react";
import { getChats } from "../lib/api";

type Chat = {
  jid: string;
  savedName: string | null;
  pushName: string | null;
  phoneJid: string | null;
  lid: string | null;
  firstSeenTs: number | null;
  lastSeenTs: number | null;
  messageCount: number | null;
  presenceState: string | null;
  presenceLastSeenTs: number | null;
  imgUrl?: string | null;
  unread?: number | null;
};

const POLL_MS = 20000;

/** "3d ago" / "2h ago" / "just now" */
function ago(tsSec: number | null | undefined): string {
  if (!tsSec) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function fullDate(tsSec: number | null | undefined): string {
  if (!tsSec) return "unknown";
  return new Date(tsSec * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortJid(jid: string | null | undefined): string {
  if (!jid) return "—";
  return jid.split("@")[0] || jid;
}

type PresKind = "online" | "offline" | "unknown";

function presenceKind(state: string | null | undefined): PresKind {
  if (!state) return "unknown";
  const s = state.toLowerCase();
  if (s === "available" || s === "composing" || s === "recording") return "online";
  if (s === "unavailable" || s === "offline" || s === "paused") return "offline";
  return "unknown";
}

const DOT: Record<PresKind, string> = {
  online: "bg-emerald-400 shadow-emerald-400/40",
  offline: "bg-rose-500 shadow-rose-500/40",
  unknown: "bg-slate-500 shadow-slate-500/30",
};

const DOT_LABEL: Record<PresKind, string> = {
  online: "Online",
  offline: "Offline",
  unknown: "No presence data",
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <span
        className={`min-w-0 truncate text-right text-xs text-slate-300 ${
          mono ? "font-mono" : ""
        }`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function Chats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getChats({ limit: 500 })
        .then((r: any) => {
          if (cancelled) return;
          setChats(Array.isArray(r) ? r : r?.items || []);
          setError(null);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || "Failed to load chats");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = chats;

    if (q) {
      list = list.filter((c) =>
        [c.savedName, c.pushName, c.phoneJid, c.lid, c.jid]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filter !== "all") {
      list = list.filter((c) => presenceKind(c.presenceState) === filter);
    }
    return [...list].sort((a, b) => (b.lastSeenTs || 0) - (a.lastSeenTs || 0));
  }, [chats, search, filter]);

  const onlineCount = chats.filter((c) => presenceKind(c.presenceState) === "online").length;

  // Only render the "no chats" empty state once the first load has settled.
  if (loading && !chats.length) {
    return <div className="p-8 text-center text-slate-400">Loading chats…</div>;
  }
  if (error && !chats.length) {
    return <div className="p-8 text-center text-rose-400">{error}</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">💬 Chats</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {chats.length} contacts ·{" "}
            <span className="text-emerald-400">{onlineCount} online</span>
            {error && <span className="ml-2 text-amber-400">· stale ({error})</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "online", "offline"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-white/10 text-white ring-1 ring-inset ring-white/20"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              {f === "all" ? "All" : f === "online" ? "Online" : "Offline"}
            </button>
          ))}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name / number / jid…"
            className="w-full max-w-xs rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-white/20 focus:outline-none sm:w-64"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 px-5 py-12 text-center text-slate-400">
          {chats.length === 0
            ? "No contacts yet. (The bot records contacts as messages arrive.)"
            : `No chats match ${search ? `"${search}"` : "this filter"}.`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => {
            const kind = presenceKind(c.presenceState);
            const display = c.savedName || c.pushName || shortJid(c.jid);
            return (
              <div
                key={c.jid}
                className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 transition-all hover:border-white/10 hover:bg-slate-900/70"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-100" title={display}>
                      {display}
                    </h3>
                    {c.savedName && c.pushName && c.savedName !== c.pushName && (
                      <p className="truncate text-[11px] text-slate-500" title={c.pushName}>
                        push name: {c.pushName}
                      </p>
                    )}
                  </div>
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow ${DOT[kind]}`}
                    title={`${DOT_LABEL[kind]}${
                      c.presenceState ? ` (${c.presenceState})` : ""
                    }`}
                  />
                </div>

                <div className="space-y-1 border-t border-white/5 pt-2">
                  <Field label="Phone" value={shortJid(c.phoneJid)} mono />
                  <Field label="LID" value={shortJid(c.lid)} mono />
                  <Field label="JID" value={c.jid} mono />
                  <Field
                    label="First seen"
                    value={`${fullDate(c.firstSeenTs)}${c.firstSeenTs ? ` (${ago(c.firstSeenTs)})` : ""}`}
                  />
                  <Field
                    label="Last seen"
                    value={`${fullDate(c.lastSeenTs)}${c.lastSeenTs ? ` (${ago(c.lastSeenTs)})` : ""}`}
                  />
                  <Field label="Messages" value={c.messageCount != null ? String(c.messageCount) : "—"} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-500">
        Auto-refreshing every {POLL_MS / 1000}s · presence expires ~10s after the last update
      </p>
    </div>
  );
}
