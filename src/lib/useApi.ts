import { useCallback, useEffect, useRef, useState } from 'react';

export function useApi<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const requestNumber = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await load();
      if (mounted.current && request === requestNumber.current) setData(result);
    } catch (exception) {
      if (mounted.current && request === requestNumber.current)
        setError(exception instanceof Error ? exception.message : 'Unable to load this view.');
    } finally {
      if (mounted.current && request === requestNumber.current) setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}
