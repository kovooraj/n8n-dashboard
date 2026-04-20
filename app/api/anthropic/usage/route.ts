import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import type { Company } from '@/lib/aiToolsTeam';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Claude usage per department via Anthropic workspaces.
 *
 * Strategy:
 *   1. List workspaces — /v1/organizations/workspaces
 *   2. Usage per workspace — /v1/organizations/usage_report/messages?group_by[]=workspace_id
 *   3. Cost per workspace — /v1/organizations/cost_report?group_by[]=workspace_id
 *   4. Parse workspace name into { department, company } via convention:
 *
 *        "Marketing · SinaLite"        → dept: Marketing, company: sinalite
 *        "Marketing — Willowpack"      → dept: Marketing, company: willowpack
 *        "Dev Team - Both"             → dept: Dev Team,  company: both
 *        "Engineering"                 → dept: Engineering, company: both (default)
 *
 *   Accepted separators: ·, —, -, |, /  (whitespace around is OK)
 *   Company tokens: sinalite, sl, willowpack, wp, both, all
 *
 *   Anything else falls into an "Unmapped" bucket so it's visible in the UI.
 */

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const CACHE_REVALIDATE_SEC = 25 * 60 * 60;
const CACHE_TAG = 'anthropic-usage';

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 7;
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'annually':  return 365;
  }
}

interface Workspace {
  id: string;
  name: string;
  archived_at?: string | null;
}
interface WorkspaceListResp {
  data?: Workspace[];
  has_more?: boolean;
  next_page?: string | null;
}

interface UsageEntry {
  workspace_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}
interface UsageBucket {
  starting_at?: string;
  ending_at?: string;
  results?: UsageEntry[];
}
interface UsageReportResp {
  data?: UsageBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

interface CostEntry {
  workspace_id?: string | null;
  amount?: number;
  currency?: string;
}
interface CostBucket {
  starting_at?: string;
  results?: CostEntry[];
}
interface CostReportResp {
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

async function fetchWorkspaces(adminKey: string): Promise<Workspace[]> {
  const out: Workspace[] = [];
  let cursor: string | null = null;
  let guard = 0;
  while (guard++ < 20) {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (cursor) params.set('page', cursor);
    const data = await anthropicGet<WorkspaceListResp>(
      `/v1/organizations/workspaces?${params.toString()}`,
      adminKey,
    );
    if (data.data) out.push(...data.data);
    if (!data.has_more || !data.next_page) break;
    cursor = data.next_page;
  }
  return out.filter((w) => !w.archived_at);
}

async function fetchUsageByWorkspace(adminKey: string, startingAt: string, endingAt: string) {
  const buckets: UsageBucket[] = [];
  let cursor: string | null = null;
  let guard = 0;
  while (guard++ < 50) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    params.append('group_by[]', 'workspace_id');
    params.set('limit', '1000');
    if (cursor) params.set('page', cursor);
    const data = await anthropicGet<UsageReportResp>(
      `/v1/organizations/usage_report/messages?${params.toString()}`,
      adminKey,
    );
    if (data.data) buckets.push(...data.data);
    if (!data.has_more || !data.next_page) break;
    cursor = data.next_page;
  }
  return buckets;
}

async function fetchCostByWorkspace(adminKey: string, startingAt: string, endingAt: string) {
  const buckets: CostBucket[] = [];
  let cursor: string | null = null;
  let guard = 0;
  while (guard++ < 50) {
    const params = new URLSearchParams();
    params.set('starting_at', startingAt);
    params.set('ending_at', endingAt);
    params.set('bucket_width', '1d');
    params.append('group_by[]', 'workspace_id');
    params.set('limit', '1000');
    if (cursor) params.set('page', cursor);
    try {
      const data = await anthropicGet<CostReportResp>(
        `/v1/organizations/cost_report?${params.toString()}`,
        adminKey,
      );
      if (data.data) buckets.push(...data.data);
      if (!data.has_more || !data.next_page) break;
      cursor = data.next_page;
    } catch (err) {
      console.warn('[anthropic/usage] cost_report failed:', err);
      break;
    }
  }
  return buckets;
}

/** Parse a workspace name into department + companies. */
function parseWorkspaceName(name: string): { department: string; companies: Company[] } {
  const separators = /[·—–\-|/]+/;
  const parts = name.split(separators).map((p) => p.trim()).filter(Boolean);

  if (parts.length === 0) {
    return { department: name || 'Unmapped', companies: ['sinalite', 'willowpack'] };
  }

  const department = parts[0] || 'Unmapped';
  const companyToken = (parts[1] ?? '').toLowerCase();

  let companies: Company[] = ['sinalite', 'willowpack']; // default: both
  if (companyToken) {
    if (companyToken.startsWith('sinalite') || companyToken === 'sl') {
      companies = ['sinalite'];
    } else if (companyToken.startsWith('willow') || companyToken === 'wp') {
      companies = ['willowpack'];
    } else if (companyToken === 'both' || companyToken === 'all') {
      companies = ['sinalite', 'willowpack'];
    }
  }
  return { department, companies };
}

interface DeptRow {
  department: string;
  workspaceName: string;
  workspaceId: string;
  companies: Company[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  activeDays: number;
}

interface Payload {
  rows: DeptRow[];
  orgTotals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    activeDays: number;
    workspacesWithActivity: number;
  };
  workspaces: { id: string; name: string; department: string; companies: Company[] }[];
  source: 'anthropic';
  window: { startingAt: string; endingAt: string };
}

async function buildPayload(adminKey: string, days: number): Promise<Payload> {
  const endingAt = new Date().toISOString();
  const startingAt = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const [workspaces, usageBuckets, costBuckets] = await Promise.all([
    fetchWorkspaces(adminKey),
    fetchUsageByWorkspace(adminKey, startingAt, endingAt),
    fetchCostByWorkspace(adminKey, startingAt, endingAt),
  ]);

  const wsById = new Map(workspaces.map((w) => [w.id, w]));

  // Aggregate tokens and active-day sets per workspace
  const tokensByWs = new Map<string, { inputTokens: number; outputTokens: number; days: Set<string> }>();
  for (const b of usageBuckets) {
    const day = b.starting_at?.slice(0, 10) ?? '';
    for (const r of b.results ?? []) {
      const wsId = r.workspace_id ?? '__default__';
      const cur = tokensByWs.get(wsId) ?? { inputTokens: 0, outputTokens: 0, days: new Set<string>() };
      const inT = (r.input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
      const outT = r.output_tokens ?? 0;
      cur.inputTokens += inT;
      cur.outputTokens += outT;
      if (day && (inT > 0 || outT > 0)) cur.days.add(day);
      tokensByWs.set(wsId, cur);
    }
  }

  const costByWs = new Map<string, number>();
  for (const b of costBuckets) {
    for (const r of b.results ?? []) {
      const wsId = r.workspace_id ?? '__default__';
      costByWs.set(wsId, (costByWs.get(wsId) ?? 0) + (r.amount ?? 0));
    }
  }

  // Build department rows. Use both workspace list and any workspace IDs
  // that appeared in usage (in case one is missing from the list call).
  const allWsIds = new Set<string>([...wsById.keys(), ...tokensByWs.keys(), ...costByWs.keys()]);

  const rows: DeptRow[] = [];
  for (const wsId of allWsIds) {
    const ws = wsById.get(wsId);
    const name = ws?.name ?? (wsId === '__default__' ? 'Default workspace' : `Workspace ${wsId.slice(0, 8)}`);
    const { department, companies } = parseWorkspaceName(name);
    const tk = tokensByWs.get(wsId);
    rows.push({
      department,
      workspaceName: name,
      workspaceId: wsId,
      companies,
      inputTokens: tk?.inputTokens ?? 0,
      outputTokens: tk?.outputTokens ?? 0,
      costUsd: costByWs.get(wsId) ?? 0,
      activeDays: tk?.days.size ?? 0,
    });
  }

  // Merge rows that resolve to the same department + company signature
  // (e.g., two workspaces both named "Marketing · SinaLite" should stack).
  const mergedMap = new Map<string, DeptRow>();
  for (const r of rows) {
    const key = `${r.department}::${r.companies.slice().sort().join(',')}`;
    const cur = mergedMap.get(key);
    if (!cur) {
      mergedMap.set(key, { ...r });
    } else {
      cur.inputTokens += r.inputTokens;
      cur.outputTokens += r.outputTokens;
      cur.costUsd += r.costUsd;
      cur.activeDays = Math.max(cur.activeDays, r.activeDays);
      cur.workspaceName = `${cur.workspaceName} + ${r.workspaceName}`;
    }
  }
  const merged = Array.from(mergedMap.values()).sort(
    (a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens),
  );

  const orgTotals = merged.reduce(
    (acc, r) => {
      acc.inputTokens += r.inputTokens;
      acc.outputTokens += r.outputTokens;
      acc.costUsd += r.costUsd;
      acc.activeDays = Math.max(acc.activeDays, r.activeDays);
      if (r.inputTokens + r.outputTokens > 0) acc.workspacesWithActivity += 1;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, costUsd: 0, activeDays: 0, workspacesWithActivity: 0 },
  );

  return {
    rows: merged,
    orgTotals,
    workspaces: workspaces.map((w) => {
      const { department, companies } = parseWorkspaceName(w.name);
      return { id: w.id, name: w.name, department, companies };
    }),
    source: 'anthropic',
    window: { startingAt, endingAt },
  };
}

const getCached = unstable_cache(
  async (days: number, adminKey: string) => buildPayload(adminKey, days),
  ['anthropic-usage-v2-workspaces'],
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
