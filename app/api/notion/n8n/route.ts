import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isoWeekNumber(d: Date): number {
  const target = new Date(d);
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.floor(diff / 7);
}

/**
 * Build a single-week bucket from the most recent weekly source row.
 * Used for the weekly period because N8N Notion rows are weekly-granular;
 * sub-bucketing a weekly row into 7 daily buckets would show 6 empty days.
 */
function singleWeekBucket(raw: RawSnapshot[]): Bucket | null {
  if (raw.length === 0) return null;
  const mostRecent = raw[0];
  const [y, m, d] = mostRecent.date.split('-').map(Number);
  const weekStart = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const wn = isoWeekNumber(weekStart);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const toISO = (x: Date) => `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
  const metrics: Record<string, number> = {};
  for (const k of Object.keys(mostRecent.metrics)) {
    const v = mostRecent.metrics[k];
    metrics[k] = typeof v === 'number' && isFinite(v) ? v : 0;
  }
  return {
    id: toISO(weekStart),
    label: `W${wn}`,
    longLabel: `Week ${wn} · ${MONTH_SHORT[weekStart.getUTCMonth()]} ${weekStart.getUTCDate()}–${weekEnd.getUTCDate()}`,
    start: toISO(weekStart),
    end: toISO(weekEnd),
    count: 1,
    metrics,
  };
}

// Never cache this route — period parameter drives fresh Notion reads every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '88be8990-0676-4789-a5ca-0fdbff431c46';

// Metric aggregation rules for N8N
const AGG_RULES = {
  totalTriggers: 'sum',
  failedTriggers: 'sum',
  newWorkflows: 'sum',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
  activeWorkflows: 'last', // a running count — take most-recent-in-bucket
} as const;

// Mock raw snapshots for when no token is available (dated spanning 12 weeks)
function mockSnapshots(now: Date = new Date()): RawSnapshot[] {
  const out: RawSnapshot[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i * 7));
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({
      date: iso,
      metrics: {
        totalTriggers: 1550 - i * 45,
        failedTriggers: i % 3,
        activeWorkflows: 22 - (i % 4),
        newWorkflows: i % 2,
        hoursSaved: 43 - i,
        revenueImpact: 2100 - i * 60,
      },
    });
  }
  return out;
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
    totalTriggers: Math.round(b.metrics.totalTriggers ?? 0),
    failedTriggers: Math.round(b.metrics.failedTriggers ?? 0),
    activeWorkflows: Math.round(b.metrics.activeWorkflows ?? 0),
    newWorkflows: Math.round(b.metrics.newWorkflows ?? 0),
    hoursSaved: b.metrics.hoursSaved ?? 0,
    revenueImpact: b.metrics.revenueImpact ?? 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;
  const now = new Date();

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const raw = mockSnapshots(now);
    return buildFromRaw(raw, period, now, true);
  }

  try {
    const { queryDatabase, getNumber, getFormula, getDate } = await import('@/lib/notion');
    const rows = await queryDatabase(
      DB_ID,
      undefined,
      [{ property: 'Week Start Date', direction: 'descending' }],
    );

    const raw: RawSnapshot[] = rows
      .map((row) => {
        const date = getDate(row, 'Week Start Date');
        if (!date) return null;
        return {
          date,
          metrics: {
            totalTriggers: getNumber(row, 'Total Triggers'),
            failedTriggers: getNumber(row, 'Total Failed Triggers'),
            activeWorkflows: getNumber(row, 'Total Active Workflows'),
            newWorkflows: getNumber(row, 'New Workflows Launched'),
            hoursSaved: getFormula(row, 'Total Hours Saved'),
            revenueImpact: getFormula(row, 'Total Revenue Impact'),
          },
        } as RawSnapshot;
      })
      .filter((r): r is RawSnapshot => r !== null);

    return buildFromRaw(raw, period, now, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const raw = mockSnapshots(now);
    return buildFromRaw(raw, period, now, true, message);
  }
}

/**
 * Given raw weekly snapshots, build the response. For the weekly period we
 * show the most recent weekly row as a single week bucket (because N8N data
 * is weekly-granular; sub-bucketing into 7 daily buckets would leave 6 empty).
 * For monthly/quarterly/annually, we use the standard aggregate() pipeline.
 */
function buildFromRaw(raw: RawSnapshot[], period: DashboardPeriod, now: Date, mock: boolean, error?: string) {
  if (period === 'weekly') {
    const b = singleWeekBucket(raw);
    if (b) {
      const totals = {
        totalTriggers: b.metrics.totalTriggers ?? 0,
        failedTriggers: b.metrics.failedTriggers ?? 0,
        activeWorkflows: b.metrics.activeWorkflows ?? 0,
        newWorkflows: b.metrics.newWorkflows ?? 0,
        hoursSaved: b.metrics.hoursSaved ?? 0,
        revenueImpact: b.metrics.revenueImpact ?? 0,
      };
      return mkResponse([b], totals, 'week', mock, error);
    }
    // no data — fall through to empty aggregate
  }
  const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
  return mkResponse(buckets, totals, granularity, mock, error);
}

function mkResponse(
  buckets: Bucket[],
  totals: Record<string, number>,
  granularity: Granularity,
  mock: boolean,
  error?: string,
) {
  const bucketPayload = payloadFromBuckets(buckets);
  // snapshots = bucket payload in newest-first order (preserves legacy shape)
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      totalTriggers: Math.round(totals.totalTriggers ?? 0),
      failedTriggers: Math.round(totals.failedTriggers ?? 0),
      activeWorkflows: Math.round(totals.activeWorkflows ?? 0),
      newWorkflows: Math.round(totals.newWorkflows ?? 0),
      hoursSaved: totals.hoursSaved ?? 0,
      revenueImpact: totals.revenueImpact ?? 0,
    },
    granularity,
    mock,
    ...(error ? { error } : {}),
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
