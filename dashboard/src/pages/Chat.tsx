/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

// v1.19.0 — conversation view.
//
// Two panes: contact list on the left (searchable), conversation + composer
// on the right. History is read from your own store (GET
// /api/conversations/:jid/messages); sending goes through POST
// /api/conversations/send, which is the dashboard's only mutating route and
// is gated on a valid JID, non-empty capped text, an open socket and the
// dashboard's HTTP Basic Auth. Every send is also written to the admin audit
// log.
//
// Media is NOT re-sent inline: images/videos/audio render as typed placeholders
// with the caption. Fetching and decrypting media from the dashboard needs a
// dedicated endpoint (the store keeps the protobuf, and decryption is async and
// can fail on expired media), so it is deliberately out of scope here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getChats, getConversation, sendMessage, ApiError } from '../lib/api';

// v1.20.2 (H2): mirror of the send endpoint's JID_RE (src/dashboard/server.js).
// The composer may only offer chats the endpoint accepts — `@newsletter` and
// `status@broadcast` rows from getChats() are not sendable and used to fail
// with a bare `API Error: 400 (invalid_jid)`. Device-qualified JIDs
// (`123:2@s.whatsapp.net`) normalise to their bare form first.
const SENDABLE_RE = /^\d+@(s\.whatsapp\.net|g\.us|lid)$/;

function toSendableJid(jid: string): string | null {
  const bare = jid.replace(/:\d+(?=@)/, '');
  return SENDABLE_RE.test(bare) ? bare : null;
}

function sendErrorMessage(err: unknown): string {
  const code =
    err instanceof ApiError && err.body && typeof err.body === 'object'
      ? (err.body as { error?: unknown }).error
      : null;
  switch (code) {
    case 'invalid_jid':
      return "This contact can't receive messages (unsupported chat type).";
    case 'not_connected':
      return 'WhatsApp is not connected — try again shortly.';
    case 'text_too_long':
      return 'Message too long.';
    default:
      return err instanceof Error ? err.message : 'Send failed';
  }
}

type Chat = {
  jid: string;
  savedName: string | null;
  pushName: string | null;
  phoneJid: string | null;
  lid: string | null;
  lastSeenTs: number | null;
  presenceState: string | null;
};

type Msg = {
  id: string;
  fromMe: boolean;
  participant: string | null;
  ts: number;
  type: string;
  text: string | null;
  mimetype: string | null;
};

const TYPE_ICON: Record<string, string> = {
  text: '',
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  document: '📄',
  sticker: '🩹',
  system: '⚙️',
  unavailable: '🚫',
  unknown: '❓',
};

function shortJid(jid: string | null | undefined): string {
  if (!jid) return 'unknown';
  return jid.split('@')[0] || jid;
}

function clockTime(tsSec: number): string {
  return new Date(tsSec * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayKey(tsSec: number): string {
  return new Date(tsSec * 1000).toDateString();
}

export function Chat() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // ── contact list ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getChats({ limit: 500 })
        .then((r: any) => {
          if (!cancelled) setChats(Array.isArray(r) ? r : r?.items || []);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // ── conversation ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadingMsgs(true);
    const load = () =>
      getConversation(active, 200)
        .then((r: any) => {
          if (!cancelled) {
            setMessages(r?.items || []);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message || 'Failed to load conversation');
        })
        .finally(() => {
          if (!cancelled) setLoadingMsgs(false);
        });
    load();
    const id = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, active]);

  const visibleChats = useMemo(() => {
    const q = search.trim().toLowerCase();
    // v1.20.2 (H2): only offer chats the send endpoint accepts.
    const sendable = chats.filter((c) => toSendableJid(c.jid) !== null);
    if (!q) return sendable;
    return sendable.filter((c) =>
      [c.savedName, c.pushName, c.phoneJid, c.lid, c.jid]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [chats, search]);

  const activeChat = chats.find((c) => c.jid === active) || null;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active || sending) return;
    const jid = toSendableJid(active);
    if (!jid) {
      setError("This contact can't receive messages (unsupported chat type).");
      return;
    }
    setSending(true);
    try {
      await sendMessage(jid, text);
      setDraft('');
      const r: any = await getConversation(active, 200);
      setMessages(r?.items || []);
      setError(null);
    } catch (err: unknown) {
      // v1.20.2 (H2): surface the server's error body (invalid_jid,
      // not_connected, text_too_long, …) instead of a bare status line.
      setError(sendErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6">
      <h2 className="mb-4 text-xl font-semibold text-slate-100">🗨️ Chat</h2>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ── left: contacts ── */}
        <div className="max-h-[70vh] overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          <div className="border-b border-white/5 p-3">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-white/20 focus:outline-none"
            />
          </div>
          <ul className="max-h-[62vh] divide-y divide-white/5 overflow-y-auto">
            {visibleChats.map((c) => {
              const display = c.savedName || c.pushName || shortJid(c.jid);
              const isActive = c.jid === active;
              return (
                <li key={c.jid}>
                  <button
                    type="button"
                    onClick={() => setActive(c.jid)}
                    className={`w-full px-3 py-2.5 text-left transition-colors ${
                      isActive ? 'bg-white/10' : 'hover:bg-slate-900/70'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-200" title={display}>
                        {display}
                      </span>
                      {c.lastSeenTs && (
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">
                          {clockTime(c.lastSeenTs)}
                        </span>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-slate-500">
                      {c.phoneJid ? shortJid(c.phoneJid) : shortJid(c.jid)}
                    </div>
                  </button>
                </li>
              );
            })}
            {!visibleChats.length && (
              <li className="px-3 py-8 text-center text-xs text-slate-500">No contacts.</li>
            )}
          </ul>
        </div>

        {/* ── right: conversation ── */}
        <div className="flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-12 text-center text-sm text-slate-500">
              Select a contact to view the conversation.
            </div>
          ) : (
            <>
              <div className="border-b border-white/5 px-4 py-3">
                <div className="text-sm font-semibold text-slate-100">
                  {activeChat?.savedName || activeChat?.pushName || shortJid(active)}
                </div>
                <div className="font-mono text-[10px] text-slate-500" title={active}>
                  {active}
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {loadingMsgs && !messages.length && (
                  <p className="text-center text-xs text-slate-500">Loading…</p>
                )}
                {!loadingMsgs && !messages.length && (
                  <p className="text-center text-xs text-slate-500">
                    No stored messages for this chat yet.
                  </p>
                )}
                {messages.map((m, i) => {
                  const showDay = i === 0 || dayKey(m.ts) !== dayKey(messages[i - 1].ts);
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <div className="my-3 text-center text-[10px] uppercase tracking-wide text-slate-600">
                          {dayKey(m.ts)}
                        </div>
                      )}
                      <div className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                            m.fromMe
                              ? 'bg-emerald-600/20 text-emerald-50'
                              : 'bg-slate-800/70 text-slate-100'
                          }`}
                          title={new Date(m.ts * 1000).toLocaleString()}
                        >
                          {!m.fromMe && m.participant && (
                            <div className="mb-0.5 font-mono text-[10px] text-slate-400">
                              {shortJid(m.participant)}
                            </div>
                          )}
                          {TYPE_ICON[m.type] && <span className="mr-1">{TYPE_ICON[m.type]}</span>}
                          <span className="whitespace-pre-wrap break-words">
                            {m.text ||
                              (m.type === 'text'
                                ? ''
                                : m.type === 'system'
                                  ? '(system message)'
                                  : `(${m.type})`)}
                          </span>
                          <div className="mt-0.5 text-right font-mono text-[10px] text-slate-500">
                            {clockTime(m.ts)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={handleSend} className="border-t border-white/5 p-3">
                {error && <p className="mb-2 text-[11px] text-rose-400">{error}</p>}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Type a message…"
                    maxLength={4096}
                    className="flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-white/20 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="rounded-lg bg-emerald-600/80 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sending ? '…' : 'Send'}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-500">
                  Sends as your linked WhatsApp account. Every send is recorded in the audit log.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
