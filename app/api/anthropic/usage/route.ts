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
  api_key_id?: string;
  workspace_id?: string;
  model?: string;
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
  workspace_id?: string;
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
    // Admin API doesn't expose actor_email_address; the valid group_by options
    // are api_key_id, workspace_id, model, etc. We aggregate org-wide totals
    // and surface them as a global org usage readout.
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
  rows: TeamRow[]; // roster seats (zeroed — per-user not exposed by Admin API)
  orgTotals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    activeDays: number;
  };
  totals: {
    conversations: number;
    users: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  source: 'anthropic';
  limitations: {
    perUser: boolean; // true = Admin API cannot break down usage per user/email
    note: string;
  };
  window: { startingAt: string; endingAt: string };
}

async function buildPayload(adminKey: string, days: number): Promise<UsagePayload> {
  const endingAt = new Date().toISOString();
  const startingAt = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const [usageBuckets, costBuckets] = await Promise.all([
    fetchAllUsage(adminKey, startingAt, endingAt),
    fetchAllCost(adminKey, startingAt, endingAt),
  ]);

  // Aggregate org-wide totals from daily buckets.
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  const activeDaySet = new Set<string>();

  for (const b of usageBuckets) {
    let bucketHasActivity = false;
    for (const r of b.results ?? []) {
      const inT = (r.input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
      const outT = r.output_tokens ?? 0;
      inputTokens += inT;
      outputTokens += outT;
      if (inT > 0 || outT > 0) bucketHasActivity = true;
    }
    if (bucketHasActivity && b.starting_at) {
      activeDaySet.add(b.starting_at.slice(0, 10));
    }
  }
  for (const b of costBuckets) {
    for (const r of b.results ?? []) {
      costUsd += r.amount ?? 0;
    }
  }

  // Roster seats are returned with zeros — Admin API can't attribute usage
  // per user. Keeping the shape lets the UI show the mapping we already have.
  void lookupMember; // silence unused import — kept for future per-key mapping
  const rows: TeamRow[] = TEAM.map((m) => ({
    email: m.email,
    name: m.name,
    department: m.department,
    companies: m.companies,
    conversations: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }));

  return {
    rows,
    orgTotals: {
      inputTokens,
      outputTokens,
      costUsd,
      activeDays: activeDaySet.size,
    },
    totals: {
      conversations: 0,
      users: 0,
      inputTokens,
      outputTokens,
      costUsd,
    },
    source: 'anthropic',
    limitations: {
      perUser: false,
      note: 'Anthropic Admin API exposes org-level totals only. Per-user attribution for Claude.ai requires the CSV export from console.anthropic.com → Usage.',
    },
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
