import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

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
    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, true);
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

    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const raw = mockSnapshots(now);
    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, true, message);
  }
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
