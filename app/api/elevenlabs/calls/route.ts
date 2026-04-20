import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Call metrics sourced directly from the ElevenLabs Conversational AI API.
 *
 * Metric definitions (match the Notion route shape 1:1 — drop-in replacement):
 *   calls         → total conversations in window
 *   avgDuration   → mean of call_duration_secs
 *   transferRate  → % of conversations where call_successful !== "success"
 *                   (failure / unknown are treated as not-resolved)
 *   agents        → count of distinct agent_id in window
 *   csat          → 0 (not exposed on list endpoint)
 *   hoursSaved    → 0 — the UI computes this client-side from resolved × avgDuration
 *   revenueImpact → 0 — UI computes from hoursSaved × $20/hr
 */

const EL_BASE = 'https://api.elevenlabs.io';
const PAGE_SIZE = 100;

const CACHE_REVALIDATE_SEC = 5 * 60;

const AGG_RULES = {
  calls: 'sum',
  avgDuration: 'avg',
  transferRate: 'avg',
  agents: 'last',
  csat: 'avg',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
} as const;

interface ELConversation {
  conversation_id: string;
  agent_id?: string;
  start_time_unix_secs: number;
  call_duration_secs?: number;
  call_successful?: string; // "success" | "failure" | "unknown"
  status?: string;
  message_count?: number;
}

interface ELListResponse {
  conversations?: ELConversation[];
  next_cursor?: string | null;
  has_more?: boolean;
}

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly': return 10;
    case 'monthly': return 35;
    case 'quarterly': return 100;
    case 'annually': return 380;
  }
}

async function fetchConversations(
  apiKey: string,
  afterUnix: number,
): Promise<ELConversation[]> {
  const out: ELConversation[] = [];
  let cursor: string | undefined;
  let guard = 0;

  while (guard++ < 500) {
    const url = new URL(`${EL_BASE}/v1/convai/conversations`);
    url.searchParams.set('page_size', String(PAGE_SIZE));
    url.searchParams.set('call_start_after_unix', String(afterUnix));
    if (cursor) url.searchParams.set('cursor', cursor);

    const resp = await fetch(url.toString(), {
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ElevenLabs list failed ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as ELListResponse;
    if (Array.isArray(data.conversations)) out.push(...data.conversations);

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return out;
}

function toISODay(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDailySnapshots(convs: ELConversation[]): RawSnapshot[] {
  interface Acc {
    calls: number;
    durationSum: number;
    durationCount: number;
    transfers: number;
    agentIds: Set<string>;
  }
  const byDay = new Map<string, Acc>();

  for (const c of convs) {
    const day = toISODay(c.start_time_unix_secs);
    const acc = byDay.get(day) ?? {
      calls: 0,
      durationSum: 0,
      durationCount: 0,
      transfers: 0,
      agentIds: new Set<string>(),
    };
    acc.calls += 1;
    if (typeof c.call_duration_secs === 'number' && c.call_duration_secs > 0) {
      acc.durationSum += c.call_duration_secs;
      acc.durationCount += 1;
    }
    // Any outcome that isn't a confirmed success is treated as a transfer/fail.
    if (c.call_successful !== 'success') acc.transfers += 1;
    if (c.agent_id) acc.agentIds.add(c.agent_id);
    byDay.set(day, acc);
  }

  const out: RawSnapshot[] = [];
  for (const [date, acc] of byDay) {
    const avgDuration = acc.durationCount > 0 ? acc.durationSum / acc.durationCount : 0;
    const transferRate = acc.calls > 0 ? (acc.transfers / acc.calls) * 100 : 0;
    out.push({
      date,
      metrics: {
        calls: acc.calls,
        avgDuration,
        transferRate,
        agents: acc.agentIds.size,
        csat: 0,
        hoursSaved: 0,
        revenueImpact: 0,
      },
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const getCachedDaily = unstable_cache(
  async (days: number): Promise<RawSnapshot[]> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
    const afterUnix = Math.floor(Date.now() / 1000) - days * 86400;
    const convs = await fetchConversations(apiKey, afterUnix);
    return buildDailySnapshots(convs);
  },
  ['elevenlabs-calls-daily'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: ['elevenlabs-calls'] },
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

  try {
    const daily = await getCachedDaily(days);
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
