/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { HealthPill } from "./HealthPill";

interface HeaderProps {
  onLogout: () => void;
}

export function Header({ onLogout }: HeaderProps) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-white/5 pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
          <span className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            🦊 EchoFox
          </span>
        </h1>
        <div className="mt-3">
          <HealthPill />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onLogout}
          className="rounded-md border border-white/10 px-3 py-1 text-xs text-slate-400 hover:bg-white/5 hover:text-white"
        >
          Logout
        </button>
      </div>
    </header>
  );
}