import { useEffect, useState } from "react";
import { getAlerts } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

export function Alerts() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAlerts()
      .then((res) => setAlerts(res.active || []))
      .catch(() => setError("Failed to load alerts."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;

  if (alerts.length === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-8 text-center text-slate-400">
        No active alerts. All commands are performing well.
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Active Alerts</h2>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">Command</th>
              <th className="px-5 py-3">Failure Rate</th>
              <th className="px-5 py-3">Invocations</th>
              <th className="px-5 py-3">Since</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert, index) => (
              <tr key={index} className="border-b border-white/5">
                <td className="px-5 py-4 font-mono text-rose-400">.{alert.command}</td>
                <td className="px-5 py-4 text-rose-400">{(alert.rate * 100).toFixed(1)}%</td>
                <td className="px-5 py-4">{alert.invocations}</td>
                <td className="px-5 py-4 text-slate-400">
                  {new Date(alert.since).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```