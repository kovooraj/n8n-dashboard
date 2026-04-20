import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { TEAM, lookupMember, type Company } from '@/lib/aiToolsTeam';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Claude usage aggregated per user → per department, sourced from the
 * Anthropic Admin API.
 *
 *   GET /v1/organizations/usage_report/messages
 *     ?starting_at=<ISO>&ending_at=<ISO>&bucket_width=1d
 *     &group_by[]=actor_email_address
 *
 *   GET /v1/organizations/cost_report
 *     (same window, returns USD cost per bucket)
 *
 * Requires an Admin API key (sk-ant-admin01-...) created at
 * console.anthropic.com/settings/admin-keys by an org Owner.
 *
 * Response shape matches AIToolsPage expectations:
 *   {
 *     rows: [{ email, name, department, companies[], conversations,
 *              inputTokens, outputTokens, costUsd }],
 *     totals: { conversations, users, inputTokens, outputTokens, costUsd },
 *     unmatched: [{ email, conversations, inputTokens, outputTokens }],
 *     source: 'anthropic' | 'mock',
 *   }
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const CACHE_REVALIDATE_SEC = 25 * 60 * 60; // 25h — daily cron refreshes
const CACHE_TAG = 'anthropic-usage';

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 7;
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'annually':  return 365;
  }
}

interface UsageBucketEntry {
  actor_email_address?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: unknown;
}
interface UsageBucket {
  starting_at?: string;
  ending_at?: string;
  results?: UsageBucketEntry[];
}
interface UsageReportResponse {
  data?: UsageBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

interface CostEntry {
  actor_email_address?: string;
  amount?: number;
  currency?: string;
}
interface CostBucket {
  starting_at?: string;
  results?: CostEntry[];
}
interface CostReportResponse {
  data?: CostBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

async function anthropicGet<T>(path: string, adminKey: string): Promise<T> {
  const resp = await fetch(`${ANTHROPIC_BASE}${path}`, {
    headers: {
      'x-api-key': adminKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 400)}`);
  }
  return (await resp.json()) as T;
}

async function fetchAllUsage(adminKey: string, startingAt: string, endingAt: string) {
  const buckets: UsageBucket[] = [];
  let cursor: string | null = null;
  let guard = 0;

  while (guard++ < 100) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    params.append('group_by[]', 'actor_email_address');
    params.set('limit', '1000');
    if (cursor) params.set('page', cursor);

    const data = await anthropicGet<UsageReportResponse>(
      `/v1/organizations/usage_report/messages?${params.toString()}`,
      adminKey,
    );
    if (Array.isArray(data.data)) buckets.push(...data.data);
    if (!data.has_more || !data.next_page) break;
    cursor = data.next_page;
  }
  return buckets;
}

async function fetchAllCost(adminKey: string, startingAt: string, endingAt: string) {
  const buckets: CostBucket[] = [];
  let cursor: string | null = null;
  let guard = 0;

  while (guard++ < 100) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    params.append('group_by[]', 'actor_email_address');
    params.set('limit', '1000');
    if (cursor) params.set('page', cursor);

    try {
      const data = await anthropicGet<CostReportResponse>(
        `/v1/organizations/cost_report?${params.toString()}`,
        adminKey,
      );
      if (Array.isArray(data.data)) buckets.push(...data.data);
      if (!data.has_more || !data.next_page) break;
      cursor = data.next_page;
    } catch (err) {
      // Cost report can be gated separately — log and return what we have.
      console.warn('[anthropic/usage] cost_report failed:', err);
      break;
    }
  }
  return buckets;
}

interface UserAgg {
  email: string;
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

function aggregateByUser(
  usageBuckets: UsageBucket[],
  costBuckets: CostBucket[],
): Map<string, UserAgg> {
  const byUser = new Map<string, UserAgg>();

  for (const b of usageBuckets) {
    for (const r of b.results ?? []) {
      const email = (r.actor_email_address ?? '').toLowerCase();
      if (!email) continue;
      const cur = byUser.get(email) ?? { email, conversations: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      // "conversations" proxy: number of daily buckets with activity for that user.
      // Admin API doesn't expose conversation count directly for Claude.ai; this is
      // a pragmatic stand-in ("days active"). Swap for request_count if exposed.
      cur.conversations += 1;
      cur.inputTokens += (r.input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
      cur.outputTokens += r.output_tokens ?? 0;
      byUser.set(email, cur);
    }
  }

  for (const b of costBuckets) {
    for (const r of b.results ?? []) {
      const email = (r.actor_email_address ?? '').toLowerCase();
      if (!email) continue;
      const cur = byUser.get(email);
      if (!cur) continue;
      cur.costUsd += r.amount ?? 0;
    }
  }

  return byUser;
}

interface TeamRow {
  email: string;
  name: string;
  department: string;
  companies: Company[];
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsagePayload {
  rows: TeamRow[];
  totals: {
    conversations: number;
    users: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  unmatched: { email: string; conversations: number; inputTokens: number; outputTokens: number }[];
  source: 'anthropic';
  window: { startingAt: string; endingAt: string };
}

async function buildPayload(adminKey: string, days: number): Promise<UsagePayload> {
  const endingAt = new Date().toISOString();
  const startingAt = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const [usageBuckets, costBuckets] = await Promise.all([
    fetchAllUsage(adminKey, startingAt, endingAt),
    fetchAllCost(adminKey, startingAt, endingAt),
  ]);

  const byUser = aggregateByUser(usageBuckets, costBuckets);

  const rows: TeamRow[] = [];
  const unmatched: UsagePayload['unmatched'] = [];

  for (const agg of byUser.values()) {
    const member = lookupMember(agg.email);
    if (member) {
      rows.push({
        email: agg.email,
        name: member.name,
        department: member.department,
        companies: member.companies,
        conversations: agg.conversations,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        costUsd: agg.costUsd,
      });
    } else {
      unmatched.push({
        email: agg.email,
        conversations: agg.conversations,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
      });
    }
  }

  // Also include seats on the roster with zero activity so the UI shows
  // everyone — makes "no activity" obvious instead of silently omitted.
  const seen = new Set(rows.map((r) => r.email.toLowerCase()));
  for (const m of TEAM) {
    if (!seen.has(m.email.toLowerCase())) {
      rows.push({
        email: m.email,
        name: m.name,
        department: m.department,
        companies: m.companies,
        conversations: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      });
    }
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.conversations += r.conversations;
      acc.inputTokens += r.inputTokens;
      acc.outputTokens += r.outputTokens;
      acc.costUsd += r.costUsd;
      if (r.conversations > 0) acc.users += 1;
      return acc;
    },
    { conversations: 0, users: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  return {
    rows,
    totals,
    unmatched,
    source: 'anthropic',
    window: { startingAt, endingAt },
  };
}

const getCached = unstable_cache(
  async (days: number, adminKey: string) => buildPayload(adminKey, days),
  ['anthropic-usage-v1'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: [CACHE_TAG] },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_ADMIN_KEY not set', source: 'none' },
      { status: 501, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ua = request.headers.get('user-agent') ?? '';
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  const forceRefresh = isCron || searchParams.get('refresh') === '1';
  if (forceRefresh) revalidateTag(CACHE_TAG, 'max');

  try {
    const payload = await getCached(lookbackDays(period), adminKey);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `anthropic-error: ${message}`, source: 'none' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
