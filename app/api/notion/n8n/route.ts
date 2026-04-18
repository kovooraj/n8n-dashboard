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

function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }
function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Never cache this route — period parameter drives fresh reads every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '88be8990-0676-4789-a5ca-0fdbff431c46';

// Metric aggregation rules for N8N (Notion path, monthly+)
const AGG_RULES = {
  totalTriggers: 'sum',
  failedTriggers: 'sum',
  newWorkflows: 'sum',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
  activeWorkflows: 'last', // running count — take most-recent-in-bucket
} as const;

// Mock raw snapshots for when no Notion token is available
function mockSnapshots(now: Date = new Date()): RawSnapshot[] {
  const out: RawSnapshot[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i * 7));
    const iso = toISO(d);
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

/**
 * Read the most recent Notion weekly row to recover hoursSaved / revenueImpact
 * business-impact estimates for the live-weekly path (those aren't derivable
 * from n8n executions). Returns nulls if Notion isn't reachable.
 */
async function loadLatestNotionWeekly(): Promise<{ hoursSaved: number; revenueImpact: number } | null> {
  if (!process.env.NOTION_TOKEN) return null;
  try {
    const { queryDatabase, getFormula, getDate } = await import('@/lib/notion');
    const rows = await queryDatabase(
      DB_ID,
      undefined,
      [{ property: 'Week Start Date', direction: 'descending' }],
    );
    for (const row of rows) {
      const date = getDate(row, 'Week Start Date');
      if (!date) continue;
      return {
        hoursSaved: getFormula(row, 'Total Hours Saved') ?? 0,
        revenueImpact: getFormula(row, 'Total Revenue Impact') ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadNotionRaw(): Promise<RawSnapshot[]> {
  const { queryDatabase, getNumber, getFormula, getDate } = await import('@/lib/notion');
  const rows = await queryDatabase(
    DB_ID,
    undefined,
    [{ property: 'Week Start Date', direction: 'descending' }],
  );

  return rows
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
}

/**
 * LIVE weekly path: pull current workflow list + recent executions from n8n,
 * bucket executions into the last 7 days. `activeWorkflows` = true count from
 * live API (not Notion's snapshot number). Business-impact estimates fall back
 * to the latest Notion weekly row since they're not in execution data.
 */
async function buildWeeklyLive(now: Date): Promise<Response> {
  const allWorkflows = await fetchAllWorkflows();
  const activeWorkflows = allWorkflows.filter((w) => w.active);
  const activeCount = activeWorkflows.length;

  // 100 executions per workflow covers busy 7-day windows without overloading n8n
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
      bucket.count += 1;
      bucket.totalTriggers += 1;
      totalTriggers += 1;
      if (exec.status === 'error' || exec.status === 'crashed') {
        bucket.failedTriggers += 1;
        failedTriggers += 1;
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

  // Business-impact estimates: pull latest Notion weekly row, distribute by trigger share
  const latest = await loadLatestNotionWeekly();
  const hoursSaved = latest?.hoursSaved ?? 0;
  const revenueImpact = latest?.revenueImpact ?? 0;
  if (totalTriggers > 0 && (hoursSaved > 0 || revenueImpact > 0)) {
    for (const b of orderedBuckets) {
      const weight = b.totalTriggers / totalTriggers;
      b.hoursSaved = Math.round(hoursSaved * weight * 10) / 10;
      b.revenueImpact = Math.round(revenueImpact * weight);
    }
  }

  const body = {
    snapshots: [...orderedBuckets].reverse(),
    buckets: orderedBuckets,
    totals: {
      totalTriggers,
      failedTriggers,
      activeWorkflows: activeCount,
      newWorkflows,
      hoursSaved,
      revenueImpact,
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

  // ── LIVE PATH: weekly always uses live n8n execution data ──
  if (period === 'weekly') {
    try {
      return await buildWeeklyLive(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      // Fall back to Notion/mock if live fetch fails
      const token = process.env.NOTION_TOKEN;
      if (token) {
        try {
          const raw = await loadNotionRaw();
          return buildFromRaw(raw, period, now, false, `live-fetch-failed: ${message}`, null);
        } catch {
          /* fall through */
        }
      }
      const raw = mockSnapshots(now);
      return buildFromRaw(raw, period, now, true, `live-fetch-failed: ${message}`, null);
    }
  }

  // ── NOTION PATH: monthly / quarterly / annually ──
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const raw = mockSnapshots(now);
    return buildFromRaw(raw, period, now, true, undefined, null);
  }

  try {
    const raw = await loadNotionRaw();
    // Attach live active workflow count so KPI cards reflect reality even on
    // non-weekly periods (user: "always reflect reality")
    let liveActive: number | null = null;
    try {
      const wfs = await fetchAllWorkflows();
      liveActive = wfs.filter((w) => w.active).length;
    } catch {
      liveActive = null;
    }
    return buildFromRaw(raw, period, now, false, undefined, liveActive);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const raw = mockSnapshots(now);
    return buildFromRaw(raw, period, now, true, message, null);
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
  // Prefer live active workflow count over Notion's snapshot number
  const activeWorkflowsTotal =
    liveActive != null ? liveActive : Math.round(totals.activeWorkflows ?? 0);
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      totalTriggers: Math.round(totals.totalTriggers ?? 0),
      failedTriggers: Math.round(totals.failedTriggers ?? 0),
      activeWorkflows: activeWorkflowsTotal,
      newWorkflows: Math.round(totals.newWorkflows ?? 0),
      hoursSaved: totals.hoursSaved ?? 0,
      revenueImpact: totals.revenueImpact ?? 0,
    },
    granularity,
    mock,
    source: liveActive != null ? 'notion+live-active' : 'notion',
    ...(error ? { error } : {}),
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
