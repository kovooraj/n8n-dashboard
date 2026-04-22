import 'server-only';
import { supabase } from './supabase';
import type { RawSnapshot } from './aggregate';

export async function readSnapshots(
  source: string,
  fromDate: string,
  toDate: string,
): Promise<RawSnapshot[]> {
  const { data, error } = await supabase
    .from('dashboard_daily_snapshots')
    .select('date, metrics')
    .eq('source', source)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date');

  if (error) throw new Error(`DB read error [${source}]: ${error.message}`);

  return (data ?? []).map((row) => ({
    date: row.date as string,
    metrics: row.metrics as Record<string, number>,
  }));
}

export async function writeSnapshots(
  source: string,
  snapshots: RawSnapshot[],
): Promise<void> {
  if (snapshots.length === 0) return;
  const rows = snapshots.map((s) => ({
    date: s.date,
    source,
    metrics: s.metrics,
    synced_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('dashboard_daily_snapshots')
    .upsert(rows, { onConflict: 'date,source' });
  if (error) console.error(`DB write error [${source}]:`, error.message);
}

/** Store a full JSON payload (e.g. Claude leaderboard, Anthropic usage) keyed by date + source. */
export async function writePayload(source: string, date: string, payload: unknown): Promise<void> {
  const { error } = await supabase
    .from('dashboard_daily_snapshots')
    .upsert(
      [{ date, source, metrics: {}, payload, synced_at: new Date().toISOString() }],
      { onConflict: 'date,source' },
    );
  if (error) console.error(`DB payload write error [${source}]:`, error.message);
}

/** Read a full JSON payload stored by writePayload. Returns null if not found. */
export async function readPayload<T>(source: string, date: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('dashboard_daily_snapshots')
    .select('payload')
    .eq('source', source)
    .eq('date', date)
    .maybeSingle();
  if (error) throw new Error(`DB payload read error [${source}]: ${error.message}`);
  return (data?.payload as T) ?? null;
}

/** Returns 'YYYY-MM-DD' for yesterday (UTC). */
export function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Returns 'YYYY-MM-DD' for today (UTC). */
export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns all ISO date strings in [from, to] inclusive. */
export function dateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}
