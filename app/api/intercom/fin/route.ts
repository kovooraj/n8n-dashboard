import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';
import { fetchIntercomDailySnapshots } from '@/lib/intercom-fin';
import { readSnapshots, writeSnapshots, todayUTC, dateRange } from '@/lib/db-snapshots';

type ChannelFilter = 'all' | 'messenger' | 'email';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CACHE_REVALIDATE_SEC = 25 * 60 * 60;
const CACHE_TAG = 'intercom-fin';

const AGG_RULES = {
  finInvolvement: 'sum',
  finResolved: 'sum',
  finAutomationRate: 'avg',
  csat: 'avg',
  finProcedureUses: 'sum',
  activeFinProcedures: 'last',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
} as const;

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly': return 10;
    case 'monthly': return 35;
    case 'quarterly': return 100;
    case 'annually': return 380;
  }
}

// Vercel Data Cache — fallback when DB is cold/missing dates
const getCachedDaily = unstable_cache(
  async (days: number): Promise<RawSnapshot[]> => fetchIntercomDailySnapshots(days),
  ['intercom-fin-daily'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: [CACHE_TAG] },
);

/**
 * Remap per-channel metric keys so the existing `aggregate()` function
 * sees the standard key names (finInvolvement, finResolved, etc.) regardless
 * of which channel filter is active.
 */
function remapForChannel(snapshots: RawSnapshot[], channel: ChannelFilter): RawSnapshot[] {
  if (channel === 'all') return snapshots;
  const prefix = `${channel}_`; // e.g. "messenger_" or "email_"
  return snapshots.map((s) => ({
    ...s,
    metrics: {
      // Replace the standard keys with channel-specific values
      finInvolvement:    s.metrics[`${prefix}finInvolvement`]    ?? 0,
      finResolved:       s.metrics[`${prefix}finResolved`]       ?? 0,
      finAutomationRate: s.metrics[`${prefix}finAutomationRate`] ?? 0,
      csat:              s.metrics[`${prefix}csat`]              ?? 0,
      hoursSaved:        s.metrics[`${prefix}hoursSaved`]        ?? 0,
      revenueImpact:     s.metrics[`${prefix}revenueImpact`]     ?? 0,
      finProcedureUses:    s.metrics.finProcedureUses    ?? 0,
      activeFinProcedures: s.metrics.activeFinProcedures ?? 0,
    },
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period  = (searchParams.get('period')  ?? 'weekly') as DashboardPeriod;
  const channel = (searchParams.get('channel') ?? 'all')    as ChannelFilter;
  const now = new Date();

  if (!process.env.INTERCOM_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: 'INTERCOM_ACCESS_TOKEN not set' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const days = lookbackDays(period);
  const ua = request.headers.get('user-agent') ?? '';
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  const forceRefresh = isCron || searchParams.get('refresh') === '1';
  if (forceRefresh) revalidateTag(CACHE_TAG, 'max');

  try {
    const today = todayUTC();
    const fromDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // Yesterday is the last completed day (data won't change anymore)
    const yesterdayDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

    let daily: RawSnapshot[];

    if (!forceRefresh && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Try DB-first: read all completed days from Supabase
      const dbSnaps = await readSnapshots('intercom-fin', fromDate, yesterdayDate).catch(() => [] as RawSnapshot[]);
      const dbDates = new Set(dbSnaps.map((s) => s.date));
      const neededDates = dateRange(fromDate, yesterdayDate);
      const missingDates = neededDates.filter((d) => !dbDates.has(d));

      if (missingDates.length === 0) {
        // All historical days in DB — only need today from live (1-day fetch, fast)
        const todaySnaps = await fetchIntercomDailySnapshots(1).catch(() => [] as RawSnapshot[]);
        const todaySnap = todaySnaps.find((s) => s.date === today);
        daily = todaySnap ? [...dbSnaps, todaySnap] : dbSnaps;
      } else {
        // DB missing some days — do full live fetch then persist to DB
        daily = await getCachedDaily(days);
        const completedSnaps = daily.filter((s) => s.date < today);
        writeSnapshots('intercom-fin', completedSnaps).catch(console.error);
      }
    } else {
      daily = await getCachedDaily(days);
    }

    const channelData = remapForChannel(daily, channel);
    const { buckets, totals, granularity } = aggregate(channelData, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, channel);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `intercom-error: ${message}` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

interface BucketPayload {
  id: string;
  weekLabel: string;
  label: string;
  start: string;
  end: string;
  count: number;
  finInvolvement: number;
  finResolved: number;
  finAutomationRate: number;
  csat: number;
  finProcedureUses: number;
  activeFinProcedures: number;
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
    finInvolvement: Math.round(b.metrics.finInvolvement ?? 0),
    finResolved: Math.round(b.metrics.finResolved ?? 0),
    finAutomationRate: Number((b.metrics.finAutomationRate ?? 0).toFixed(1)),
    csat: Number((b.metrics.csat ?? 0).toFixed(1)),
    finProcedureUses: Math.round(b.metrics.finProcedureUses ?? 0),
    activeFinProcedures: Math.round(b.metrics.activeFinProcedures ?? 0),
    hoursSaved: Number((b.metrics.hoursSaved ?? 0).toFixed(2)),
    revenueImpact: Number((b.metrics.revenueImpact ?? 0).toFixed(2)),
  }));
}

function mkResponse(buckets: Bucket[], totals: Record<string, number>, granularity: Granularity, channel: ChannelFilter = 'all') {
  const bucketPayload = payloadFromBuckets(buckets);
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      finInvolvement: Math.round(totals.finInvolvement ?? 0),
      finResolved: Math.round(totals.finResolved ?? 0),
      finAutomationRate: totals.finInvolvement > 0
        ? Number(((totals.finResolved / totals.finInvolvement) * 100).toFixed(1))
        : 0,
      csat: Number((totals.csat ?? 0).toFixed(1)),
      finProcedureUses: Math.round(totals.finProcedureUses ?? 0),
      activeFinProcedures: Math.round(totals.activeFinProcedures ?? 0),
      hoursSaved: Number((totals.hoursSaved ?? 0).toFixed(2)),
      revenueImpact: Number((totals.revenueImpact ?? 0).toFixed(2)),
    },
    granularity,
    channel,
    mock: false,
    source: 'intercom',
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
