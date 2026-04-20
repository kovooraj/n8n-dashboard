import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

// Allow the first (cold) fetch to complete on Vercel Pro (max 300s).
// Subsequent calls in the 5-min window are served from Data Cache and are instant.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * FIN metrics sourced directly from the Intercom Conversations API.
 *
 * Metric definitions (match the Notion route shape 1:1 so this is a drop-in):
 *   finInvolvement      → conversations where ai_agent_participated === true
 *   finResolved         → involved + ai_agent.resolution_state in resolved set
 *   finAutomationRate   → 100 × resolved ÷ involved
 *   csat                → mean of conversation_rating.rating (1–5) scaled ×20 → %
 *   finProcedureUses    → not available from API — reported as 0
 *   activeFinProcedures → not available from API — reported as 0
 *   hoursSaved          → resolved × 5 min ÷ 60  (tier-1 chat handle-time proxy)
 *   revenueImpact       → hoursSaved × $20/hr
 */

const INTERCOM_BASE = 'https://api.intercom.io';
const INTERCOM_VERSION = '2.11';
const PAGE_SIZE = 150;
const HANDLE_TIME_MIN_PER_RESOLUTION = 5;
const REVENUE_PER_HOUR = 20;
// Intercom's ai_agent.resolution_state values that count as FIN handling the
// conversation end-to-end (i.e. not handed to a teammate).
const RESOLVED_STATES = new Set(['assumed_resolution', 'confirmed_resolution']);

// 25-hour TTL — a Vercel cron hits this route once a day with ?refresh=1,
// forcing a fresh upstream fetch. The extra hour of TTL past the 24h cron
// interval means cached data stays available even if the cron runs late.
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

interface IntercomConversation {
  id: string;
  created_at: number;
  ai_agent_participated?: boolean;
  ai_agent?: { resolution_state?: string } | null;
  conversation_rating?: { rating?: number | null } | null;
}

interface IntercomSearchResponse {
  conversations: IntercomConversation[];
  pages?: {
    next?: { starting_after?: string } | null;
  };
}

/**
 * Days of history needed to satisfy the current period request. We always fetch
 * the wider window so the aggregator can bucket correctly.
 */
function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly': return 10;       // last 7 days + a small buffer
    case 'monthly': return 35;      // last 4 ISO weeks + buffer
    case 'quarterly': return 100;   // fiscal quarter = 3 months
    case 'annually': return 380;    // fiscal year = 12 months + buffer
  }
}

/**
 * Fetch all Intercom conversations created in [fromUnix, toUnix) with cursor
 * pagination. Used as the per-chunk worker in the parallel fetcher below.
 */
async function fetchConversationsRange(
  token: string,
  fromUnix: number,
  toUnix: number,
): Promise<IntercomConversation[]> {
  const out: IntercomConversation[] = [];
  let cursor: string | undefined;
  let guard = 0;

  while (guard++ < 500) {
    const body = {
      query: {
        operator: 'AND',
        value: [
          { field: 'created_at', operator: '>', value: fromUnix },
          { field: 'created_at', operator: '<', value: toUnix },
        ],
      },
      pagination: {
        per_page: PAGE_SIZE,
        ...(cursor ? { starting_after: cursor } : {}),
      },
    };

    const resp = await fetch(`${INTERCOM_BASE}/conversations/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': INTERCOM_VERSION,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Intercom search failed ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as IntercomSearchResponse;
    if (Array.isArray(data.conversations)) out.push(...data.conversations);

    const next = data.pages?.next?.starting_after;
    if (!next) break;
    cursor = next;
  }

  return out;
}

/**
 * Split the full lookback window into N equal chunks and fetch them in
 * parallel. Each chunk paginates independently, which cuts first-load latency
 * roughly N× vs sequential pagination across one big window.
 */
async function fetchConversations(
  token: string,
  afterUnix: number,
): Promise<IntercomConversation[]> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const totalSec = nowUnix - afterUnix;
  // 6 chunks is a sweet spot vs Intercom's 166-req/min rate limit.
  const CHUNKS = 6;
  const chunkSec = Math.ceil(totalSec / CHUNKS);

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < CHUNKS; i++) {
    const from = afterUnix + i * chunkSec;
    const to = i === CHUNKS - 1 ? nowUnix + 1 : afterUnix + (i + 1) * chunkSec;
    ranges.push([from, to]);
  }

  const results = await Promise.all(
    ranges.map(([from, to]) => fetchConversationsRange(token, from, to)),
  );

  // Dedupe by id (boundary convs can appear in two chunks if created exactly on the edge)
  const byId = new Map<string, IntercomConversation>();
  for (const chunk of results) {
    for (const c of chunk) byId.set(c.id, c);
  }
  return [...byId.values()];
}

function toISODay(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDailySnapshots(convs: IntercomConversation[]): RawSnapshot[] {
  interface Acc {
    involved: number;
    resolved: number;
    csatSum: number;
    csatCount: number;
  }
  const byDay = new Map<string, Acc>();

  for (const c of convs) {
    const day = toISODay(c.created_at);
    const acc = byDay.get(day) ?? { involved: 0, resolved: 0, csatSum: 0, csatCount: 0 };
    if (c.ai_agent_participated) {
      acc.involved += 1;
      const state = c.ai_agent?.resolution_state;
      if (state && RESOLVED_STATES.has(state)) acc.resolved += 1;
    }
    const rating = c.conversation_rating?.rating;
    if (typeof rating === 'number' && rating > 0) {
      acc.csatSum += rating;
      acc.csatCount += 1;
    }
    byDay.set(day, acc);
  }

  const out: RawSnapshot[] = [];
  for (const [date, acc] of byDay) {
    const automationRate = acc.involved > 0 ? (acc.resolved / acc.involved) * 100 : 0;
    const csatPct = acc.csatCount > 0 ? (acc.csatSum / acc.csatCount) * 20 : 0;
    const hoursSaved = (acc.resolved * HANDLE_TIME_MIN_PER_RESOLUTION) / 60;
    const revenueImpact = hoursSaved * REVENUE_PER_HOUR;

    out.push({
      date,
      metrics: {
        finInvolvement: acc.involved,
        finResolved: acc.resolved,
        finAutomationRate: automationRate,
        csat: csatPct,
        finProcedureUses: 0,
        activeFinProcedures: 0,
        hoursSaved,
        revenueImpact,
      },
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Persistently-cached daily snapshot builder. `unstable_cache` keys by the
 * function arguments (days) and stores results in Vercel Data Cache, so a
 * cold serverless invocation in any region will still get a cache hit if a
 * recent request has populated the cache.
 */
const getCachedDaily = unstable_cache(
  async (days: number): Promise<RawSnapshot[]> => {
    const token = process.env.INTERCOM_ACCESS_TOKEN;
    if (!token) throw new Error('INTERCOM_ACCESS_TOKEN not set');
    const afterUnix = Math.floor(Date.now() / 1000) - days * 86400;
    const convs = await fetchConversations(token, afterUnix);
    return buildDailySnapshots(convs);
  },
  ['intercom-fin-daily'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: [CACHE_TAG] },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;
  const now = new Date();

  if (!process.env.INTERCOM_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: 'INTERCOM_ACCESS_TOKEN not set' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const days = lookbackDays(period);

  // Force a fresh upstream fetch when the Vercel cron hits us (user-agent
  // starts with "vercel-cron") or when the UI explicitly requests it via
  // ?refresh=1. Without this the cron would hit a still-valid cache and
  // never actually refresh the data.
  const ua = request.headers.get('user-agent') ?? '';
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  const forceRefresh = isCron || searchParams.get('refresh') === '1';
  // "max" = stale-while-revalidate. The cron returns stale data instantly
  // while the fresh fetch runs in the background, so by the time a real user
  // loads the dashboard the cache is already updated.
  if (forceRefresh) revalidateTag(CACHE_TAG, 'max');

  try {
    const daily = await getCachedDaily(days);
    const { buckets, totals, granularity } = aggregate(daily, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity);
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

function mkResponse(
  buckets: Bucket[],
  totals: Record<string, number>,
  granularity: Granularity,
) {
  const bucketPayload = payloadFromBuckets(buckets);
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      finInvolvement: Math.round(totals.finInvolvement ?? 0),
      finResolved: Math.round(totals.finResolved ?? 0),
      // Recompute from the totals for accuracy — averaging per-day rates biases
      // toward low-volume days. Per-day rates still live in buckets[] for charts.
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
    mock: false,
    source: 'intercom',
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
