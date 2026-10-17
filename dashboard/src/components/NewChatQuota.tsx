/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

/**
 * NewChatQuota — "New-chat message quota" info box.
 *
 * WhatsApp caps how many NEW chats you may start per cycle (the account-level
 * `message-capping.update` event → NewChatMessageCapInfo). This box shows the
 * live quota: used/total, the cycle window, and the warning/capping status.
 *
 * Empty state until the first notification arrives (fresh sessions get one
 * the first time WhatsApp sends quota info — there is no query API for it).
 */

import { useEffect, useState } from 'react';
import { getMessageCapping, type NewChatQuotaInfo } from '../lib/api';

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  NONE: {
    label: 'Within quota',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  FIRST_WARNING: {
    label: 'First warning',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  SECOND_WARNING: {
    label: 'Second warning',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  CAPPED: {
    label: 'Capped',
    className: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  },
};

function fmtTs(v: string | null | undefined): string {
  if (!v) return '—';
  const t = Date.parse(v);
  if (Number.isNaN(t)) return v; // not an ISO string — show raw
  return new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NewChatQuota() {
  const [info, setInfo] = useState<NewChatQuotaInfo | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await getMessageCapping();
        if (!live) return;
        setInfo(r.available ? r.info : null);
        setUnavailable(!r.available);
      } catch {
        /* keep last data on transient errors */
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const status = info?.capping_status
    ? (STATUS_STYLE[info.capping_status] ?? {
        label: info.capping_status,
        className: 'border-white/10 bg-white/5 text-slate-300',
      })
    : null;

  const used = info?.used_quota ?? null;
  const total = info?.total_quota ?? null;
  const pct =
    used != null && total != null && total > 0
      ? Math.min(100, Math.round((used / total) * 100))
      : null;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-100">New-chat message quota</h4>
          <p className="mt-0.5 text-xs text-slate-400">
            Messages you may start in new chats this cycle
          </p>
        </div>
        {status && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
          >
            {status.label}
          </span>
        )}
      </div>

      {unavailable && !info ? (
        <p className="mt-3 text-xs text-slate-500">
          No quota data yet — WhatsApp reports this after you start messaging new chats.
        </p>
      ) : info ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-300">
              <span className="font-mono text-lg font-semibold text-slate-50">{used ?? '—'}</span>
              <span className="text-slate-500"> / {total ?? '—'}</span>
            </span>
            {pct != null && <span className="text-xs text-slate-400">{pct}% used</span>}
          </div>

          {pct != null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full ${
                  pct >= 100 ? 'bg-rose-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 text-xs">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Cycle start
              </p>
              <p className="mt-0.5 text-slate-300">{fmtTs(info.cycle_start_timestamp)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Cycle end
              </p>
              <p className="mt-0.5 text-slate-300">{fmtTs(info.cycle_end_timestamp)}</p>
            </div>
            {info.ote_status && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  OTE
                </p>
                <p className="mt-0.5 truncate text-slate-300">{info.ote_status}</p>
              </div>
            )}
            {info.mv_status && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  MV
                </p>
                <p className="mt-0.5 truncate text-slate-300">{info.mv_status}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Loading…</p>
      )}
    </div>
  );
}
