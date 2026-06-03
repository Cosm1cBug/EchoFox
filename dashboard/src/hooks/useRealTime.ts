import { useEffect, useState } from "react";

export function useRealTime<T>(fetchFn: () => Promise<T>, intervalMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        const result = await fetchFn();
        if (isMounted) setData(result);
      } catch {
        if (isMounted) setError("Failed to fetch data");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, intervalMs);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchFn, intervalMs]);

  return { data, loading, error };
}
```