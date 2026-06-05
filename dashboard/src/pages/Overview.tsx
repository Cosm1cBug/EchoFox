/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from "react";
import { getStats } from "../lib/api";
import { TopCommandsChart } from "../components/Chart/TopCommandsChart";
import { MessageTrendChart } from "../components/Chart/MessageTrendChart";
import { RecentActivity } from "../components/RecentActivity";
import { Loading, ErrorMessage } from "../components/LoadingError";

export function Overview() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const result = await getStats();
      setData(result);
      setError(null);
    } catch {
      setError("Failed to fetch dashboard data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const topCommands = Object.entries(data.counters || {})
    .filter(([key]) => key.startsWith("commands_per_name__"))
    .map(([key, value]) => ({
      name: key.replace("commands_per_name__", ""),
      count: Number(value),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const messageTrend = [
    { time: "00:00", sent: 120, received: 340 },
    { time: "06:00", sent: 280, received: 410 },
    { time: "12:00", sent: 450, received: 620 },
    { time: "18:00", sent: 390, received: 580 },
    { time: "23:59", sent: 210, received: 310 },
  ];

  const recentActivities = [
    { type: "message", description: "New message received in EchoFox Community", time: "2m ago" },
    { type: "command", description: "Command .song executed", time: "5m ago" },
    { type: "alert", description: "High failure rate on .mediafire", time: "12m ago" },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Metric cards can be added here */}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TopCommandsChart data={topCommands} />
        <MessageTrendChart data={messageTrend} />
      </div>

      <RecentActivity activities={recentActivities} />
    </div>
  );
}
