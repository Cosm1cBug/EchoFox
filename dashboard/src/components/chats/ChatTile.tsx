/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

type ChatTileProps = {
  jid: string;
  name: string | null;
  notify: string | null;
  presence: {
    state: string;
    last_seen_ts: number;
  } | null;
  onClick: () => void;
};

export function ChatTile({ jid, name, notify, presence, onClick }: ChatTileProps) {
  const displayName = name || notify || "(No name)";
  const isOnline = presence?.state === "available" || presence?.state === "composing";

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-white/10 bg-slate-900/60 p-4 hover:bg-white/5 transition"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{displayName}</div>
          <div className="text-xs text-slate-400 font-mono">{jid}</div>
        </div>
        <div className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-500" : "bg-slate-500"}`} />
      </div>
    </div>
  );
}
