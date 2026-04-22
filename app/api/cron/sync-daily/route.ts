/**
 * Daily snapshot sync — runs at 2am UTC via Vercel Cron.
 *
 * Fetches yesterday's finalized data from each source and upserts it into
 * Supabase. Once stored, the dashboard API routes skip the slow live-fetch
 * for that day and read from the DB instead (<50ms vs 10-60s).
 *
 * Sources synced:
 *   - intercom-fin        (FIN conversation metrics)
 *   - elevenlabs-calls    (voice call metrics)
 *   - n8n-history         (workflow execution counts)
 *   - anthropic-usage     (per-department Claude token + cost)
 *   - claude-leaderboard  (per-user Claude spend)
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchIntercomDailySnapshots } from '@/lib/intercom-fin';
import { fetchElevenLabsDailySnapshots } from '@/lib/elevenlabs-calls';
import { fetchAllWorkflows, fetchExecutionsForPeriod } from '@/lib/n8n';
import { writeSnapshots, yesterday } from '@/lib/db-snapshots';
import type { RawSnapshot } from '@/lib/aggregate';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ── n8n history ──────────────────────────────────────────────────────────────

async function fetchN8nDailySnapshot(targetDate: string): Promise<RawSnapshot[]> {
  const since = new Date(targetDate + 'T00:00:00Z');
  const workflows = await fetchAllWorkflows();
  const activeIds = workflows.filter((w) => w.active).map((w) => w.id);

  const BATCH = 5;
  let total = 0, success = 0, error = 0;

  for (let i = 0; i < activeIds.length; i += BATCH) {
    const batch = activeIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((id) => fetchExecutionsForPeriod(id, since, 250).catch(() => [])),
    );
    for (const execs of results) {
      for (const e of execs) {
        const day = e.startedAt ? new Date(e.startedAt).toISOString().slice(0, 10) : null;
        if (day !== targetDate) continue;
        total += 1;
        if (e.status === 'success') success += 1;
        else if (e.status === 'error' || e.status === 'crashed') error += 1;
      }
    }
  }

  return [{ date: targetDate, metrics: { total, success, error } }];
}

// ── Anthropic workspace usage ─────────────────────────────────────────────────

async function fetchAnthropicUsageSnapshot(targetDate: string): Promise<RawSnapshot[]> {
  const adminKey = process.env.ANTHROPIC_ADMIN_KEY;
  if (!adminKey) throw new Error('ANTHROPIC_ADMIN_KEY not set');

  const startingAt = targetDate + 'T00:00:00Z';
  const endingAt = targetDate + 'T23:59:59Z';

  const params = new URLSearchParams();
  params.set('starting_at', startingAt);
  params.set('ending_at', endingAt);
  params.set('bucket_width', '1d');
  params.append('group_by[]', 'workspace_id');
  params.set('limit', '31');

  const [usageResp, costResp] = await Promise.all([
    fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`, {
      headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
      cache: 'no-store',
    }),
    fetch(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
      headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
      cache: 'no-store',
    }).catch(() => null),
  ]);

  if (!usageResp.ok) throw new Error(`Anthropic usage ${usageResp.status}`);
  const usageData = await usageResp.json() as { data?: { results?: { workspace_id?: string; input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }[] }[] };

  const costData = costResp?.ok
    ? await costResp.json() as { data?: { results?: { workspace_id?: string; amount?: number }[] }[] }
    : { data: [] };

  // Aggregate by workspace for this day
  const byWs = new Map<string, { inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const bucket of usageData.data ?? []) {
    for (const r of bucket.results ?? []) {
      const id = r.workspace_id ?? '__default__';
      const cur = byWs.get(id) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      cur.inputTokens += (r.input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0) + (r.cache_read_input_tokens ?? 0);
      cur.outputTokens += r.output_tokens ?? 0;
      byWs.set(id, cur);
    }
  }
  for (const bucket of costData.data ?? []) {
    for (const r of bucket.results ?? []) {
      const id = r.workspace_id ?? '__default__';
      const cur = byWs.get(id) ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      cur.costUsd += r.amount ?? 0;
      byWs.set(id, cur);
    }
  }

  // One snapshot per workspace-day, source = anthropic-ws-{id}
  const snaps: RawSnapshot[] = [];
  for (const [wsId, data] of byWs) {
    snaps.push({
      date: targetDate,
      metrics: { inputTokens: data.inputTokens, outputTokens: data.outputTokens, costUsd: data.costUsd },
      // Embed workspace ID so writeSnapshots can use the right source key
      _wsId: wsId,
    } as RawSnapshot & { _wsId: string });
  }
  return snaps;
}

// ── Claude per-user leaderboard ───────────────────────────────────────────────

async function fetchLeaderboardSnapshot(targetDate: string): Promise<RawSnapshot[]> {
  const sessionKey = process.env.CLAUDE_SESSION_KEY;
  const orgId = process.env.CLAUDE_ORG_ID;
  if (!sessionKey || !orgId) throw new Error('CLAUDE_SESSION_KEY or CLAUDE_ORG_ID not set');

  const url = `https://claude.ai/api/organizations/${orgId}/analytics/users/rankings?metric=spend&start_date=${targetDate}&limit=100`;
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
    const body = await resp.text().catch(() => '');
    throw new Error(`claude.ai rankings ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as { users?: { email_address?: string; value?: number; seat_tier?: string }[] };
  const users = data.users ?? [];

  // Store as a single snapshot: metrics.userCount + the full list serialised
  // into individual user_{n} keys for quick retrieval.
  const metrics: Record<string, number> = { userCount: users.length };
  users.forEach((u, i) => {
    metrics[`user_${i}_spend`] = u.value ?? 0;
  });

  return [{ date: targetDate, metrics }];
}

// ── Sync runner ───────────────────────────────────────────────────────────────

type SyncResult = { source: string; status: 'ok' | 'skip' | 'error'; message?: string };

async function run(
  source: string,
  fetcher: () => Promise<RawSnapshot[]>,
  targetDate: string,
  customWrite?: (snaps: RawSnapshot[]) => Promise<void>,
): Promise<SyncResult> {
  try {
    const snaps = await fetcher();
    const toWrite = snaps.filter((s) => s.date === targetDate);
    if (toWrite.length === 0) return { source, status: 'skip', message: 'no data for date' };
    if (customWrite) {
      await customWrite(toWrite);
    } else {
      await writeSnapshots(source, toWrite);
    }
    return { source, status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync-daily] ${source} failed:`, message);
    return { source, status: 'error', message };
  }
}

export async function GET(request: NextRequest) {
  const ua = request.headers.get('user-agent') ?? '';
  const auth = request.headers.get('authorization') ?? '';
  const querySecret = request.nextUrl.searchParams.get('secret');
  const isCron = ua.toLowerCase().startsWith('vercel-cron');
  const hasSecret = process.env.CRON_SECRET && (
    auth === `Bearer ${process.env.CRON_SECRET}` ||
    querySecret === process.env.CRON_SECRET
  );

  if (!isCron && !hasSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetDate = yesterday();
  console.log(`[sync-daily] Syncing data for ${targetDate}`);

  const results = await Promise.allSettled([
    run('intercom-fin', () => fetchIntercomDailySnapshots(2), targetDate),
    run('elevenlabs-calls', () => fetchElevenLabsDailySnapshots(2), targetDate),
    run('n8n-history', () => fetchN8nDailySnapshot(targetDate), targetDate),
    // Anthropic: one snapshot per workspace, each stored with its own source key
    run('anthropic-usage', () => fetchAnthropicUsageSnapshot(targetDate), targetDate,
      async (snaps) => {
        await Promise.all(
          (snaps as (RawSnapshot & { _wsId?: string })[]).map((s) =>
            writeSnapshots(`anthropic-ws-${s._wsId ?? 'default'}`, [{ date: s.date, metrics: s.metrics }]),
          ),
        );
      },
    ),
    run('claude-leaderboard', () => fetchLeaderboardSnapshot(targetDate), targetDate),
  ]);

  const settled = results.map((r, i) => {
    const sources = ['intercom-fin', 'elevenlabs-calls', 'n8n-history', 'anthropic-usage', 'claude-leaderboard'];
    if (r.status === 'fulfilled') return r.value;
    return { source: sources[i], status: 'error' as const, message: String(r.reason) };
  });

  const allOk = settled.every((r) => r.status !== 'error');
  console.log('[sync-daily] results:', JSON.stringify(settled));
  return NextResponse.json({ date: targetDate, results: settled }, { status: allOk ? 200 : 207 });
}
