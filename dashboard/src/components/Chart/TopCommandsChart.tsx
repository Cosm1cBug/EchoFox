import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface TopCommandsChartProps {
  data: { name: string; count: number }[];
}

export function TopCommandsChart({ data }: TopCommandsChartProps) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur">
      <h3 className="mb-4 text-sm font-semibold text-white">Top Commands</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 12 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "#1e2937", border: "none", color: "#e2e8f0" }} />
            <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```