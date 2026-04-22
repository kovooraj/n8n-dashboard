export const dynamic = 'force-dynamic';

import type { NextRequest } from 'next/server';
import { fetchAllWorkflows, fetchExecutionsForPeriod } from '@/lib/n8n';
import type { DailyBucket, HistoryData, HistoryPeriod } from '@/lib/types';
import { readSnapshots, writeSnapshots, todayUTC, dateRange } from '@/lib/db-snapshots';

const PERIOD_DAYS: Record<HistoryPeriod, number> = {
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

const PERIOD_LIMIT: Record<HistoryPeriod, number> = {
  week: 100,
  month: 250,
  quarter: 250,
  year: 250,
};

function periodStart(period: HistoryPeriod): Date {
  const d = new Date();
  d.setDate(d.getDate() - PERIOD_DAYS[period]);
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildDateBuckets(since: Date): Map<string, DailyBucket> {
  const map = new Map<string, DailyBucket>();
  const cursor = new Date(since);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    map.set(key, { date: key, total: 0, success: 0, error: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return map;
}

async function fetchLiveHistory(
  since: Date,
  limit: number,
  workflowId: string | null,
): Promise<Map<string, DailyBucket>> {
  let workflowIds: string[];
  if (workflowId) {
    workflowIds = [workflowId];
  } else {
    const allWorkflows = await fetchAllWorkflows();
    workflowIds = allWorkflows.filter((w) => w.active).map((w) => w.id);
  }

  const BATCH_SIZE = 5;
  const allExecutions: import('@/lib/types').N8nExecution[] = [];

  for (let i = 0; i < workflowIds.length; i += BATCH_SIZE) {
    const batch = workflowIds.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (id) => {
        try { return await fetchExecutionsForPeriod(id, since, limit); }
        catch { return []; }
      }),
    );
    for (const execs of results) allExecutions.push(...execs);
  }

  const bucketMap = buildDateBuckets(since);
  for (const exec of allExecutions) {
    if (!exec.startedAt) continue;
    const dateKey = new Date(exec.startedAt).toISOString().slice(0, 10);
    const bucket = bucketMap.get(dateKey);
    if (!bucket) continue;
    bucket.total += 1;
    if (exec.status === 'success') bucket.success += 1;
    else if (exec.status === 'error' || exec.status === 'crashed') bucket.error += 1;
  }

  return bucketMap;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { searchParams } = request.nextUrl;
    const rawPeriod = searchParams.get('period') ?? 'week';
    const workflowId = searchParams.get('workflowId') ?? null;

    const period: HistoryPeriod = (['week', 'month', 'quarter', 'year'] as const).includes(
      rawPeriod as HistoryPeriod,
    )
      ? (rawPeriod as HistoryPeriod)
      : 'week';

    const since = periodStart(period);
    const limit = PERIOD_LIMIT[period];
    const today = todayUTC();
    const fromDate = since.toISOString().slice(0, 10);
    const yesterdayDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const dbSource = workflowId ? `n8n-history-${workflowId}` : 'n8n-history';

    let bucketMap: Map<string, DailyBucket>;

    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const dbSnaps = await readSnapshots(dbSource, fromDate, yesterdayDate).catch(() => []);
      const dbDates = new Set(dbSnaps.map((s) => s.date));
      const neededDates = dateRange(fromDate, yesterdayDate);
      const missingDates = neededDates.filter((d) => !dbDates.has(d));

      if (missingDates.length === 0) {
        // All historical days in DB — only live-fetch today
        bucketMap = buildDateBuckets(since);
        for (const snap of dbSnaps) {
          const b = bucketMap.get(snap.date);
          if (b) {
            b.total = snap.metrics.total ?? 0;
            b.success = snap.metrics.success ?? 0;
            b.error = snap.metrics.error ?? 0;
          }
        }
        // Fetch today's live data
        const todaySince = new Date(today + 'T00:00:00Z');
        const todayMap = await fetchLiveHistory(todaySince, 100, workflowId).catch(() => new Map<string, DailyBucket>());
        const todayBucket = todayMap.get(today);
        if (todayBucket) bucketMap.set(today, todayBucket);
      } else {
        // Missing historical data — full live fetch, then persist
        bucketMap = await fetchLiveHistory(since, limit, workflowId);
        const completedSnaps = Array.from(bucketMap.entries())
          .filter(([date]) => date < today)
          .map(([date, b]) => ({
            date,
            metrics: { total: b.total, success: b.success, error: b.error },
          }));
        writeSnapshots(dbSource, completedSnaps).catch(console.error);
      }
    } else {
      bucketMap = await fetchLiveHistory(since, limit, workflowId);
    }

    const buckets = Array.from(bucketMap.values());
    const totalRuns = buckets.reduce((s, b) => s + b.total, 0);
    const successRuns = buckets.reduce((s, b) => s + b.success, 0);
    const errorRuns = buckets.reduce((s, b) => s + b.error, 0);

    const payload: HistoryData = {
      period,
      workflowId,
      buckets,
      totalRuns,
      successRuns,
      errorRuns,
      fetchedAt: new Date().toISOString(),
    };

    return Response.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json(
      {
        period: 'week',
        workflowId: null,
        buckets: [],
        totalRuns: 0,
        successRuns: 0,
        errorRuns: 0,
        fetchedAt: new Date().toISOString(),
        error: message,
      } satisfies HistoryData,
      { status: 200 },
    );
  }
}
