import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';
import { fetchElevenLabsDailySnapshots } from '@/lib/elevenlabs-calls';
import { readSnapshots, writeSnapshots, todayUTC, dateRange } from '@/lib/db-snapshots';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CACHE_REVALIDATE_SEC = 25 * 60 * 60;
const CACHE_TAG = 'elevenlabs-calls';

const AGG_RULES = {
  calls: 'sum',
  avgDuration: 'avg',
  transferRate: 'avg',
  agents: 'last',
  csat: 'avg',
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

const getCachedDaily = unstable_cache(
  async (days: number): Promise<RawSnapshot[]> => fetchElevenLabsDailySnapshots(days),
  ['elevenlabs-calls-daily'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: [CACHE_TAG] },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;
  const now = new Date();

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: 'ELEVENLABS_API_KEY not set' },
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
    const yesterdayDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

    let daily: RawSnapshot[];

    if (!forceRefresh && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const dbSnaps = await readSnapshots('elevenlabs-calls', fromDate, yesterdayDate).catch(() => [] as RawSnapshot[]);
      const dbDates = new Set(dbSnaps.map((s) => s.date));
      const neededDates = dateRange(fromDate, yesterdayDate);
      const missingDates = neededDates.filter((d) => !dbDates.has(d));

      if (missingDates.length === 0) {
        const todaySnaps = await fetchElevenLabsDailySnapshots(1).catch(() => [] as RawSnapshot[]);
        const todaySnap = todaySnaps.find((s) => s.date === today);
        daily = todaySnap ? [...dbSnaps, todaySnap] : dbSnaps;
      } else {
        daily = await getCachedDaily(days);
        const completedSnaps = daily.filter((s) => s.date < today);
        writeSnapshots('elevenlabs-calls', completedSnaps).catch(console.error);
      }
    } else {
      daily = await getCachedDaily(days);
    }

    const { buckets, totals, granularity } = aggregate(daily, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `elevenlabs-error: ${message}` },
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
  calls: number;
  avgDuration: number;
  transferRate: number;
  agents: number;
  csat: number;
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
    calls: Math.round(b.metrics.calls ?? 0),
    avgDuration: Number((b.metrics.avgDuration ?? 0).toFixed(1)),
    transferRate: Number((b.metrics.transferRate ?? 0).toFixed(1)),
    agents: Math.round(b.metrics.agents ?? 0),
    csat: Number((b.metrics.csat ?? 0).toFixed(1)),
    hoursSaved: Number((b.metrics.hoursSaved ?? 0).toFixed(2)),
    revenueImpact: Number((b.metrics.revenueImpact ?? 0).toFixed(2)),
  }));
}

function mkResponse(buckets: Bucket[], totals: Record<string, number>, granularity: Granularity) {
  const bucketPayload = payloadFromBuckets(buckets);
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      calls: Math.round(totals.calls ?? 0),
      avgDuration: Number((totals.avgDuration ?? 0).toFixed(1)),
      transferRate: Number((totals.transferRate ?? 0).toFixed(1)),
      agents: Math.round(totals.agents ?? 0),
      csat: Number((totals.csat ?? 0).toFixed(1)),
      hoursSaved: Number((totals.hoursSaved ?? 0).toFixed(2)),
      revenueImpact: Number((totals.revenueImpact ?? 0).toFixed(2)),
    },
    granularity,
    mock: false,
    source: 'elevenlabs',
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
