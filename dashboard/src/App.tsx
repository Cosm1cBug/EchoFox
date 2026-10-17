/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { Login } from './components/Login';
import { setAuth, clearAuth, setUnauthorizedHandler, getHealth, ApiError } from './lib/api';
import { Overview } from './pages/Overview';
import { Groups } from './pages/Groups';
import { Chats } from './pages/Chats';
import { Status } from './pages/Status';
import { Chat } from './pages/Chat';
import { Metrics } from './pages/Metrics';
import { Diagnostics } from './pages/Diagnostics';
import { Alerts } from './pages/Alerts';
import { Subscriptions } from './pages/Subscriptions';
import { Blocklist } from './pages/Blocklist';
import { Contacts } from './pages/Contacts';
import { Presence } from './pages/Presence';
import { Labels } from './pages/Labels';
import { Newsletters } from './pages/Newsletters';
import { Ai } from './pages/Ai';
import { Leaderboard } from './pages/Leaderboard';
import { AuditLog } from './pages/AuditLog';

const TABS = [
  'Overview',
  'Groups',
  'Chats', //Needs to change it.
  'Status',
  'Chat',
  'Leaderboard',
  'Contacts',
  'Presence',
  'Newsletters',
  'Subscriptions',
  'Labels',
  'Blocklist',
  'Metrics',
  'Diagnostics',
  'Alerts',
  'Audit',
  'AI',
] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  // v1.20.1 (C3): 401 recovery — any request failing with 401 drops the
  // dead session and returns to the Login screen instead of leaving every
  // page stuck on generic "Failed to fetch data" errors.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth();
      setIsAuthenticated(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // v1.20.1 (C3): validate credentials with a real round-trip BEFORE
  // entering. Any non-401 answer (including 503 "degraded") proves the
  // request passed the basicAuth gate, so the credentials are valid —
  // only 401 means they are wrong; a network error means no backend.
  const handleLogin = async (username: string, password: string) => {
    setAuth(username, password);
    try {
      await getHealth();
      setIsAuthenticated(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearAuth();
        throw new Error('Invalid username or password.');
      }
      if (err instanceof ApiError) {
        // Authenticated, but the backend answered with an error status
        // (e.g. 503 degraded) — go in; the pages will show the state.
        setIsAuthenticated(true);
        return;
      }
      clearAuth();
      throw new Error('Cannot reach the dashboard backend.');
    }
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
                  ? 'bg-white/10 text-white ring-1 ring-inset ring-white/20'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {activeTab === 'Overview' && <Overview />}
          {activeTab === 'Groups' && <Groups />}
          {activeTab === 'Chats' && <Chats />}
          {activeTab === 'Status' && <Status />}
          {activeTab === 'Chat' && <Chat />}
          {activeTab === 'Leaderboard' && <Leaderboard />}
          {activeTab === 'Contacts' && <Contacts />}
          {activeTab === 'Presence' && <Presence />}
          {activeTab === 'Newsletters' && <Newsletters />}
          {activeTab === 'Subscriptions' && <Subscriptions />}
          {activeTab === 'Labels' && <Labels />}
          {activeTab === 'Blocklist' && <Blocklist />}
          {activeTab === 'Metrics' && <Metrics />}
          {activeTab === 'Diagnostics' && <Diagnostics />}
          {activeTab === 'Alerts' && <Alerts />}
          {activeTab === 'Audit' && <AuditLog />}
          {activeTab === 'AI' && <Ai />}
        </div>
      </div>
    </div>
  );
}
