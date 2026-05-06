import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod, N8nExecution } from '@/lib/types';
import {
  aggregate,
  buildBucketRange,
  type RawSnapshot,
  type Bucket,
  type Granularity,
} from '@/lib/aggregate';
import { fetchAllWorkflows, fetchExecutionsBatch } from '@/lib/n8n';
import { readSnapshots, todayUTC } from '@/lib/db-snapshots';

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const dynamic = 'force-dynamic';

// Business-impact constants — same baseline as FIN / ElevenLabs
// 10 min of manual effort saved per successful n8n execution, $20/hr labour cost
const MINUTES_PER_SUCCESS = 10;
const REVENUE_PER_HOUR    = 20;

function calcHours(successes: number): number {
  return (successes * MINUTES_PER_SUCCESS) / 60;
}
function calcRevenue(hours: number): number {
  return hours * REVENUE_PER_HOUR;
}

const AGG_RULES = {
  totalTriggers:   'sum',
  failedTriggers:  'sum',
  newWorkflows:    'sum',
  hoursSaved:      'sum',
  revenueImpact:   'sum',
  activeWorkflows: 'last',
} as const;

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 10;
    case 'monthly':   return 35;
    case 'quarterly': return 190; // prev Q (3 mo) + current Q (3 mo) = ~6 months
    case 'annually':  return 380;
  }
}

/**
 * Read n8n execution history from Supabase and normalise to the shape
 * aggregate() expects.
 *
 * The daily cron stored rows with either:
 *   old keys → { total, success, error }
 *   new keys → { totalTriggers, failedTriggers, successTriggers, hoursSaved, revenueImpact }
 * Both are handled below so historical rows still work.
 */
async function loadSupabaseRaw(period: DashboardPeriod, now: Date): Promise<RawSnapshot[]> {
  const days = lookbackDays(period);
  const fromDate = new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10);
  const toDate = toISO(now);

  const rows = await readSnapshots('n8n-history', fromDate, toDate);

  return rows.map((r) => {
    const m = r.metrics as Record<string, number>;

    // Support both old and new field names
    const total   = m.totalTriggers   ?? m.total   ?? 0;
    const failed  = m.failedTriggers  ?? m.error   ?? 0;
    const success = m.successTriggers ?? m.success  ?? Math.max(0, total - failed);

    // Use pre-calculated values if stored, otherwise derive from counts
    const hours   = m.hoursSaved      ?? calcHours(success);
    const revenue = m.revenueImpact   ?? calcRevenue(hours);

    return {
      date: r.date,
      metrics: {
        totalTriggers:   total,
        failedTriggers:  failed,
        hoursSaved:      hours,
        revenueImpact:   revenue,
        activeWorkflows: 0,   // overridden by live count in GET
        newWorkflows:    0,
      },
    } as RawSnapshot;
  });
}

interface BucketPayload {
  id: string;
  weekLabel: string;
  label: string;
  start: string;
  end: string;
  count: number;
  totalTriggers: number;
  failedTriggers: number;
  activeWorkflows: number;
  newWorkflows: number;
  hoursSaved: number;
  revenueImpact: number;
}

function payloadFromBuckets(buckets: Bucket[]): BucketPayload[] {
  return buckets.map((b) => ({
    id: b.id,
    weekLabel: b.longLabel,
    label: b.label,
    start: b.start,
    end: b.end,
    count: b.count,
    totalTriggers:   Math.round(b.metrics.totalTriggers   ?? 0),
    failedTriggers:  Math.round(b.metrics.failedTriggers  ?? 0),
    activeWorkflows: Math.round(b.metrics.activeWorkflows ?? 0),
    newWorkflows:    Math.round(b.metrics.newWorkflows     ?? 0),
    hoursSaved:      Math.round(b.metrics.hoursSaved       ?? 0),
    revenueImpact:   Math.round(b.metrics.revenueImpact   ?? 0),
  }));
}

/**
 * LIVE weekly path — pulls fresh execution counts directly from the n8n API
 * and buckets them into 7 daily slots.
 * Business-impact metrics are derived from actual success counts
 * (no external data source needed).
 */
async function buildWeeklyLive(now: Date): Promise<Response> {
  const allWorkflows = await fetchAllWorkflows();
  const activeWorkflows = allWorkflows.filter((w) => w.active);
  const activeCount = activeWorkflows.length;

  const execMap = await fetchExecutionsBatch(activeWorkflows.map((w) => w.id), 100);

  // 7 daily bucket shells
  const range = buildBucketRange('weekly', now);
  const bucketMap = new Map<string, BucketPayload>();
  const orderedBuckets: BucketPayload[] = [];

  for (const b of range.buckets) {
    const payload: BucketPayload = {
      id: toISO(b.start),
      weekLabel: b.longLabel,
      label: b.label,
      start: toISO(b.start),
      end: toISO(b.end),
      count: 0,
      totalTriggers: 0,
      failedTriggers: 0,
      activeWorkflows: activeCount,
      newWorkflows: 0,
      hoursSaved: 0,
      revenueImpact: 0,
    };
    orderedBuckets.push(payload);
    bucketMap.set(payload.id, payload);
  }

  const rangeStart = range.rangeStart;
  const rangeEnd = new Date(range.rangeEnd);
  rangeEnd.setUTCHours(23, 59, 59, 999);

  let totalTriggers = 0;
  let totalSuccess  = 0;
  let failedTriggers = 0;

  for (const execs of execMap.values()) {
    for (const exec of execs as N8nExecution[]) {
      if (!exec.startedAt) continue;
      const d = new Date(exec.startedAt);
      if (isNaN(d.getTime())) continue;
      if (d < rangeStart || d > rangeEnd) continue;

      const dayKey = toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
      const bucket = bucketMap.get(dayKey);
      if (!bucket) continue;

      bucket.count         += 1;
      bucket.totalTriggers += 1;
      totalTriggers        += 1;

      if (exec.status === 'success') {
        totalSuccess += 1;
      } else if (exec.status === 'error' || exec.status === 'crashed') {
        bucket.failedTriggers += 1;
        failedTriggers        += 1;
      }
    }
  }

  // New workflows launched within the window
  let newWorkflows = 0;
  for (const wf of allWorkflows) {
    const created = wf.createdAt ? new Date(wf.createdAt) : null;
    if (!created || isNaN(created.getTime())) continue;
    if (created >= rangeStart && created <= rangeEnd) {
      newWorkflows += 1;
      const dayKey = toISO(new Date(Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate())));
      const bucket = bucketMap.get(dayKey);
      if (bucket) bucket.newWorkflows += 1;
    }
  }

  // Distribute business-impact metrics proportionally to each day's trigger share
  const totalHours   = calcHours(totalSuccess);
  const totalRevenue = calcRevenue(totalHours);

  if (totalTriggers > 0 && totalHours > 0) {
    for (const b of orderedBuckets) {
      const weight    = b.totalTriggers / totalTriggers;
      const daySuccess = b.totalTriggers - b.failedTriggers;
      b.hoursSaved    = Math.round(calcHours(daySuccess));
      b.revenueImpact = Math.round(calcRevenue(b.hoursSaved));
    }
  }

  const body = {
    snapshots: [...orderedBuckets].reverse(),
    buckets:   orderedBuckets,
    totals: {
      totalTriggers,
      failedTriggers,
      activeWorkflows: activeCount,
      newWorkflows,
      hoursSaved:    Math.round(totalHours),
      revenueImpact: Math.round(totalRevenue),
    },
    granularity: 'day' as Granularity,
    mock: false,
    source: 'live-n8n',
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;
  const now = new Date();

  // ── WEEKLY: always use live n8n execution data (fresh, fast) ──
  if (period === 'weekly') {
    try {
      return await buildWeeklyLive(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Fall back to Supabase historical data if live fetch fails
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        try {
          const raw = await loadSupabaseRaw(period, now);
          if (raw.length > 0) return buildFromRaw(raw, period, now, false, `live-failed: ${message}`, null);
        } catch { /* fall through */ }
      }
      return NextResponse.json(
        { error: `n8n-error: ${message}` },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  }

  // ── MONTHLY / QUARTERLY / ANNUALLY: read from Supabase daily snapshots ──
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_SUPABASE_URL not set' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const raw = await loadSupabaseRaw(period, now);

    // Attach live active workflow count so the KPI card always reflects reality
    let liveActive: number | null = null;
    try {
      const wfs = await fetchAllWorkflows();
      liveActive = wfs.filter((w) => w.active).length;
    } catch { /* non-fatal */ }

    return buildFromRaw(raw, period, now, false, undefined, liveActive);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `n8n-error: ${message}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function buildFromRaw(
  raw: RawSnapshot[],
  period: DashboardPeriod,
  now: Date,
  mock: boolean,
  error: string | undefined,
  liveActive: number | null,
) {
  const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
  return mkResponse(buckets, totals, granularity, mock, error, liveActive);
}

function mkResponse(
  buckets: Bucket[],
  totals: Record<string, number>,
  granularity: Granularity,
  mock: boolean,
  error: string | undefined,
  liveActive: number | null,
) {
  const bucketPayload = payloadFromBuckets(buckets);
  const activeWorkflowsTotal = liveActive != null ? liveActive : Math.round(totals.activeWorkflows ?? 0);

  const body = {
    snapshots: [...bucketPayload].reverse(),
    buckets:   bucketPayload,
    totals: {
      totalTriggers:   Math.round(totals.totalTriggers   ?? 0),
      failedTriggers:  Math.round(totals.failedTriggers  ?? 0),
      activeWorkflows: activeWorkflowsTotal,
      newWorkflows:    Math.round(totals.newWorkflows     ?? 0),
      hoursSaved:      Math.round(totals.hoursSaved       ?? 0),
      revenueImpact:   Math.round(totals.revenueImpact   ?? 0),
    },
    granularity,
    mock,
    source: liveActive != null ? 'supabase+live-active' : 'supabase',
    ...(error ? { error } : {}),
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
