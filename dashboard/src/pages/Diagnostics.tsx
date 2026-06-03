import { useEffect, useState } from "react";
import { getDiagnostics } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

export function Diagnostics() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDiagnostics()
      .then(setReport)
      .catch(() => setError("Failed to load diagnostics."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!report) return null;

  const checks = Object.entries(report.checks || {});

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">
        System Diagnostics — {report.ok ? "✅ Healthy" : "❌ Degraded"}
      </h2>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">Subsystem</th>
              <th className="px-5 py-3">Latency</th>
              <th className="px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {checks.length > 0 ? (
              checks.map(([name, check]: any, index) => (
                <tr key={index} className="border-b border-white/5">
                  <td className="px-5 py-4 font-medium">{name}</td>
                  <td className="px-5 py-4 font-mono text-slate-400">{check.ms}ms</td>
                  <td className="px-5 py-4">
                    {check.ok ? (
                      <span className="text-emerald-400">✅ OK</span>
                    ) : (
                      <span className="text-rose-400">❌ Error</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-slate-400">
                  No diagnostic data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```