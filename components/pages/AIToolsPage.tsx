'use client';

import { useMemo, useState } from 'react';
import { useStaleData } from '@/lib/useStaleData';
import { Brain, ExternalLink, RefreshCw, Trophy, Plug, Database } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { BenchKPICard } from '@/components/BenchKPICard';
import { HideCompletedToggle } from '@/components/HideCompletedToggle';
import dynamic from 'next/dynamic';
import type { DashboardPeriod, ClickUpTask } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';
import { TEAM, type Company } from '@/lib/aiToolsTeam';

const VolumeChart = dynamic(
  () => import('@/components/charts/VolumeChart').then((m) => m.VolumeChart),
  { ssr: false, loading: () => <div style={{ height: 180, background: '#0d1810', borderRadius: 8 }} /> },
);

type CompanyFilter = 'all' | Company;
type ToolFilter = 'all' | 'claude' | 'chatgpt' | 'gemini' | 'perplexity' | 'supabase';

interface UserRow {
  email: string;
  name: string;
  department: string;
  companies: Company[];
  seatTier: string;
  spendUsd: number;
  inRoster: boolean;
}

interface DeptRow {
  department: string;
  companies: Company[];
  users: number;
  spendUsd: number;
  topUser: string;
  topSpend: number;
}

interface ClaudePayload {
  users: UserRow[];
  departments: DeptRow[];
  totals: { users: number; spendUsd: number; activeInRoster: number; activeOutsideRoster: number };
  dataAsOf?: string;
  source: 'claude-ai-internal';
}

interface SupabaseProject {
  id: string;
  name: string;
  status: string;
  region: string;
  createdAt: string;
  pgVersion: string;
  publicTables: number | null;
}

interface SupabaseStats {
  projects: SupabaseProject[];
  buckets: { date: string; syncs: number }[];
  sources: { source: string; label: string; rows: number }[];
  snapshotTotals: {
    totalRows: number;
    activeSources: number;
    avgSyncsPerDay: number;
    lastSyncedAt: string | null;
    daysWithData: number;
    totalDays: number;
  };
  managedByPat: boolean;
}

const HOURS_PER_DOLLAR = 1.5;
const HOURLY_RATE = 20;

const STATUS_COLORS: Record<string, string> = {
  complete: '#3dba62',
  'in progress': '#d4912a',
  'on hold': '#e05858',
  'to do': '#6a8870',
  'planning / scoping': '#4a9eca',
  cancelled: '#4a4a4a',
};

// ── Tool definitions ─────────────────────────────────────────────────────────

interface ToolDef {
  key: ToolFilter;
  label: string;
  color: string;
  connected: boolean;
  connectHint?: string;
}

const TOOLS: ToolDef[] = [
  { key: 'claude',     label: 'Claude',     color: '#d4912a', connected: true },
  { key: 'supabase',   label: 'Supabase',   color: '#3ecf8e', connected: true },
  { key: 'chatgpt',    label: 'ChatGPT',    color: '#10a37f', connected: false, connectHint: 'Set OPENAI_ADMIN_KEY in Vercel env vars to see per-user ChatGPT usage.' },
  { key: 'gemini',     label: 'Gemini',     color: '#4285f4', connected: false, connectHint: 'Google Workspace usage reporting coming soon.' },
  { key: 'perplexity', label: 'Perplexity', color: '#9b6dff', connected: false, connectHint: 'Perplexity Enterprise admin API coming soon.' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function companyLabel(companies: Company[]): { text: string; color: string } {
  if (companies.length === 2) return { text: 'Both', color: '#9a86c9' };
  return companies[0] === 'sinalite'
    ? { text: 'SinaLite', color: '#3dba62' }
    : { text: 'Willowpack', color: '#4a9eca' };
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Main component ───────────────────────────────────────────────────────────

export function AIToolsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [company, setCompany] = useState<CompanyFilter>('all');
  const [tool, setTool] = useState<ToolFilter>('all');
  const [hideCompleted, setHideCompleted] = useState(true);

  // ── Claude data ─────────────────────────────────────────────────────────────
  const { data: claudeData, loading: claudeLoading, refreshing, refresh: refreshClaude } = useStaleData<ClaudePayload & { error?: string }>(
    `claude-leaderboard-${period}`,
    async (isRefresh) => {
      const force = isRefresh ? '&refresh=1' : '';
      const resp = await fetch(`/api/claude/leaderboard?period=${period}&_t=${Date.now()}${force}`, { cache: 'no-store' });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body?.error ?? `HTTP ${resp.status}`);
      return body as ClaudePayload;
    },
    [period],
  );

  // ── Supabase data ───────────────────────────────────────────────────────────
  const { data: supabaseData, loading: supabaseLoading, refresh: refreshSupabase } = useStaleData<SupabaseStats>(
    `supabase-stats-${period}`,
    async (isRefresh) => {
      const force = isRefresh ? '&refresh=1' : '';
      const resp = await fetch(`/api/supabase/stats?period=${period}&_t=${Date.now()}${force}`, { cache: 'no-store' });
      return resp.json() as Promise<SupabaseStats>;
    },
    [period],
  );

  // ── ClickUp AI tool tasks ────────────────────────────────────────────────────
  const { data: clickupData, loading: clickupLoading } = useStaleData<{ tasks: ClickUpTask[] }>(
    'clickup-projects',
    async () => {
      const resp = await fetch(`/api/clickup/projects?_t=${Date.now()}`, { cache: 'no-store' });
      return resp.json() as Promise<{ tasks: ClickUpTask[] }>;
    },
    [],
  );

  const allAiToolProjects = (clickupData?.tasks ?? []).filter((t) => t.platform === 'ai-tool');
  const completedAiToolCount = allAiToolProjects.filter((t) => t.status === 'complete').length;
  const aiToolProjects = hideCompleted
    ? allAiToolProjects.filter((t) => t.status !== 'complete')
    : allAiToolProjects;

  // ── Claude derived ───────────────────────────────────────────────────────────
  const claudeUsers = claudeData?.users ?? [];
  const claudeDepts = claudeData?.departments ?? [];
  const claudeDataAsOf = claudeData?.dataAsOf;
  const claudeConnected = !claudeLoading && !!claudeData && !claudeData.error;
  const claudeError = claudeData?.error ?? null;

  const filteredUsers = useMemo(
    () => (company === 'all' ? claudeUsers : claudeUsers.filter((u) => u.companies.includes(company))),
    [claudeUsers, company],
  );
  const filteredDepts = useMemo(
    () => (company === 'all' ? claudeDepts : claudeDepts.filter((d) => d.companies.includes(company))),
    [claudeDepts, company],
  );

  const claudeSpend = filteredUsers.reduce((s, u) => s + u.spendUsd, 0);
  const claudeActive = filteredUsers.filter((u) => u.spendUsd > 0).length;
  const claudeHours = claudeSpend * HOURS_PER_DOLLAR;
  const maxDeptSpend = Math.max(1, ...filteredDepts.map((d) => d.spendUsd));
  const maxUserSpend = Math.max(1, ...filteredUsers.map((u) => u.spendUsd));
  const unmappedUsers = filteredUsers.filter((u) => !u.inRoster && u.spendUsd > 0);

  // ── Supabase chart data ─────────────────────────────────────────────────────
  const supabaseChartData = useMemo(() => {
    const buckets = supabaseData?.buckets ?? [];
    const maxSyncs = Math.max(1, ...buckets.map((b) => b.syncs));
    return buckets.map((b) => ({
      label: b.date.slice(5),   // MM-DD
      total: maxSyncs,
      resolved: b.syncs,
    }));
  }, [supabaseData]);

  // ── All-tools aggregations ──────────────────────────────────────────────────
  const allToolsData = useMemo(() => [
    { key: 'claude' as ToolFilter,     label: 'Claude',     color: '#d4912a', connected: claudeConnected, spendUsd: claudeSpend, activeUsers: claudeActive, hoursSaved: claudeHours, error: claudeError, loading: claudeLoading },
    { key: 'supabase' as ToolFilter,   label: 'Supabase',   color: '#3ecf8e', connected: true,            spendUsd: 0,           activeUsers: supabaseData?.snapshotTotals.activeSources ?? 0, hoursSaved: 0, error: null, loading: supabaseLoading },
    { key: 'chatgpt' as ToolFilter,    label: 'ChatGPT',    color: '#10a37f', connected: false,           spendUsd: 0,           activeUsers: 0, hoursSaved: 0, error: null, loading: false },
    { key: 'gemini' as ToolFilter,     label: 'Gemini',     color: '#4285f4', connected: false,           spendUsd: 0,           activeUsers: 0, hoursSaved: 0, error: null, loading: false },
    { key: 'perplexity' as ToolFilter, label: 'Perplexity', color: '#9b6dff', connected: false,           spendUsd: 0,           activeUsers: 0, hoursSaved: 0, error: null, loading: false },
  ], [claudeConnected, claudeSpend, claudeActive, claudeHours, claudeError, claudeLoading, supabaseData, supabaseLoading]);

  const totalSpend = allToolsData.reduce((s, t) => s + t.spendUsd, 0);
  const totalHours = totalSpend * HOURS_PER_DOLLAR;

  // ── Pill helpers ─────────────────────────────────────────────────────────────

  function companyPill(key: CompanyFilter, label: string) {
    const active = company === key;
    return (
      <button key={key} onClick={() => setCompany(key)} style={{
        padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
        background: active ? '#1a2c1d' : 'transparent',
        color: active ? '#e4ede6' : '#8aad90',
        border: `1px solid ${active ? '#2a4030' : '#1a2c1d'}`,
        fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>{label}</button>
    );
  }

  // ── Views ────────────────────────────────────────────────────────────────────

  function AllToolsView() {
    return (
      <>
        {/* KPI summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          <BenchKPICard label="Total AI Spend" value={formatCurrency(totalSpend)} showInfo tooltip="Combined spend across all connected AI tools." />
          <BenchKPICard label="Estimated Hours Saved" value={formatHours(totalHours)} showInfo tooltip={`Total AI spend × ${HOURS_PER_DOLLAR} hrs/$`} />
          <BenchKPICard label="Estimated Revenue Impact" value={formatCurrency(totalHours * HOURLY_RATE)} showInfo tooltip={`Hours saved × $${HOURLY_RATE}/hr`} />
        </div>

        <SectionHeader eyebrow="TOOL BREAKDOWN" title="Spend by AI tool" />
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
            {['Tool', 'Status', 'Active / Metric', 'Spend', 'Est. Hours Saved'].map((h) => (
              <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>{h}</span>
            ))}
          </div>
          {allToolsData.map((t, i) => (
            <div key={t.key} onClick={() => setTool(t.key)} style={{
              display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr',
              padding: '14px 16px', alignItems: 'center',
              borderBottom: i < allToolsData.length - 1 ? '1px solid #1a2c1d' : 'none',
              cursor: 'pointer', opacity: t.connected || t.loading ? 1 : 0.55,
            }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#111d13')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.connected ? t.color : '#2a3d2d', boxShadow: t.connected ? `0 0 6px ${t.color}80` : 'none' }} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: t.connected ? '#e4ede6' : '#6a8870' }}>{t.label}</span>
              </div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: t.connected ? '#3dba62' : '#6a8870', padding: '2px 8px', borderRadius: 4,
                background: t.connected ? 'rgba(61,186,98,0.1)' : 'rgba(106,136,112,0.1)',
                border: `1px solid ${t.connected ? 'rgba(61,186,98,0.3)' : '#1a2c1d'}`, justifySelf: 'start',
              }}>
                {t.loading ? 'Loading' : t.connected ? 'Connected' : 'Not connected'}
              </span>
              <span style={{ fontSize: '0.85rem', color: t.connected ? '#8aad90' : '#3a5540' }}>
                {t.connected ? (t.key === 'supabase' ? `${t.activeUsers} sources` : t.activeUsers) : '—'}
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: t.connected ? '#e4ede6' : '#3a5540' }}>
                {t.key === 'supabase' ? `${supabaseData?.snapshotTotals.totalRows ?? '—'} rows` : t.connected ? formatCurrency(t.spendUsd) : '—'}
              </span>
              <span style={{ fontSize: '0.85rem', color: t.connected ? '#8aad90' : '#3a5540' }}>
                {t.key === 'supabase' ? timeAgo(supabaseData?.totals.lastSyncedAt ?? null) : t.connected ? formatHours(t.hoursSaved) : '—'}
              </span>
            </div>
          ))}
        </div>

        {/* AI Tool Related Projects */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <SectionHeader eyebrow="AI TOOL PROJECTS" title="AI Tool Related Projects" />
          <HideCompletedToggle checked={hideCompleted} onChange={setHideCompleted} count={completedAiToolCount} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {(clickupLoading ? [] : aiToolProjects).map((project) => {
            const statusColor = STATUS_COLORS[project.status] ?? '#6a8870';
            return (
              <a key={project.id} href={project.url} target="_blank" rel="noopener noreferrer" style={{
                background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8,
                padding: '12px 14px', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', gap: 12, textDecoration: 'none', cursor: 'pointer',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e4ede6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</p>
                  {project.assignees.length > 0 && (
                    <p style={{ fontSize: '0.75rem', color: '#6a8870', marginTop: 3 }}>{project.assignees.join(', ')}</p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, background: `${statusColor}18`,
                    border: `1px solid ${statusColor}`, fontSize: '0.6rem', fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase', color: statusColor,
                  }}>{project.status}</span>
                  <span style={{ fontSize: '0.6rem', color: '#6a8870' }}>
                    Updated {new Date(project.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </a>
            );
          })}
          {clickupLoading && (
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>Loading projects…</p>
            </div>
          )}
          {!clickupLoading && aiToolProjects.length === 0 && (
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>
                No tasks tagged &quot;ai tool&quot; found in ClickUp. Tag tasks with <strong>ai tool</strong> to show them here.
              </p>
            </div>
          )}
        </div>

        {/* Connect prompts */}
        <SectionHeader eyebrow="ADD MORE TOOLS" title="Connect additional AI tools" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {TOOLS.filter((t) => !t.connected).map((t) => (
            <div key={t.key} style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Plug size={16} color="#3a5540" />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#6a8870' }}>{t.label}</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#4a6450', margin: 0, lineHeight: 1.5 }}>{t.connectHint}</p>
            </div>
          ))}
        </div>
      </>
    );
  }

  function SupabaseView() {
    const totals = supabaseData?.snapshotTotals;
    const sources = supabaseData?.sources ?? [];
    const projects = supabaseData?.projects ?? [];
    const managedByPat = supabaseData?.managedByPat ?? false;
    const maxRows = Math.max(1, ...sources.map((s) => s.rows));

    const regionLabel = (r: string) => r.replace('us-', 'US ').replace('eu-', 'EU ').replace('-', ' ').toUpperCase();
    const statusColor = (s: string) => s === 'ACTIVE_HEALTHY' ? '#3dba62' : s.includes('PAUSE') ? '#6a8870' : '#e05858';
    const statusLabel = (s: string) => s === 'ACTIVE_HEALTHY' ? 'Healthy' : s.replace(/_/g, ' ').toLowerCase();

    return (
      <>
        {/* Banner */}
        <div style={{
          background: 'rgba(62,207,142,0.08)', border: '1px solid rgba(62,207,142,0.3)',
          borderRadius: 8, padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Database size={18} color="#3ecf8e" />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
              Connected — {projects.length} Supabase project{projects.length !== 1 ? 's' : ''} · {managedByPat ? 'live via Management API' : 'cached project list'}
            </p>
            <p style={{ fontSize: '0.72rem', color: '#8aad90', margin: '2px 0 0 0' }}>
              {managedByPat
                ? 'New projects added to this organisation appear here automatically.'
                : <>Add <code style={{ color: '#b8d4bd' }}>SUPABASE_ACCESS_TOKEN</code> in Vercel env vars for live project discovery.</>}
              {' '}Last snapshot synced {timeAgo(totals?.lastSyncedAt ?? null)} · 2am UTC daily cron.
            </p>
          </div>
          <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6,
            background: 'rgba(62,207,142,0.15)', border: '1px solid rgba(62,207,142,0.4)',
            color: '#3ecf8e', fontSize: '0.7rem', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none', flexShrink: 0,
          }}>
            Open Supabase <ExternalLink size={11} />
          </a>
        </div>

        {/* Section 1 — All Projects */}
        <SectionHeader eyebrow="1. PROJECTS" title="All Supabase Projects" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
          {(supabaseLoading ? [] : projects).map((p) => {
            const sc = statusColor(p.status);
            return (
              <a
                key={p.id}
                href={`https://supabase.com/dashboard/project/${p.id}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: '16px', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#e4ede6', margin: '0 0 4px 0' }}>{p.name}</p>
                    <p style={{ fontSize: '0.7rem', color: '#6a8870', margin: 0 }}>{regionLabel(p.region)} · PG {p.pgVersion}</p>
                  </div>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, background: `${sc}18`,
                    border: `1px solid ${sc}`, fontSize: '0.6rem', fontWeight: 700,
                    letterSpacing: '0.1em', textTransform: 'uppercase', color: sc, flexShrink: 0,
                  }}>{statusLabel(p.status)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ background: '#0a1410', borderRadius: 6, padding: '8px 10px' }}>
                    <p style={{ fontSize: '0.6rem', color: '#6a8870', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Public Tables</p>
                    <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3ecf8e', margin: 0 }}>
                      {p.publicTables !== null ? p.publicTables : '—'}
                    </p>
                  </div>
                  <div style={{ background: '#0a1410', borderRadius: 6, padding: '8px 10px' }}>
                    <p style={{ fontSize: '0.6rem', color: '#6a8870', margin: '0 0 4px 0', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Created</p>
                    <p style={{ fontSize: '0.8rem', fontWeight: 600, color: '#8aad90', margin: 0 }}>
                      {new Date(p.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: sc, boxShadow: `0 0 5px ${sc}80` }} />
                  <span style={{ fontSize: '0.65rem', color: '#6a8870' }}>{p.id}</span>
                  <ExternalLink size={10} color="#3a5540" style={{ marginLeft: 'auto' }} />
                </div>
              </a>
            );
          })}
          {supabaseLoading && [0,1,2].map((i) => (
            <div key={i} style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, height: 140 }} />
          ))}
        </div>

        {/* Section 2 — Snapshot activity (AI Projects DB) */}
        <SectionHeader eyebrow="2. DASHBOARD SNAPSHOTS · AI PROJECTS DB" title="Daily Sync Activity" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <BenchKPICard label="Total Rows" value={supabaseLoading ? '—' : (totals?.totalRows ?? 0).toLocaleString()} showInfo tooltip="Snapshot rows in dashboard_daily_snapshots for this period." />
          <BenchKPICard label="Active Sources" value={supabaseLoading ? '—' : totals?.activeSources ?? 0} showInfo tooltip="Distinct data sources writing snapshots in this period." />
          <BenchKPICard label="Avg Syncs / Day" value={supabaseLoading ? '—' : totals?.avgSyncsPerDay ?? 0} showInfo tooltip="Average rows written per day across all sources." />
          <BenchKPICard label="Coverage" value={supabaseLoading ? '—' : `${totals?.daysWithData ?? 0}/${totals?.totalDays ?? 0}d`} showInfo tooltip="Days with at least one snapshot vs total days in period." />
        </div>

        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            DB Writes Per Day
          </p>
          {supabaseLoading
            ? <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: '0.75rem', color: '#6a8870' }}>Loading…</p></div>
            : <VolumeChart data={supabaseChartData} />}
        </div>

        {/* Section 3 — Source breakdown */}
        <SectionHeader eyebrow="3. SOURCE BREAKDOWN" title="Rows by data source" />
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
            {['Source', 'Rows', 'Share'].map((h) => (
              <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>{h}</span>
            ))}
          </div>
          {sources.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>{supabaseLoading ? 'Loading…' : 'No data yet.'}</p>
            </div>
          ) : sources.map((s, i) => {
            const pct = (s.rows / maxRows) * 100;
            return (
              <div key={s.source} style={{
                display: 'grid', gridTemplateColumns: '1.5fr 1fr 2fr',
                padding: '12px 16px', alignItems: 'center',
                borderBottom: i < sources.length - 1 ? '1px solid #1a2c1d' : 'none',
              }}>
                <div>
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{s.label}</p>
                  <p style={{ fontSize: '0.7rem', color: '#6a8870', margin: '2px 0 0 0' }}>{s.source}</p>
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#3ecf8e' }}>{s.rows.toLocaleString()}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#3ecf8e' }} />
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#6a8870', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                </div>
              </div>
            );
          })}
        </div>

        <p style={{ fontSize: '0.7rem', color: '#6a8870', lineHeight: 1.5 }}>
          Projects: Supabase Management API {managedByPat ? '(live)' : '(cached — add SUPABASE_ACCESS_TOKEN to Vercel for live discovery)'}
          {' · '}Snapshots: <code style={{ color: '#8aad90' }}>dashboard_daily_snapshots</code> · synced 2am UTC daily.
        </p>
      </>
    );
  }

  function ClaudeView() {
    const bannerBg = claudeConnected ? 'rgba(61,186,98,0.08)' : 'rgba(212,145,42,0.08)';
    const bannerBorder = claudeConnected ? 'rgba(61,186,98,0.3)' : 'rgba(212,145,42,0.35)';
    const bannerAccent = claudeConnected ? '#3dba62' : '#d4912a';

    return (
      <>
        <div style={{
          background: bannerBg, border: `1px solid ${bannerBorder}`,
          borderRadius: 8, padding: '12px 16px', marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Brain size={18} color={bannerAccent} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
              {claudeConnected
                ? `Connected — ${filteredUsers.length} seats, real per-user spend${claudeDataAsOf ? ` as of ${claudeDataAsOf}` : ''}`
                : 'Connect Claude data source'}
            </p>
            <p style={{ fontSize: '0.72rem', color: '#8aad90', margin: '2px 0 0 0' }}>
              {claudeConnected
                ? <>Refresh <code style={{ color: '#b8d4bd' }}>CLAUDE_SESSION_KEY</code> in Vercel env vars every ~30 days.</>
                : claudeError
                  ? <>Error: <code style={{ color: '#d4912a' }}>{claudeError}</code> — refresh the session key.</>
                  : <>Set <code style={{ color: '#b8d4bd' }}>CLAUDE_SESSION_KEY</code> + <code style={{ color: '#b8d4bd' }}>CLAUDE_ORG_ID</code> in Vercel env vars.</>}
            </p>
          </div>
          <a href="https://claude.ai/analytics/activity" target="_blank" rel="noopener noreferrer" style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 6,
            background: `${bannerAccent}26`, border: `1px solid ${bannerAccent}66`,
            color: bannerAccent, fontSize: '0.7rem', fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none', flexShrink: 0,
          }}>
            Open analytics <ExternalLink size={11} />
          </a>
        </div>

        <SectionHeader eyebrow="1. AI TOOL USAGE" title="Claude usage across departments" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <BenchKPICard label="Total Claude Spend" value={claudeLoading ? '—' : formatCurrency(claudeSpend)} showInfo tooltip={`Sum of per-user Claude spend in the ${period} window.`} />
          <BenchKPICard
            label="Active Users"
            value={claudeLoading ? '—' : claudeActive}
            showInfo
            tooltip={`Distinct users with any Claude spend. ${filteredUsers.length} seats on record.`}
            subBadge={<span style={{ fontSize: '0.65rem', color: '#6a8870' }}>{claudeActive}/{filteredUsers.length} seats active</span>}
          />
          <BenchKPICard label="Estimated Hours Saved" value={claudeLoading ? '—' : formatHours(claudeHours)} showInfo tooltip={`$1 of Claude spend ≈ ${HOURS_PER_DOLLAR} hours of augmented work.`} />
          <BenchKPICard label="Estimated Revenue Impact" value={claudeLoading ? '—' : formatCurrency(claudeHours * HOURLY_RATE)} showInfo tooltip={`Hours saved × $${HOURLY_RATE}/hr.`} />
        </div>

        {unmappedUsers.length > 0 && (
          <div style={{
            background: 'rgba(212,145,42,0.08)', border: '1px solid rgba(212,145,42,0.3)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 20,
            fontSize: '0.75rem', color: '#8aad90',
          }}>
            <strong style={{ color: '#d4912a' }}>{unmappedUsers.length} active user{unmappedUsers.length === 1 ? '' : 's'} not in roster:</strong>{' '}
            {unmappedUsers.slice(0, 5).map((u) => u.email).join(', ')}
            {unmappedUsers.length > 5 ? `, +${unmappedUsers.length - 5} more` : ''}. Add them to <code style={{ color: '#b8d4bd' }}>lib/aiToolsTeam.ts</code>.
          </div>
        )}

        <SectionHeader eyebrow="2. DEPARTMENT BREAKDOWN" title="Usage by department" />
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.6fr 1fr 1.4fr 1.1fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
            {['Department', 'Company', 'Users', 'Spend', 'Share', 'Top User'].map((h) => (
              <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>{h}</span>
            ))}
          </div>
          {filteredDepts.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>{claudeLoading ? 'Loading…' : 'Connect the Admin API key to see data.'}</p>
            </div>
          ) : filteredDepts.map((d, i) => {
            const pct = (d.spendUsd / maxDeptSpend) * 100;
            const cl = companyLabel(d.companies);
            return (
              <div key={d.department} style={{
                display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.6fr 1fr 1.4fr 1.1fr',
                padding: '12px 16px', alignItems: 'center',
                borderBottom: i < filteredDepts.length - 1 ? '1px solid #1a2c1d' : 'none',
                opacity: d.spendUsd === 0 ? 0.55 : 1,
              }}>
                <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{d.department}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: cl.color, padding: '2px 8px', background: `${cl.color}18`, border: `1px solid ${cl.color}40`, borderRadius: 4, justifySelf: 'start' }}>{cl.text}</span>
                <span style={{ fontSize: '0.85rem', color: '#8aad90' }}>{d.users}</span>
                <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 600 }}>{formatCurrency(d.spendUsd)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: cl.color }} />
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#6a8870', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#8aad90', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.topSpend > 0 ? `${d.topUser} · ${formatCurrency(d.topSpend)}` : '—'}
                </span>
              </div>
            );
          })}
        </div>

        <SectionHeader eyebrow="3. SEAT ROSTER" title="Team members by department" />
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '48px 1.5fr 1fr 1fr 1fr 1.2fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
            {['#', 'Person', 'Email', 'Department', 'Company', 'Spend'].map((h) => (
              <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>{h}</span>
            ))}
          </div>
          {filteredUsers.map((u, i) => {
            const cl = companyLabel(u.companies);
            const pct = (u.spendUsd / maxUserSpend) * 100;
            const isTop = i === 0 && u.spendUsd > 0;
            return (
              <div key={u.email} style={{
                display: 'grid', gridTemplateColumns: '48px 1.5fr 1fr 1fr 1fr 1.2fr',
                padding: '12px 16px', alignItems: 'center',
                borderBottom: i < filteredUsers.length - 1 ? '1px solid #1a2c1d' : 'none',
                opacity: u.spendUsd === 0 ? 0.5 : 1,
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#6a8870', fontWeight: 600 }}>
                  {isTop && <Trophy size={12} color="#d4912a" />}{i + 1}
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>
                    {u.name}
                    {!u.inRoster && <span style={{ marginLeft: 6, fontSize: '0.6rem', color: '#d4912a', fontWeight: 700 }}>UNMAPPED</span>}
                  </span>
                </div>
                <span style={{ fontSize: '0.72rem', color: '#8aad90', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>{u.department}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: cl.color, padding: '2px 8px', background: `${cl.color}18`, border: `1px solid ${cl.color}40`, borderRadius: 4, justifySelf: 'start' }}>{cl.text}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: cl.color }} />
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#e4ede6', fontWeight: 600, width: 56, textAlign: 'right' }}>
                    {u.spendUsd > 0 ? formatCurrency(u.spendUsd) : '—'}
                  </span>
                </div>
              </div>
            );
          })}
          {filteredUsers.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>{claudeLoading ? 'Loading…' : 'No users found.'}</p>
            </div>
          )}
        </div>
        <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 16, lineHeight: 1.5 }}>
          Source: claude.ai internal analytics · {TEAM.length}-person roster in <code style={{ color: '#8aad90' }}>lib/aiToolsTeam.ts</code> · cached 25h · refreshed daily via Vercel cron.
        </p>
      </>
    );
  }

  function NotConnectedView({ toolDef }: { toolDef: ToolDef }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '80px 24px', textAlign: 'center' }}>
        <Plug size={40} color="#2a4030" />
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#6a8870', margin: '0 0 8px 0' }}>{toolDef.label} not connected</h3>
          <p style={{ fontSize: '0.85rem', color: '#4a6450', margin: 0, maxWidth: 400, lineHeight: 1.6 }}>{toolDef.connectHint}</p>
        </div>
      </div>
    );
  }

  const activeTool = TOOLS.find((t) => t.key === tool);

  const handleRefresh = () => {
    refreshClaude();
    refreshSupabase();
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar */}
        <div style={{ padding: '12px 24px 0', flexShrink: 0, borderBottom: '1px solid #1a2c1d', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Row 1 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <PeriodTabs active={period} onChange={setPeriod} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {companyPill('all', 'All')}
                {companyPill('sinalite', 'SinaLite')}
                {companyPill('willowpack', 'Willowpack')}
              </div>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: '1px solid #1a2c1d', borderRadius: 6, padding: '5px 10px',
                  cursor: refreshing ? 'not-allowed' : 'pointer', color: '#6a8870',
                  fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                  opacity: refreshing ? 0.5 : 1,
                }}
              >
                <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Row 2: Tool tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 0 }}>
            {/* All tools pill */}
            <button onClick={() => setTool('all')} style={{
              padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
              background: tool === 'all' ? '#3dba62' : 'transparent',
              color: tool === 'all' ? '#050d07' : '#8aad90',
              border: `1px solid ${tool === 'all' ? '#3dba62' : '#1a2c1d'}`,
              fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>All Tools</button>

            {TOOLS.map((t) => {
              const active = tool === t.key;
              return (
                <button key={t.key} onClick={() => setTool(t.key)} style={{
                  padding: '5px 14px', borderRadius: 6, cursor: 'pointer',
                  background: active ? t.color + '22' : 'transparent',
                  color: active ? t.color : '#8aad90',
                  border: `1px solid ${active ? t.color + '66' : '#1a2c1d'}`,
                  fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.connected ? t.color : '#3a5540', display: 'inline-block' }} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px' }} className="custom-scroll">
          {tool === 'all'      && <AllToolsView />}
          {tool === 'claude'   && <ClaudeView />}
          {tool === 'supabase' && <SupabaseView />}
          {tool !== 'all' && tool !== 'claude' && tool !== 'supabase' && activeTool && <NotConnectedView toolDef={activeTool} />}
          <div style={{ height: 24 }} />
        </div>

      </div>
    </div>
  );
}
