/*
 * EchoFox - WhatsApp bot built on Baileys
 * Copyright (C) 2026 COSM1CBUG and EchoFox contributors
 * Licensed under the GNU AGPL-3.0-or-later. See LICENSE.
 */

import { useEffect, useState } from 'react';
import { getDiagnostics, ApiError } from '../lib/api';
import { Loading, ErrorMessage } from '../components/LoadingError';
import { HistoryPanel } from '../components/HistoryPanel';

type DiagnosticCheck = {
  ok: boolean;
  ms?: number;
  error?: string;
};

type DiagnosticsResponse = {
  ok: boolean;
  checks?: Record<string, DiagnosticCheck>;
};

// A 503 error body qualifies as a diagnostics report only when it carries
// the report envelope ({ok: boolean, checks?...}); generic error bodies
// ({error: 'code'}) must still fall through to the failure message.
function isReport(body: unknown): body is DiagnosticsResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as DiagnosticsResponse).ok === 'boolean'
  );
}

export function Diagnostics() {
  const [report, setReport] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDiagnostics()
      .then((data) => {
        setReport(data as DiagnosticsResponse);
      })
      .catch((err: unknown) => {
        // C2: a degraded server answers 503 WITH the full report — that
        // payload is the whole point of this page. Render it instead of the
        // old dead-end "Failed to load diagnostics." (the "Degraded" heading
        // below was previously unreachable).
        const body = err instanceof ApiError ? err.body : null;
        if (isReport(body)) setReport(body);
        else setError('Failed to load diagnostics.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;
  if (!report) return null;

  const checks = Object.entries(report.checks ?? {});

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">
        System Diagnostics — {report.ok ? '✅ Healthy' : '❌ Degraded'}
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
              checks.map(([name, check], index) => (
                <tr key={index} className="border-b border-white/5">
                  <td className="px-5 py-4 font-medium">{name}</td>
                  <td className="px-5 py-4 font-mono text-slate-400">
                    {typeof check.ms === 'number' && Number.isFinite(check.ms)
                      ? `${check.ms}ms`
                      : '—'}
                  </td>
                  <td className="px-5 py-4">
                    {check.ok ? (
                      <span className="text-emerald-400">✅ OK</span>
                    ) : (
                      <span className="text-rose-400">❌ Error</span>
                    )}
                    {check.error ? (
                      <p
                        className="mt-1 max-w-md truncate text-xs text-slate-500"
                        title={check.error}
                      >
                        {check.error}
                      </p>
                    ) : null}
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

      <HistoryPanel domain="connection" title="📜 Connection history" />
      <HistoryPanel domain="call" title="📜 Call history" />
    </div>
  );
}
