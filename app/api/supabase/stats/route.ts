import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import type { DashboardPeriod } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MGMT_API = 'https://api.supabase.com/v1';

// Known project metadata (public table counts from schema inspection).
// Auto-discovered future projects will appear with publicTables: null.
const KNOWN_PROJECTS: Record<string, { publicTables: number }> = {
  mzlnnxpnfxbjmywsxcfc: { publicTables: 1  },  // AI Projects
  pwylvzpihgeauifcygbd: { publicTables: 10 },  // Willowpack
  mkgblixphikyooqkqdqe: { publicTables: 2  },  // SinaLite
};

export interface TableStat {
  tablename: string;
  row_count: number;
  last_activity: string | null;
}

export interface ProjectTableStats {
  projectId: string;
  projectName: string;
  tables: TableStat[];
  error?: string;
}

async function queryProjectTables(ref: string, pat: string): Promise<TableStat[]> {
  // Use pg_class (universally accessible) rather than pg_stat_user_tables
  // which requires pg_read_all_stats on restricted roles.
  const sql = `
    SELECT
      c.relname                           AS tablename,
      GREATEST(c.reltuples::bigint, 0)   AS row_count,
      NULL::timestamptz                   AS last_activity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.reltuples DESC
  `.trim();

  const resp = await fetch(`${MGMT_API}/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
    cache: 'no-store',
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Supabase query API ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return (await resp.json()) as TableStat[];
}

interface MgmtProject {
  id: string;
  name: string;
  status: string;
  region: string;
  created_at: string;
  database?: { version?: string; postgres_engine?: string };
}

async function listProjects(pat: string): Promise<MgmtProject[]> {
  const resp = await fetch(`${MGMT_API}/projects`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!resp.ok) throw new Error(`Supabase Management API ${resp.status}`);
  return (await resp.json()) as MgmtProject[];
}

function lookbackDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 7;
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'annually':  return 365;
  }
}

const SOURCE_LABELS: Record<string, string> = {
  'intercom-fin':       'Intercom FIN',
  'elevenlabs-calls':   'ElevenLabs',
  'n8n-history':        'n8n',
  'claude-leaderboard': 'Claude',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  const pat = process.env.SUPABASE_ACCESS_TOKEN;

  // ── Projects list (Management API) ────────────────────────────────────────
  let projects: Array<{
    id: string; name: string; status: string; region: string;
    createdAt: string; pgVersion: string; publicTables: number | null;
  }> = [];

  if (pat) {
    try {
      const raw = await listProjects(pat);
      projects = raw.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        region: p.region,
        createdAt: p.created_at,
        pgVersion: p.database?.postgres_engine ?? '—',
        publicTables: KNOWN_PROJECTS[p.id]?.publicTables ?? null,
      })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.error('[supabase/stats] Management API error:', e);
      // Fall through to hardcoded fallback below
    }
  }

  // Fallback: use hardcoded list if PAT not set or API failed
  if (projects.length === 0) {
    projects = [
      { id: 'mzlnnxpnfxbjmywsxcfc', name: 'AI Projects',  status: 'ACTIVE_HEALTHY', region: 'us-east-2', createdAt: '2026-04-22T18:49:51Z', pgVersion: '17', publicTables: 1  },
      { id: 'pwylvzpihgeauifcygbd', name: 'Willowpack',   status: 'ACTIVE_HEALTHY', region: 'us-west-2', createdAt: '2026-03-12T19:53:58Z', pgVersion: '17', publicTables: 10 },
      { id: 'mkgblixphikyooqkqdqe', name: 'SinaLite',     status: 'ACTIVE_HEALTHY', region: 'us-east-1', createdAt: '2026-03-16T17:58:09Z', pgVersion: '17', publicTables: 2  },
    ];
  }

  // ── Per-project table stats (Management API SQL) ─────────────────────────
  const projectTableStats: ProjectTableStats[] = [];
  if (pat) {
    await Promise.all(
      projects.map(async (p) => {
        try {
          const tables = await queryProjectTables(p.id, pat);
          projectTableStats.push({ projectId: p.id, projectName: p.name, tables });
          // Update publicTables count with live data
          const match = projects.find((pr) => pr.id === p.id);
          if (match) match.publicTables = tables.length;
        } catch (e) {
          projectTableStats.push({
            projectId: p.id,
            projectName: p.name,
            tables: [],
            error: e instanceof Error ? e.message : 'Query failed',
          });
        }
      }),
    );
    // Sort to match project order
    projectTableStats.sort((a, b) => a.projectName.localeCompare(b.projectName));
  }

  // ── AI Projects snapshot stats ────────────────────────────────────────────
  const days = lookbackDays(period);
  const fromDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  let buckets: { date: string; syncs: number }[] = [];
  let sources: { source: string; label: string; rows: number }[] = [];
  // days+1 because the range is [fromDate, toDate] inclusive (both endpoints count)
  let snapshotTotals = { totalRows: 0, activeSources: 0, avgSyncsPerDay: 0, lastSyncedAt: null as string | null, daysWithData: 0, totalDays: days + 1 };

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try {
      const { data: rows, error } = await getSupabase()
        .from('dashboard_daily_snapshots')
        .select('date, source, synced_at')
        .gte('date', fromDate)
        .lte('date', toDate)
        .not('source', 'in', '("debug-test","test")')
        .order('date', { ascending: true });

      if (!error && rows) {
        const byDate = new Map<string, number>();
        const bySource = new Map<string, number>();
        let lastSyncedAt: string | null = null;

        for (const row of rows) {
          byDate.set(row.date, (byDate.get(row.date) ?? 0) + 1);
          bySource.set(row.source, (bySource.get(row.source) ?? 0) + 1);
          if (!lastSyncedAt || row.synced_at > lastSyncedAt) lastSyncedAt = row.synced_at;
        }

        const cur = new Date(fromDate + 'T00:00:00Z');
        const end = new Date(toDate + 'T00:00:00Z');
        while (cur <= end) {
          const d = cur.toISOString().slice(0, 10);
          buckets.push({ date: d, syncs: byDate.get(d) ?? 0 });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }

        sources = Array.from(bySource.entries()).map(([source, rowCount]) => ({
          source,
          label: SOURCE_LABELS[source] ?? source,
          rows: rowCount,
        })).sort((a, b) => b.rows - a.rows);

        snapshotTotals = {
          totalRows: rows.length,
          activeSources: bySource.size,
          avgSyncsPerDay: Number((rows.length / Math.max(days, 1)).toFixed(1)),
          lastSyncedAt,
          daysWithData: byDate.size,
          totalDays: days + 1,
        };
      }
    } catch (e) {
      console.error('[supabase/stats] snapshot query error:', e);
    }
  }

  return NextResponse.json({
    projects,
    buckets,
    sources,
    snapshotTotals,
    projectTableStats,
    period,
    managedByPat: !!pat,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
