import { useCallback, useEffect, useState } from 'react';

export function useApi<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>(); const [error, setError] = useState<string>(); const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => { setLoading(true); setError(undefined); try { setData(await load()); } catch (exception) { setError(exception instanceof Error ? exception.message : 'Unable to load this view.'); } finally { setLoading(false); } }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { data, error, loading, refresh };
}
