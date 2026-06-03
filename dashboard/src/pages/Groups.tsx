import { useEffect, useState } from "react";
import { getGroups } from "../lib/api";
import { Loading, ErrorMessage } from "../components/LoadingError";

export function Groups() {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch(() => setError("Failed to load groups."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} />;

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Groups</h2>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-slate-900/40">
        <table className="w-full text-sm">
          <thead className="border-b border-white/10 text-left text-xs text-slate-500">
            <tr>
              <th className="px-5 py-3">Subject</th>
              <th className="px-5 py-3">JID</th>
              <th className="px-5 py-3 text-right">Participants</th>
            </tr>
          </thead>
          <tbody>
            {groups.length > 0 ? (
              groups.map((group, index) => (
                <tr key={index} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-5 py-4 font-medium">{group.subject}</td>
                  <td className="px-5 py-4 font-mono text-xs text-slate-400">{group.jid}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{group.participantCount}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="px-5 py-6 text-center text-slate-400">
                  No groups found.
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