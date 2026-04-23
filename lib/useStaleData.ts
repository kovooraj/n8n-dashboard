'use client';

import { useState, useEffect, useRef } from 'react';

interface StaleState<T> {
  data: T | null;
  loading: boolean;   // true only on first load with no cached data
  refreshing: boolean;
  stale: boolean;     // true when showing cached data while fetching fresh
}

/**
 * Stale-while-revalidate hook.
 *
 * On mount: immediately returns last value from localStorage (zero wait).
 * In background: fetches fresh data and updates state + cache.
 * Manual refresh: re-runs fetcher with isRefresh=true, skips showing stale.
 */
export function useStaleData<T>(
  cacheKey: string,
  fetcher: (isRefresh: boolean) => Promise<T>,
  deps: unknown[] = [],
): StaleState<T> & { refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hasCacheRef = useRef(false);

  const run = (isRefresh: boolean) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // On a fresh deps-triggered run, reset the cache flag so we correctly
    // show loading=true when there is no cache for the NEW cacheKey.
    if (!isRefresh) hasCacheRef.current = false;

    // Immediately serve stale data from localStorage (if available for this key)
    if (!isRefresh) {
      try {
        const raw = localStorage.getItem(`swr:${cacheKey}`);
        if (raw) {
          const cached = JSON.parse(raw) as { data: T };
          setData(cached.data);
          setLoading(false);
          setStale(true);
          hasCacheRef.current = true;
        }
      } catch { /* ignore */ }
    }

    if (isRefresh) {
      setRefreshing(true);
    } else if (!hasCacheRef.current) {
      setLoading(true);
    }

    fetcher(isRefresh)
      .then((fresh) => {
        if (controller.signal.aborted) return;
        setData(fresh);
        setStale(false);
        setLoading(false);
        setRefreshing(false);
        try {
          localStorage.setItem(`swr:${cacheKey}`, JSON.stringify({ data: fresh }));
        } catch { /* ignore quota errors */ }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(false); return () => abortRef.current?.abort(); }, deps);

  return { data, loading, refreshing, stale, refresh: () => run(true) };
}
