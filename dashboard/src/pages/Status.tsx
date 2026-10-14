/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.19.0 — Status / Stories history.
//
// Data comes from two tables we already populate:
//   • statuses  → messages  WHERE jid = 'status@broadcast'
//   • views     → message_receipts WHERE jid = 'status@broadcast'
//
// Baileys emits `message-receipt.update` for status broadcasts, so viewer
// lists fill in automatically for OUR OWN statuses. For someone else's status
// WhatsApp sends no read receipts to us, so the view count is simply absent —
// the UI says so rather than showing a misleading zero.

import { useEffect, useState } from "react";
import { getStatuses, getStatusViewers } from "../lib/api";

type StatusItem = {
  id: string;
  fromMe: boolean;
  participant: string | null;
  ts: number;
  type: string;
  text: string | null;
  mimetype: string | null;
  viewCount: number;
};

type Day = {
  date: string;
  items: StatusItem[];
  count: number;
  mine: number;
  totalViews: number;
};

type Viewer = { recipient: string; status: number; ts: number };

const TYPE_ICON: Record<string, string> = {
  text: "📝",
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  document: "📄",
  sticker: "🩹",
  unknown: "❓",
};

function timeOf(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayLabel(dateStr: string): string {
  const today = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (dateStr === key(today)) return "Today";
  const y = new Date(today.getTime() - 86400 * 1000);
  if (dateStr === key(y)) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortJid(jid: string | null | undefined): string {
  if (!jid) return "unknown";
  return jid.split("@")[0] || jid;
}

function ViewerList({ id }: { id: string }) {
  const [viewers, setViewers] = useState<Viewer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStatusViewers(id)
      .then((r: any) => {
        if (!cancelled) setViewers(r?.viewers || []);
      })
      .catch(() => {
        if (!cancelled) setViewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (viewers === null) return <p className="mt-1 text-[11px] text-slate-500">loading viewers…</p>;
  if (!viewers.length)
    return <p className="mt-1 text-[11px] text-slate-500">No viewers recorded yet.</p>;

  return (
    <ul className="mt-1.5 space-y-0.5">
      {viewers.map((v) => (
        <li
          key={v.recipient}
          className="flex items-baseline justify-between gap-2 font-mono text-[11px] text-slate-400"
        >
          <span className="truncate" title={v.recipient}>
            👁 {shortJid(v.recipient)}
          </span>
          <span className="shrink-0 text-slate-500">{timeOf(v.ts)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Status() {
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStatuses(windowDays)
      .then((r: any) => {
        if (cancelled) return;
        setDays(r?.days || []);
        setUnavailable(Boolean(r?.unavailable));
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load statuses");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  const totalPosted = days.reduce((n, d) => n + d.count, 0);
  const totalViews = days.reduce((n, d) => n + d.totalViews, 0);

  if (loading && !days.length) {
    return <div className="p-8 text-center text-slate-400">Loading status history…</div>;
  }
  if (error && !days.length) {
    return <div className="p-8 text-center text-rose-400">{error}</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">📸 Status / Stories</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {windowDays}-day history · <span className="text-slate-300">{totalPosted}</span> posted ·{" "}
            <span className="text-emerald-400">{totalViews}</span> views
            {error && <span className="ml-2 text-amber-400">· stale ({error})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                windowDays === d
                  ? "bg-white/10 text-white ring-1 ring-inset ring-white/20"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {unavailable && (
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 text-sm text-amber-300">
          This store backend does not implement status queries yet. SQLite is fully supported.
        </div>
      )}

      <div className="space-y-3">
        {days.map((day) => {
          const isOpen = open[day.date] ?? day.count > 0;
          return (
            <div
              key={day.date}
              className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40"
            >
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [day.date]: !isOpen }))}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-900/70"
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-sm font-semibold text-slate-100">
                    {dayLabel(day.date)}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{day.date}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {day.count > 0 ? (
                    <>
                      <span className="text-slate-400">
                        {day.count} {day.count === 1 ? "story" : "stories"}
                      </span>
                      {day.mine > 0 && <span className="text-slate-500">({day.mine} mine)</span>}
                      {day.totalViews > 0 && (
                        <span className="text-emerald-400">{day.totalViews} views</span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-500">No status/story</span>
                  )}
                  <span className="text-slate-600">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-white/5 px-5 py-4">
                  {day.count === 0 ? (
                    <p className="text-sm text-slate-500">No status/story on this day.</p>
                  ) : (
                    <div className="space-y-3">
                      {day.items.map((s) => (
                        <div
                          key={s.id}
                          className="rounded-xl border border-white/5 bg-slate-950/40 p-3"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="flex min-w-0 items-baseline gap-2">
                              <span>{TYPE_ICON[s.type] || TYPE_ICON.unknown}</span>
                              <span className="text-xs font-medium text-slate-200">
                                {s.type}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">
                                {timeOf(s.ts)}
                              </span>
                              <span className="truncate text-[11px] text-slate-500">
                                {s.fromMe ? "· posted by you" : `· from ${shortJid(s.participant)}`}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[11px] text-slate-400">
                              {s.fromMe
                                ? s.viewCount > 0
                                  ? `${s.viewCount} view${s.viewCount === 1 ? "" : "s"}`
                                  : "no views yet"
                                : "views n/a"}
                            </span>
                          </div>

                          {s.text && (
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-300">
                              {s.text}
                            </p>
                          )}

                          {s.fromMe && s.viewCount > 0 && (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                                show viewers
                              </summary>
                              <ViewerList id={s.id} />
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">
        Viewers are collected for your own statuses only — WhatsApp sends no read
        receipts for other people&apos;s.
      </p>
    </div>
  );
}
