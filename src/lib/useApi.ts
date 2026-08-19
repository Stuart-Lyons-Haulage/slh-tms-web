import { useCallback, useEffect, useRef, useState } from 'react';
import { isDegradedProgressRefresh, type ProgressRefreshEnvelope } from '../liveProgressStabilityPatch';

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
      if (mounted.current && request === requestNumber.current) {
        const progressEnvelope = result as unknown as ProgressRefreshEnvelope;
        if (isDegradedProgressRefresh(progressEnvelope)) {
          // The run-progress API deliberately returns a 200 safe fallback if one
          // live calculation fails. Never let that transient fallback erase the
          // last confirmed progression that the operator has already seen.
          setData(current => current ?? result);
          setError(progressEnvelope.warning || 'Live progression refresh degraded; the last confirmed progression remains on screen.');
        } else {
          setData(result);
        }
      }
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
