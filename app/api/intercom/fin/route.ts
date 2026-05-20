import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, periodLookbackDays, periodDateRange, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';
import { fetchIntercomDailySnapshots } from '@/lib/intercom-fin';
import { readSnapshots, writeSnapshots, todayUTC, dateRange } from '@/lib/db-snapshots';

type ChannelFilter = 'all' | 'messenger' | 'email';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const CACHE_REVALIDATE_SEC = 25 * 60 * 60;
const PERIOD_CACHE_SEC     = 22 * 60 * 60; // non-weekly: recompute ~daily
const CACHE_TAG = 'intercom-fin';

const AGG_RULES = {
  finInvolvement: 'sum',
  finResolved: 'sum',
  finPending: 'sum',
  finAutomationRate: 'avg',
  // CSAT % is now derived from csatPositive / csatCount sums so multi-day totals are exact
  csatPositive: 'sum',
  csatCount: 'sum',
  csat: 'avg', // legacy per-day average — only used as fallback when sums are absent
  finProcedureUses: 'sum',
  activeFinProcedures: 'last',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
} as const;

// `periodLookbackDays` is the canonical "how many days back to query" value,
// shared with all other routes via lib/aggregate.ts.

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
      finPending:        s.metrics[`${prefix}finPending`]        ?? 0,
      finAutomationRate: s.metrics[`${prefix}finAutomationRate`] ?? 0,
      csatPositive:      s.metrics[`${prefix}csatPositive`]      ?? 0,
      csatCount:         s.metrics[`${prefix}csatCount`]         ?? 0,
      csat:              s.metrics[`${prefix}csat`]              ?? 0,
      hoursSaved:        s.metrics[`${prefix}hoursSaved`]        ?? 0,
      revenueImpact:     s.metrics[`${prefix}revenueImpact`]     ?? 0,
      finProcedureUses:    s.metrics.finProcedureUses    ?? 0,
      activeFinProcedures: s.metrics.activeFinProcedures ?? 0,
    },
  }));
}

/**
 * Cache the fully-computed response body for non-weekly periods (~22 hrs).
 *
 * DB-first: reads `intercom-fin` snapshots from Supabase for the precise
 * period window. Falls back to a live Intercom fetch only if the DB is
 * empty (e.g., new install). This avoids the pathology where a transient
 * Intercom 0-result gets cached for 22 hours.
 *
 * The cron job's revalidateTag(CACHE_TAG) invalidates this alongside raw data.
 */
const getSlowPeriodBody = unstable_cache(
  async (period: string, channel: string, days: number): Promise<object> => {
    const now = new Date();
    const { startDate, endDate } = periodDateRange(period as DashboardPeriod, now);

    let daily: RawSnapshot[] = [];
    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      daily = await readSnapshots('intercom-fin', startDate, endDate).catch(() => [] as RawSnapshot[]);
    }
    // Fallback only if DB has no rows at all for the window
    if (daily.length === 0) {
      daily = await getCachedDaily(days);
    }

    const channelData = remapForChannel(daily, channel as ChannelFilter);
    const { buckets, totals, granularity } = aggregate(channelData, period as DashboardPeriod, AGG_RULES, now);
    const bucketPayload = payloadFromBuckets(buckets);
    const snapshots = [...bucketPayload].reverse();
    // Precise CSAT from raw sums (positive / count * 100). Falls back to
    // legacy per-day average when csatCount sum is zero (e.g. cached rows
    // pre-dating the schema change).
    const csatCount    = Number(totals.csatCount    ?? 0);
    const csatPositive = Number(totals.csatPositive ?? 0);
    const csat = csatCount > 0 ? (csatPositive / csatCount) * 100 : (totals.csat ?? 0);
    return {
      snapshots,
      buckets: bucketPayload,
      totals: {
        finInvolvement:    Math.round(totals.finInvolvement ?? 0),
        finResolved:       Math.round(totals.finResolved ?? 0),
        finPending:        Math.round(totals.finPending ?? 0),
        finAutomationRate: totals.finInvolvement > 0
          ? Number(((totals.finResolved / totals.finInvolvement) * 100).toFixed(1))
          : 0,
        csat:               Number(csat.toFixed(1)),
        csatPositive:       Math.round(csatPositive),
        csatCount:          Math.round(csatCount),
        finProcedureUses:   Math.round(totals.finProcedureUses ?? 0),
        activeFinProcedures:Math.round(totals.activeFinProcedures ?? 0),
        hoursSaved:         Number((totals.hoursSaved ?? 0).toFixed(2)),
        revenueImpact:      Number((totals.revenueImpact ?? 0).toFixed(2)),
      },
      granularity,
      channel,
      mock: false,
      source: 'intercom',
    };
  },
  ['intercom-fin-period-body-v3-pending-csat'],
  { revalidate: PERIOD_CACHE_SEC, tags: [CACHE_TAG] },
);

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

  const days = periodLookbackDays(period);
  const ua = request.headers.get('user-agent') ?? '';
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  // ?warm=1 = cron cache pre-population (do NOT invalidate, just fill the slow-period cache)
  const isWarm       = searchParams.get('warm')    === '1';
  const forceRefresh = (!isWarm && isCron) || searchParams.get('refresh') === '1';
  if (forceRefresh) revalidateTag(CACHE_TAG, 'max');

  // ── Slow-period fast path: monthly / quarterly / annually ──────────────────
  // Always served via the 22-hour period cache.
  // forceRefresh already invalidated the tag above, so getSlowPeriodBody will
  // recompute and re-populate the cache for the next 22 hours.
  if (period !== 'weekly') {
    try {
      const body = await getSlowPeriodBody(period, channel, days);
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Fall through to the live path on cache failure
    }
  }

  try {
    const today = todayUTC();
    const fromDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    // Yesterday is the last completed day (data won't change anymore)
    const yesterdayDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

    let daily: RawSnapshot[];

    /** True if a snapshot row was stored before channel metrics were added. */
    function lacksChannelData(snaps: RawSnapshot[]): boolean {
      if (snaps.length === 0) return false;
      return !snaps.some((s) => s.metrics.messenger_finInvolvement != null);
    }

    if (!forceRefresh && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Try DB-first: read all completed days from Supabase
      const dbSnaps = await readSnapshots('intercom-fin', fromDate, yesterdayDate).catch(() => [] as RawSnapshot[]);
      const dbDates = new Set(dbSnaps.map((s) => s.date));
      const neededDates = dateRange(fromDate, yesterdayDate);
      const missingDates = neededDates.filter((d) => !dbDates.has(d));

      // Also treat old rows (no channel metrics) as a cache miss so they
      // get re-fetched and rewritten with messenger_* / email_* keys.
      const needsRebuild = missingDates.length > 0 || lacksChannelData(dbSnaps);

      if (!needsRebuild) {
        // All historical days in DB and channel-aware — only need today from live
        const todaySnaps = await fetchIntercomDailySnapshots(1).catch(() => [] as RawSnapshot[]);
        const todaySnap = todaySnaps.find((s) => s.date === today);
        daily = todaySnap ? [...dbSnaps, todaySnap] : dbSnaps;
      } else {
        // DB missing days or missing channel data — full live fetch then persist
        daily = await getCachedDaily(days);
        const completedSnaps = daily.filter((s) => s.date < today);
        writeSnapshots('intercom-fin', completedSnaps).catch(console.error);
      }
    } else {
      // Force refresh — re-fetch from Intercom and write back to DB so
      // subsequent non-refresh loads serve channel-aware rows.
      daily = await getCachedDaily(days);
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const completedSnaps = daily.filter((s) => s.date < today);
        writeSnapshots('intercom-fin', completedSnaps).catch(console.error);
      }
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
  finPending: number;
  finAutomationRate: number;
  csat: number;
  finProcedureUses: number;
  activeFinProcedures: number;
  hoursSaved: number;
  revenueImpact: number;
}

function payloadFromBuckets(buckets: Bucket[]): BucketPayload[] {
  return buckets.map((b) => {
    // Recompute CSAT per bucket from the raw sums if available
    const cnt = Number(b.metrics.csatCount ?? 0);
    const pos = Number(b.metrics.csatPositive ?? 0);
    const csatPct = cnt > 0 ? (pos / cnt) * 100 : (b.metrics.csat ?? 0);
    return {
      id: b.id,
      weekLabel: b.longLabel,
      label: b.label,
      start: b.start,
      end: b.end,
      count: b.count,
      finInvolvement: Math.round(b.metrics.finInvolvement ?? 0),
      finResolved: Math.round(b.metrics.finResolved ?? 0),
      finPending: Math.round(b.metrics.finPending ?? 0),
      finAutomationRate: Number((b.metrics.finAutomationRate ?? 0).toFixed(1)),
      csat: Number(csatPct.toFixed(1)),
      finProcedureUses: Math.round(b.metrics.finProcedureUses ?? 0),
      activeFinProcedures: Math.round(b.metrics.activeFinProcedures ?? 0),
      hoursSaved: Number((b.metrics.hoursSaved ?? 0).toFixed(2)),
      revenueImpact: Number((b.metrics.revenueImpact ?? 0).toFixed(2)),
    };
  });
}

function mkResponse(buckets: Bucket[], totals: Record<string, number>, granularity: Granularity, channel: ChannelFilter = 'all') {
  const bucketPayload = payloadFromBuckets(buckets);
  const snapshots = [...bucketPayload].reverse();
  const csatCount    = Number(totals.csatCount    ?? 0);
  const csatPositive = Number(totals.csatPositive ?? 0);
  const csat = csatCount > 0 ? (csatPositive / csatCount) * 100 : (totals.csat ?? 0);
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      finInvolvement: Math.round(totals.finInvolvement ?? 0),
      finResolved: Math.round(totals.finResolved ?? 0),
      finPending: Math.round(totals.finPending ?? 0),
      finAutomationRate: totals.finInvolvement > 0
        ? Number(((totals.finResolved / totals.finInvolvement) * 100).toFixed(1))
        : 0,
      csat: Number(csat.toFixed(1)),
      csatPositive: Math.round(csatPositive),
      csatCount: Math.round(csatCount),
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
