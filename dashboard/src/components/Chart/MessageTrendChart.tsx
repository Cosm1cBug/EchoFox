import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface MessageTrendChartProps {
  data: { time: string; sent: number; received: number }[];
}

export function MessageTrendChart({ data }: MessageTrendChartProps) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur">
      <h3 className="mb-4 text-sm font-semibold text-white">Message Trends</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 12 }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: "#1e2937", border: "none", color: "#e2e8f0" }} />
            <Line type="monotone" dataKey="sent" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="received" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```