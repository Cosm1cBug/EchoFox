/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useState } from "react";
import { Header } from "./components/Header";
import { Login } from "./components/Login";
import { setAuth, clearAuth } from "./lib/api";

import { Overview } from "./pages/Overview";
import { Groups } from "./pages/Groups";
import { Metrics } from "./pages/Metrics";
import { Diagnostics } from "./pages/Diagnostics";
import { Alerts } from "./pages/Alerts";
import { Subscriptions } from "./pages/Subscriptions";

const TABS = ["Overview", "Groups", "Metrics", "Diagnostics", "Alerts", "Subscriptions"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  const handleLogin = (username: string, password: string) => {
    setAuth(username, password);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearAuth();
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <Header onLogout={handleLogout} />

        <div className="mt-6 flex flex-wrap gap-1 border-b border-white/10 pb-2">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-white/10 text-white ring-1 ring-inset ring-white/20"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {activeTab === "Overview" && <Overview />}
          {activeTab === "Groups" && <Groups />}
          {activeTab === "Metrics" && <Metrics />}
          {activeTab === "Diagnostics" && <Diagnostics />}
          {activeTab === "Alerts" && <Alerts />}
          {activeTab === "Subscriptions" && <Subscriptions />}
        </div>
      </div>
    </div>
  );
}
