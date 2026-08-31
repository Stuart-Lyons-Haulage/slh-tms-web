/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DataIntegrityError } from '../api/apiClient';
import { isDegradedProgressRefresh, type ProgressRefreshEnvelope } from '../liveProgressStabilityPatch';

export function useApi<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [dataProblem, setDataProblem] = useState<DataIntegrityError>();
  const [loading, setLoading] = useState(true);
  const requestNumber = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    const request = ++requestNumber.current;
    const operation = (async () => {
      setLoading(true);
      setError(undefined);
      setDataProblem(undefined);
      try {
        const result = await load();
        if (mounted.current && request === requestNumber.current) {
          const progressEnvelope = result as unknown as ProgressRefreshEnvelope;
          if (isDegradedProgressRefresh(progressEnvelope)) {
            setData(current => current ?? result);
            setError(progressEnvelope.warning || 'Live progression refresh degraded; the last confirmed progression remains on screen.');
          } else {
            setData(result);
          }
        }
      } catch (exception) {
        if (mounted.current && request === requestNumber.current) {
          if (exception instanceof DataIntegrityError) {
            setDataProblem(exception);
            setError(`Data problem: ${exception.summary || exception.message}`);
          } else {
            setError(exception instanceof Error ? exception.message : 'Unable to load this view.');
          }
        }
      } finally {
        if (mounted.current && request === requestNumber.current) setLoading(false);
      }
    })();
    inFlight.current = operation;
    try { await operation; }
    finally { if (inFlight.current === operation) inFlight.current = null; }
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  return { data: data as any, error, dataProblem, loading, refresh };
}
