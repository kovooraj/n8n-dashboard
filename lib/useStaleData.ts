'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Bump this integer whenever a server-side calculation changes so that
 * every browser's localStorage cache is automatically invalidated on
 * the next page load — preventing stale computed values from being shown.
 */
const CACHE_VERSION = 7;

interface StaleState<T> {
  data: T | null;
  loading: boolean;   // true only on first load with no cached data
  refreshing: boolean;
  stale: boolean;     // true when showing cached data while fetching fresh
  error: string | null; // last fetch error message, cleared on successful fetch
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
  const [error, setError] = useState<string | null>(null);
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
        const raw = localStorage.getItem(`swr_v${CACHE_VERSION}:${cacheKey}`);
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
        setError(null);
        try {
          localStorage.setItem(`swr_v${CACHE_VERSION}:${cacheKey}`, JSON.stringify({ data: fresh }));
        } catch { /* ignore quota errors */ }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setRefreshing(false);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(false); return () => abortRef.current?.abort(); }, deps);

  return { data, loading, refreshing, stale, error, refresh: () => run(true) };
}
