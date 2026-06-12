/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getAiStats, getAiChats, getAiConfig } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

type UsageRow = {
  day: string;
  cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
  calls: number;
};
type StatsResponse = {
  days: number;
  rows: UsageRow[];
  todayUsd: number;
  costCapPerDayUsd: number;
};
type ChatRow = {
  chatJid: string;
  enabled: boolean;
  persona: string | null;
  provider: string | null;
  model: string | null;
  updatedAt: number;
};
type ChatsResponse = {
  count: number;
  chats: ChatRow[];
};
type ConfigResponse = {
  enabled: boolean;
  defaultProvider: string;
  model: string;
  persona: string;
  memoryTurns: number;
  maxTokens: number;
  costCapPerDayUsd: number;
  optInDefault: string;
  enableToolCalling: boolean;
  typingWhileGenerating: boolean;
  toolWhitelist: string[];
  rateLimitPerUserPerHour: number;
  rateLimitPerChatPerDay: number;
  providersConfigured: {
    openai: boolean;
    gemini: boolean;
    anthropic: boolean;
    local: boolean;
  };
};

function fmtUsd(n: number): string {
  if (typeof n !== "number" || !isFinite(n)) return "$0.000000";
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function fmtJid(jid: string): string {
  return jid.split("@")[0];
}

function fmtTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export function Ai() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [chats, setChats] = useState<ChatsResponse | null>(null);
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const [s, c, k] = await Promise.all([
        getAiStats(30),
        getAiChats(),
        getAiConfig(),
      ]);
      setStats(s as StatsResponse);
      setChats(c as ChatsResponse);
      setCfg(k as ConfigResponse);
      setError(null);
    } catch {
      setError("Failed to load AI data — the dashboard store may not implement AI methods (try sqlite v1.2.0+).");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading && !stats) return <Loading />;
  if (error) return <ErrorMessage message={error} />;

  const todayPct =
    cfg && cfg.costCapPerDayUsd > 0 && stats
      ? Math.min(100, (stats.todayUsd / cfg.costCapPerDayUsd) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Config card */}
      <section className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-inset ring-white/10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">🤖 AI</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
              cfg?.enabled
                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/20"
                : "bg-rose-500/15 text-rose-300 ring-rose-400/20"
            }`}
          >
            {cfg?.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>

        {cfg && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Kv k="Default provider" v={cfg.defaultProvider} />
            <Kv k="Default model" v={cfg.model} />
            <Kv k="Persona" v={cfg.persona} />
            <Kv k="Memory turns" v={cfg.memoryTurns} />
            <Kv k="Max tokens" v={cfg.maxTokens} />
            <Kv k="Opt-in default" v={cfg.optInDefault} />
            <Kv k="Tool calling" v={cfg.enableToolCalling ? "✅" : "❌"} />
            <Kv k="Typing UX" v={cfg.typingWhileGenerating ? "✅" : "❌"} />
            <Kv k="Rate / user / hr" v={cfg.rateLimitPerUserPerHour} />
            <Kv k="Rate / chat / day" v={cfg.rateLimitPerChatPerDay} />
            <Kv k="Cap / day" v={fmtUsd(cfg.costCapPerDayUsd)} />
            <Kv
              k="Providers configured"
              v={
                [
                  cfg.providersConfigured.openai && "openai",
                  cfg.providersConfigured.gemini && "gemini",
                  cfg.providersConfigured.anthropic && "anthropic",
                  cfg.providersConfigured.local && "local",
                ]
                  .filter(Boolean)
                  .join(", ") || "—"
              }
            />
          </dl>
        )}

        {cfg && cfg.toolWhitelist.length > 0 && (
          <div className="mt-3 text-xs text-slate-400">
            <span className="mr-2 font-semibold text-slate-300">Tools:</span>
            {cfg.toolWhitelist.map((t) => (
              <span
                key={t}
                className="mr-1 mb-1 inline-block rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Today / cap */}
      {stats && cfg && (
        <section className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-inset ring-white/10">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              Today's spend
            </h3>
            <span className="text-sm text-slate-400">
              {fmtUsd(stats.todayUsd)} / {fmtUsd(cfg.costCapPerDayUsd)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all ${
                todayPct > 80
                  ? "bg-rose-500"
                  : todayPct > 50
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${todayPct}%` }}
            />
          </div>
        </section>
      )}

      {/* Usage by day */}
      {stats && stats.rows.length > 0 && (
        <section className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-inset ring-white/10">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">
            Usage — last {stats.days} day(s)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-white/10 text-left text-slate-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Day</th>
                  <th className="py-1 pr-3 font-medium">Cost</th>
                  <th className="py-1 pr-3 font-medium">Prompt</th>
                  <th className="py-1 pr-3 font-medium">Completion</th>
                  <th className="py-1 pr-3 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.day} className="border-b border-white/5">
                    <td className="py-1 pr-3 font-mono">{r.day}</td>
                    <td className="py-1 pr-3 font-mono text-emerald-300">
                      {fmtUsd(Number(r.cost_usd))}
                    </td>
                    <td className="py-1 pr-3 font-mono">{r.prompt_tokens}</td>
                    <td className="py-1 pr-3 font-mono">{r.completion_tokens}</td>
                    <td className="py-1 pr-3 font-mono">{r.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Opted-in chats */}
      {chats && (
        <section className="rounded-lg bg-slate-900/60 p-4 ring-1 ring-inset ring-white/10">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              Opted-in chats
            </h3>
            <span className="text-xs text-slate-400">{chats.count} chat(s)</span>
          </div>
          {chats.chats.length === 0 ? (
            <p className="text-xs text-slate-500">
              No chats have explicit AI opt-in records yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="border-b border-white/10 text-left text-slate-400">
                  <tr>
                    <th className="py-1 pr-3 font-medium">State</th>
                    <th className="py-1 pr-3 font-medium">Chat</th>
                    <th className="py-1 pr-3 font-medium">Persona</th>
                    <th className="py-1 pr-3 font-medium">Provider</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {chats.chats.map((r) => (
                    <tr key={r.chatJid} className="border-b border-white/5">
                      <td className="py-1 pr-3">{r.enabled ? "✅" : "⛔"}</td>
                      <td className="py-1 pr-3 font-mono">{fmtJid(r.chatJid)}</td>
                      <td className="py-1 pr-3">{r.persona || "—"}</td>
                      <td className="py-1 pr-3">{r.provider || "—"}</td>
                      <td className="py-1 pr-3">{r.model || "—"}</td>
                      <td className="py-1 pr-3 text-slate-400">
                        {fmtTs(r.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string | number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{k}</dt>
      <dd className="font-mono text-sm text-slate-200">{v}</dd>
    </div>
  );
}
