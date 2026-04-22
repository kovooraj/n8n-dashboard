import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import type { DashboardPeriod } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 7;
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'annually':  return 365;
  }
}

const SOURCE_LABELS: Record<string, string> = {
  'intercom-fin':     'Intercom FIN',
  'elevenlabs-calls': 'ElevenLabs',
  'n8n-history':      'n8n',
  'claude-leaderboard': 'Claude',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 501 });
  }

  try {
    const days = lookbackDays(period);
    const fromDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const toDate = new Date().toISOString().slice(0, 10);

    // Fetch all snapshot rows in the period (excluding debug/test rows)
    const { data: rows, error } = await getSupabase()
      .from('dashboard_daily_snapshots')
      .select('date, source, synced_at')
      .gte('date', fromDate)
      .lte('date', toDate)
      .not('source', 'in', '("debug-test","test")')
      .order('date', { ascending: true });

    if (error) throw new Error(error.message);

    const allRows = rows ?? [];

    // Group by date → count of syncs
    const byDate = new Map<string, number>();
    const bySource = new Map<string, number>();
    let lastSyncedAt: string | null = null;

    for (const row of allRows) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + 1);
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
      if (!lastSyncedAt || row.synced_at > lastSyncedAt) lastSyncedAt = row.synced_at;
    }

    // Build chart buckets: one point per day in range
    const buckets: { date: string; syncs: number }[] = [];
    const cur = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate + 'T00:00:00Z');
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      buckets.push({ date: d, syncs: byDate.get(d) ?? 0 });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    // Source breakdown
    const sources = Array.from(bySource.entries()).map(([source, rows]) => ({
      source,
      label: SOURCE_LABELS[source] ?? source,
      rows,
    })).sort((a, b) => b.rows - a.rows);

    const totalRows = allRows.length;
    const activeSources = bySource.size;
    const avgSyncsPerDay = totalRows / Math.max(days, 1);

    return NextResponse.json({
      buckets,
      sources,
      totals: {
        totalRows,
        activeSources,
        avgSyncsPerDay: Number(avgSyncsPerDay.toFixed(1)),
        lastSyncedAt,
        daysWithData: byDate.size,
        totalDays: days,
      },
      period,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
