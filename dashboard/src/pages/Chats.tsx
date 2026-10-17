/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChats, getChatFull, ApiError } from '../lib/api';
import { ChatDetail } from '../components/chats/ChatDetail';

type ChatEntry = {
  jid: string;
  savedName?: string | null;
  pushName?: string | null;
  phoneJid?: string | null;
  lid?: string | null;
  firstSeenTs?: number | null;
  lastSeenTs?: number | null;
  messageCount?: number | null;
  presenceState?: string | null;
  presenceLastSeenTs?: number | null;
  imgUrl?: string | null;
  unread?: number | null;
};

type Filter = 'all' | 'online' | 'offline';

function presenceKind(state?: string | null): 'online' | 'offline' | 'unknown' {
  if (!state) return 'unknown';

  const value = state.toLowerCase();

  if (['available', 'composing', 'recording'].includes(value)) {
    return 'online';
  }

  if (['unavailable', 'offline'].includes(value)) {
    return 'offline';
  }

  return 'unknown';
}

function fmtDate(ts?: number | null): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
    return '—';
  }

  const date = new Date(ts * 1000);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function fmtRelative(ts?: number | null): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) {
    return 'Unknown';
  }

  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts));

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(ts * 1000).toLocaleDateString();
}

function displayValue(value?: string | null): string {
  return value?.trim() || '—';
}

function IdentityField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-slate-300" title={value || undefined}>
        {displayValue(value)}
      </p>
    </div>
  );
}

function ChatCard({ chat, onSelect }: { chat: ChatEntry; onSelect: () => void }) {
  const name = chat.savedName?.trim() || chat.pushName?.trim() || 'Unknown contact';
  const presence = presenceKind(chat.presenceState);
  // v1.20.2 (M5): WhatsApp CDN avatar URLs are auth-scoped and expire — they
  // typically 403/410 in a browser. Fall back to the letter avatar on error
  // instead of showing a broken image.
  const [imgFailed, setImgFailed] = useState(false);

  const dotColor =
    presence === 'online'
      ? 'bg-emerald-400'
      : presence === 'offline'
        ? 'bg-rose-400'
        : 'bg-slate-500';

  const presenceLabel =
    presence === 'online' ? 'Online' : presence === 'offline' ? 'Offline' : 'Unknown';

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-label={`View details for ${name}`}
      className="min-w-0 cursor-pointer rounded-lg border border-slate-700 bg-slate-800 p-4 transition-colors hover:border-slate-600"
    >
      <div className="flex min-w-0 items-start gap-3">
        {chat.imgUrl && !imgFailed ? (
          <img
            src={chat.imgUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-11 w-11 shrink-0 rounded-full border border-slate-700 object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-700 text-lg font-semibold text-slate-200"
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-semibold text-slate-100">{name}</h3>

          <p className="mt-1 break-all text-xs text-slate-400">
            {chat.savedName && chat.pushName && chat.savedName !== chat.pushName
              ? `WhatsApp name: ${chat.pushName}`
              : chat.phoneJid
                ? `PN: ${chat.phoneJid}`
                : 'WhatsApp contact'}
          </p>
        </div>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-slate-300"
          title={`Presence: ${presenceLabel}`}
        >
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotColor}`} />
          <span>{presenceLabel}</span>
        </span>
      </div>

      <div className="my-4 border-t border-slate-700" />

      <div className="grid min-w-0 grid-cols-1 gap-3">
        <IdentityField label="Phone number / PN" value={chat.phoneJid} />
        <IdentityField label="LID" value={chat.lid} />
        <IdentityField label="JID" value={chat.jid} />
      </div>

      <div className="my-4 border-t border-slate-700" />

      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            First seen
          </p>
          <p className="mt-1 text-xs text-slate-300" title={fmtDate(chat.firstSeenTs)}>
            {fmtRelative(chat.firstSeenTs)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Last activity
          </p>
          <p className="mt-1 text-xs text-slate-300" title={fmtDate(chat.lastSeenTs)}>
            {fmtRelative(chat.lastSeenTs)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Messages
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-100">
            {typeof chat.messageCount === 'number' ? chat.messageCount.toLocaleString() : '—'}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Presence last seen
          </p>
          <p className="mt-1 text-xs text-slate-300" title={fmtDate(chat.presenceLastSeenTs)}>
            {fmtRelative(chat.presenceLastSeenTs)}
          </p>
        </div>
      </div>

      {typeof chat.unread === 'number' && chat.unread > 0 && (
        <div className="mt-3">
          <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-xs text-sky-300">
            {chat.unread} unread
          </span>
        </div>
      )}
    </article>
  );
}

export function Chats() {
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // v1.20.2 (M4): drill-down details — wires the ChatDetail component to the
  // ready-but-orphaned GET /api/chats/:jid/full endpoint.
  const [detailJid, setDetailJid] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const openDetail = useCallback(async (jid: string) => {
    setDetailJid(jid);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail((await getChatFull(jid)) as Record<string, unknown>);
    } catch (err) {
      const code =
        err instanceof ApiError && err.body && typeof err.body === 'object'
          ? (err.body as { error?: unknown }).error
          : null;
      setDetailError(
        code === 'not_found' || code === 'not_implemented'
          ? 'No stored details for this chat.'
          : err instanceof Error
            ? err.message
            : 'Failed to load chat details',
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);

  const fetchChats = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;

    try {
      const response: unknown = await getChats({ limit: 500 });

      let items: ChatEntry[];

      if (Array.isArray(response)) {
        items = response as ChatEntry[];
      } else if (
        typeof response === 'object' &&
        response !== null &&
        'items' in response &&
        Array.isArray(response.items)
      ) {
        items = response.items as ChatEntry[];
      } else {
        throw new Error('Unexpected response from the chats API');
      }

      if (mountedRef.current) {
        setChats(items);
        setError(null);
      }
    } catch {
      if (mountedRef.current) {
        setError('Failed to fetch chats. Please check the API connection.');
      }
    } finally {
      inFlightRef.current = false;

      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    void fetchChats();

    const interval = setInterval(() => {
      void fetchChats();
    }, 20000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchChats]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return chats.filter((chat) => {
      const state = presenceKind(chat.presenceState);

      if (filter === 'online' && state !== 'online') return false;
      if (filter === 'offline' && state !== 'offline') return false;

      if (!query) return true;

      const searchable = [chat.savedName, chat.pushName, chat.phoneJid, chat.lid, chat.jid]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [chats, filter, search]);

  const onlineCount = chats.filter((chat) => presenceKind(chat.presenceState) === 'online').length;

  const unknownCount = chats.filter(
    (chat) => presenceKind(chat.presenceState) === 'unknown',
  ).length;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Chats</h2>
          <p className="mt-1 text-sm text-slate-400">
            Browse contacts, WhatsApp identifiers, presence, and activity.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void fetchChats();
          }}
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Total contacts
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-50">{chats.length.toLocaleString()}</p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Online</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">{onlineCount.toLocaleString()}</p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Unknown presence
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-300">{unknownCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search chats</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, phone number, PN, LID, or JID..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-500 focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-2" aria-label="Filter chats">
          {(['all', 'online', 'offline'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`rounded-md px-3 py-2 text-sm capitalize transition-colors ${
                filter === value
                  ? 'bg-white/10 text-white ring-1 ring-inset ring-white/20'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-rose-300"
        >
          {error}
          {chats.length > 0 && ' Showing the last successfully loaded data.'}
        </div>
      )}

      {detailJid && (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Chat details
              <span className="ml-2 font-mono text-xs font-normal text-slate-500">{detailJid}</span>
            </h3>
            <button
              type="button"
              onClick={() => {
                setDetailJid(null);
                setDetail(null);
                setDetailError(null);
              }}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="mt-4">
            {detailLoading && (
              <p role="status" className="text-sm text-slate-400">
                Loading details…
              </p>
            )}
            {detailError && (
              <p role="alert" className="text-sm text-rose-300">
                {detailError}
              </p>
            )}
            {!detailLoading && !detailError && detail && <ChatDetail detail={detail} />}
          </div>
        </div>
      )}

      {loading && chats.length === 0 ? (
        <div role="status" className="py-10 text-center text-slate-400">
          Loading chats...
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-8 text-center">
          <p className="text-sm text-slate-300">
            {chats.length === 0 ? 'No chats found.' : 'No chats match your search or filter.'}
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((chat) => (
            <ChatCard
              key={chat.jid || chat.lid || chat.phoneJid || chat.pushName}
              chat={chat}
              onSelect={() => void openDetail(chat.jid)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Showing {visible.length.toLocaleString()} of {chats.length.toLocaleString()} contacts.
        Presence may be unavailable when WhatsApp has not supplied a recent presence update.
      </p>
    </section>
  );
}
