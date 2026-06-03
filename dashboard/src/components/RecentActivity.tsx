interface ActivityItem {
  type: "message" | "command" | "alert";
  description: string;
  time: string;
}

interface RecentActivityProps {
  activities: ActivityItem[];
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-5 backdrop-blur">
      <h3 className="mb-4 text-sm font-semibold text-white">Recent Activity</h3>
      <div className="space-y-3 text-sm">
        {activities.length > 0 ? (
          activities.map((activity, index) => (
            <div key={index} className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-slate-300">{activity.description}</span>
              <span className="font-mono text-xs text-slate-500">{activity.time}</span>
            </div>
          ))
        ) : (
          <p className="text-slate-400">No recent activity.</p>
        )}
      </div>
    </div>
  );
}
```