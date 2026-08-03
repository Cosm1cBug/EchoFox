/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getChats } from "../lib/api";

// Simple in-memory presence cache (can be improved later)
const presenceCache: Record<string, { state: string; lastSeen: number }> = {};

type Chat = {
  jid: string;
  name: string | null;
  notify: string | null;
  presence?: {
    state: string;
    last_seen_ts: number;
  };
};

export function Chats() {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);

  const fetchChats = async () => {
    try {
      const result = await getChats({ limit: 200 });
      const list = result.items || result;

      // Merge with presence cache
      const merged = list.map((chat: Chat) => {
        const cached = presenceCache[chat.jid];
        return {
          ...chat,
          presence: cached
            ? { state: cached.state, last_seen_ts: cached.lastSeen }
            : chat.presence,
        };
      });

      setChats(merged);
      setError(null);
    } catch {
      setError("Failed to load chats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
  }, []);

  const handleTileClick = (chat: Chat) => {
    setSelectedChat(chat);
  };

  if (loading && !chats) return <div className="p-8 text-center">Loading chats...</div>;
  if (error) return <div className="p-8 text-red-400">{error}</div>;
  if (!chats) return null;

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-6">💬 Chats</h2>

      {/* Chat Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {chats.map((chat) => {
          const isOnline =
            chat.presence?.state === "available" ||
            chat.presence?.state === "composing";

          return (
            <div
              key={chat.jid}
              onClick={() => handleTileClick(chat)}
              className="cursor-pointer rounded-xl border border-white/10 bg-slate-900/60 p-4 hover:bg-white/5 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">
                    {chat.name || chat.notify || "(No name)"}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {chat.jid}
                  </div>
                </div>
                <div
                  className={`w-3 h-3 rounded-full ${
                    isOnline ? "bg-green-500" : "bg-slate-500"
                  }`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Panel (Basic for now) */}
      {selectedChat && (
        <div className="mt-8 rounded-xl border border-white/10 bg-slate-900/60 p-6">
          <h3 className="text-xl font-semibold mb-4">Chat Details</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-slate-400">Name:</span> {selectedChat.name || selectedChat.notify}</p>
            <p><span className="text-slate-400">JID:</span> {selectedChat.jid}</p>
            <p>
              <span className="text-slate-400">Status:</span>{" "}
              {selectedChat.presence?.state || "unknown"}
            </p>
          </div>
          <button
            onClick={() => setSelectedChat(null)}
            className="mt-4 text-sm text-slate-400 hover:text-white"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
