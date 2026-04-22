import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache, revalidateTag } from 'next/cache';
import type { DashboardPeriod } from '@/lib/types';
import { TEAM, lookupMember, type Company } from '@/lib/aiToolsTeam';
import { readPayload, writePayload, todayUTC } from '@/lib/db-snapshots';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Per-user Claude spend leaderboard, sourced from claude.ai's internal
 * analytics endpoint (the same one that powers console.anthropic.com's
 * "Top 10 users by spend" widget).
 *
 *   GET https://claude.ai/api/organizations/<org>/analytics/users/rankings
 *     ?metric=spend&start_date=YYYY-MM-DD&limit=500
 *
 * Auth: session cookie only. The public Admin API key does NOT work here.
 * Set CLAUDE_SESSION_KEY (value of the `sessionKey` cookie from a logged-in
 * claude.ai tab) and CLAUDE_ORG_ID in the environment.
 *
 * Caveats (documented for future-me):
 * - Undocumented internal API — Anthropic may change the shape/URL.
 * - sessionKey cookie expires ~monthly; user must refresh it.
 * - Logging out of claude.ai on that account may invalidate it.
 */

const CACHE_REVALIDATE_SEC = 25 * 60 * 60;
const CACHE_TAG = 'claude-leaderboard';

function startDate(period: DashboardPeriod): string {
  const now = new Date();
  let days: number;
  switch (period) {
    case 'weekly':    days = 7;   break;
    case 'monthly':   days = 30;  break;
    case 'quarterly': days = 90;  break;
    case 'annually':  days = 365; break;
  }
  const d = new Date(now.getTime() - days * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

interface RankingUser {
  account_uuid: string;
  email_address: string;
  seat_tier?: string;
  value: number;
}
interface RankingsResp {
  users?: RankingUser[];
  total_count?: number;
  data_as_of?: string;
}

async function fetchRankings(
  orgId: string,
  sessionKey: string,
  startAt: string,
  limit = 100,
): Promise<RankingsResp> {
  const url = `https://claude.ai/api/organizations/${orgId}/analytics/users/rankings?metric=spend&start_date=${startAt}&limit=${limit}`;
  const resp = await fetch(url, {
    headers: {
      cookie: `sessionKey=${sessionKey}`,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      referer: 'https://claude.ai/',
      origin: 'https://claude.ai',
      'anthropic-client-platform': 'web_claude_ai',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    cache: 'no-store',
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`claude.ai rankings ${resp.status}: ${text.slice(0, 300)}`);
  }
  return (await resp.json()) as RankingsResp;
}

export interface UserRow {
  email: string;
  name: string;         // from roster, falls back to local-part of email
  department: string;   // "Unmapped" if email not in roster
  companies: Company[]; // ['sinalite','willowpack'] if not in roster
  seatTier: string;
  spendUsd: number;
  inRoster: boolean;
}

export interface DeptRow {
  department: string;
  companies: Company[];
  users: number;
  spendUsd: number;
  topUser: string;
  topSpend: number;
}

export interface LeaderboardPayload {
  users: UserRow[];
  departments: DeptRow[];
  totals: {
    users: number;
    spendUsd: number;
    activeInRoster: number;
    activeOutsideRoster: number;
  };
  dataAsOf?: string;
  source: 'claude-ai-internal';
  window: { startingAt: string; endingAt: string };
}

function fallbackName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ') || email;
}

async function buildPayload(
  orgId: string,
  sessionKey: string,
  period: DashboardPeriod,
): Promise<LeaderboardPayload> {
  const startingAt = startDate(period);
  const endingAt = new Date().toISOString().slice(0, 10);
  const resp = await fetchRankings(orgId, sessionKey, startingAt);
  const raw = resp.users ?? [];

  // Build per-user rows, joining with roster.
  const byEmail = new Map<string, UserRow>();
  for (const u of raw) {
    const email = (u.email_address ?? '').toLowerCase();
    if (!email) continue;
    const member = lookupMember(email);
    byEmail.set(email, {
      email,
      name: member?.name ?? fallbackName(email),
      department: member?.department ?? 'Unmapped',
      companies: member?.companies ?? ['sinalite', 'willowpack'],
      seatTier: u.seat_tier ?? '',
      spendUsd: u.value ?? 0,
      inRoster: !!member,
    });
  }

  // Ensure everyone on the roster shows up, even with $0, so the seat table
  // mirrors the org directory rather than the leaderboard.
  for (const m of TEAM) {
    const key = m.email.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        email: m.email,
        name: m.name,
        department: m.department,
        companies: m.companies,
        seatTier: '',
        spendUsd: 0,
        inRoster: true,
      });
    }
  }

  const users = Array.from(byEmail.values()).sort((a, b) => b.spendUsd - a.spendUsd);

  // Roll up by department.
  const deptMap = new Map<string, DeptRow>();
  for (const u of users) {
    const cur = deptMap.get(u.department) ?? {
      department: u.department,
      companies: new Set<Company>() as unknown as Company[],
      users: 0,
      spendUsd: 0,
      topUser: '—',
      topSpend: -1,
    };
    // normalise the companies set on first write
    if (!(cur.companies as unknown as Set<Company>).add) {
      cur.companies = new Set<Company>(cur.companies) as unknown as Company[];
    }
    for (const c of u.companies) (cur.companies as unknown as Set<Company>).add(c);
    cur.users += 1;
    cur.spendUsd += u.spendUsd;
    if (u.spendUsd > cur.topSpend) {
      cur.topSpend = u.spendUsd;
      cur.topUser = u.name;
    }
    deptMap.set(u.department, cur);
  }
  const departments: DeptRow[] = Array.from(deptMap.values()).map((d) => ({
    ...d,
    companies: Array.from(d.companies as unknown as Set<Company>),
  })).sort((a, b) => b.spendUsd - a.spendUsd);

  const totals = {
    users: users.length,
    spendUsd: users.reduce((s, u) => s + u.spendUsd, 0),
    activeInRoster: users.filter((u) => u.spendUsd > 0 && u.inRoster).length,
    activeOutsideRoster: users.filter((u) => u.spendUsd > 0 && !u.inRoster).length,
  };

  return {
    users,
    departments,
    totals,
    dataAsOf: resp.data_as_of,
    source: 'claude-ai-internal',
    window: { startingAt, endingAt },
  };
}

const getCached = unstable_cache(
  async (period: DashboardPeriod, orgId: string, sessionKey: string) =>
    buildPayload(orgId, sessionKey, period),
  ['claude-leaderboard-v2'],
  { revalidate: CACHE_REVALIDATE_SEC, tags: [CACHE_TAG] },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  const sessionKey = process.env.CLAUDE_SESSION_KEY;
  const orgId = process.env.CLAUDE_ORG_ID;
  if (!sessionKey || !orgId) {
    return NextResponse.json(
      {
        error: 'CLAUDE_SESSION_KEY and CLAUDE_ORG_ID must be set.',
        source: 'none',
      },
      { status: 501, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ua = request.headers.get('user-agent') ?? '';
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  const forceRefresh = isCron || searchParams.get('refresh') === '1';
  if (forceRefresh) revalidateTag(CACHE_TAG, 'max');

  try {
    const dbKey = `claude-leaderboard-${period}`;
    const today = todayUTC();

    if (!forceRefresh && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const cached = await readPayload<LeaderboardPayload>(dbKey, today).catch(() => null);
      if (cached) {
        return NextResponse.json(cached, {
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        });
      }
    }

    const payload = await getCached(period, orgId, sessionKey);

    if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      writePayload(dbKey, today, payload).catch(console.error);
    }

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `claude-leaderboard-error: ${message}`, source: 'none' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
