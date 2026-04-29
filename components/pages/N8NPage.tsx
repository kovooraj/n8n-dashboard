'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { AutomationWorkflowSidebar } from '@/components/AutomationWorkflowSidebar';
import { HideCompletedToggle } from '@/components/HideCompletedToggle';
import type { DashboardPeriod, N8NSnapshot, N8NTotals, SidebarWorkflow, ChartPoint, ClickUpTask, WorkflowHealthData, N8nExecution } from '@/lib/types';
import { buildSuccessFromBuckets, formatCurrency, formatHours } from '@/lib/chartUtils';

const N8N_BASE_URL = 'https://n8n.sinaprinting.com';

const SuccessChart = dynamic(
  () => import('@/components/charts/SuccessChart').then((m) => m.SuccessChart),
  { ssr: false, loading: () => <div style={{ height: 200, background: '#0d1810', borderRadius: 8 }} /> }
);

const HEALTH_COLOR: Record<string, string> = {
  healthy: '#3dba62',
  degraded: '#d4912a',
  failing: '#e05858',
  unknown: '#6a8870',
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Healthy',   // All executions in 5-day window successful
  degraded: 'Warning',  // Had a failure but most recent run succeeded (recovered)
  failing: 'Failing',   // Most recent execution(s) are failures, not yet recovered
  unknown: 'Unknown',
};

const STATUS_COLORS: Record<string, string> = {
  complete: '#3dba62',
  'in progress': '#d4912a',
  'on hold': '#e05858',
  'to do': '#6a8870',
  'planning / scoping': '#4a9eca',
  cancelled: '#4a4a4a',
};

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

/** All-workflows overview table */
function WorkflowsOverview({ workflows }: { workflows: SidebarWorkflow[] }) {
  return (
    <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 120px 100px', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>Workflow Name</span>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>Success Rate</span>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>Last Run</span>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870', textAlign: 'right' }}>Health</span>
      </div>
      {workflows.map((wf, i) => {
        const color = HEALTH_COLOR[wf.health] ?? '#6a8870';
        const label = HEALTH_LABEL[wf.health] ?? wf.health;
        const lastRun = wf.lastRunAt
          ? new Date(wf.lastRunAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          : '—';
        return (
          <div
            key={wf.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 130px 120px 100px',
              padding: '12px 16px',
              borderBottom: i < workflows.length - 1 ? '1px solid #1a2c1d' : 'none',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', color: '#e4ede6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wf.name}
              </span>
            </div>
            <span style={{ fontSize: '0.8rem', color: wf.successRate != null ? (wf.successRate >= 80 ? '#3dba62' : wf.successRate >= 50 ? '#d4912a' : '#e05858') : '#6a8870' }}>
              {wf.successRate != null ? `${wf.successRate}%` : '—'}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#8aad90' }}>{lastRun}</span>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                background: `${color}18`, border: `1px solid ${color}40`, color,
              }}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Build daily buckets from executions for the chart */
function buildExecChartData(executions: N8nExecution[]): ChartPoint[] {
  const buckets = new Map<string, { success: number; error: number }>();
  executions.forEach((exec) => {
    if (!exec.startedAt) return;
    const day = new Date(exec.startedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    const cur = buckets.get(day) ?? { success: 0, error: 0 };
    if (exec.status === 'success') cur.success++;
    else if (exec.status === 'error' || exec.status === 'crashed') cur.error++;
    buckets.set(day, cur);
  });
  // Return in chronological order (oldest first)
  return Array.from(buckets.entries())
    .reverse()
    .map(([label, { success, error }]) => ({ label, success, error }));
}

/** Detail view for a single selected workflow */
function WorkflowDetail({ workflow }: { workflow: SidebarWorkflow }) {
  const color = HEALTH_COLOR[workflow.health] ?? '#6a8870';
  const label = HEALTH_LABEL[workflow.health] ?? workflow.health;
  const executions = workflow.executions ?? [];
  const chartData = buildExecChartData(executions);
  const workflowUrl = `${N8N_BASE_URL}/workflow/${workflow.id}`;

  return (
    <>
      {/* Header row: name + badge + open link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e4ede6', margin: 0, flex: 1 }}>
          {workflow.name}
        </h1>
        <span style={{
          padding: '3px 10px', borderRadius: 4, background: `${color}18`,
          border: `1px solid ${color}50`, fontSize: '0.7rem', fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase', color, flexShrink: 0,
        }}>
          {label}
        </span>
        <a
          href={workflowUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '5px 12px', borderRadius: 6,
            background: 'rgba(61,186,98,0.1)', border: '1px solid rgba(61,186,98,0.35)',
            color: '#3dba62', fontSize: '0.7rem', fontWeight: 700,
            textDecoration: 'none', letterSpacing: '0.06em',
            textTransform: 'uppercase', flexShrink: 0,
          }}
        >
          Open in n8n <ExternalLink size={11} />
        </a>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Success Rate</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: workflow.successRate != null ? (workflow.successRate >= 80 ? '#3dba62' : workflow.successRate >= 50 ? '#d4912a' : '#e05858') : '#6a8870' }}>
            {workflow.successRate != null ? `${workflow.successRate}%` : '—'}
          </p>
        </div>
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Failures (Recent)</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, color: (workflow.failureCount ?? 0) > 0 ? '#e05858' : '#3dba62' }}>
            {workflow.failureCount ?? 0}
          </p>
        </div>
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Last Run</p>
          <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#e4ede6' }}>
            {workflow.lastRunAt ? new Date(workflow.lastRunAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
          </p>
        </div>
      </div>

      {/* Execution history chart */}
      {chartData.length > 0 && (
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            Triggers &amp; Errors — Execution History
          </p>
          <SuccessChart data={chartData} />
        </div>
      )}

      <SectionHeader eyebrow="2. RECENT EXECUTIONS" title="Recent Automation Runs" />
      {executions.length === 0 ? (
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
          <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>No recent executions found.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {executions.map((exec) => {
            const isSuccess = exec.status === 'success';
            const isRunning = exec.status === 'running' || exec.status === 'waiting';
            const rc = isRunning ? '#d4912a' : isSuccess ? '#3dba62' : '#e05858';
            const rl = exec.status.charAt(0).toUpperCase() + exec.status.slice(1);
            const startedAt = exec.startedAt ? new Date(exec.startedAt) : null;
            const stoppedAt = exec.stoppedAt ? new Date(exec.stoppedAt) : null;
            const duration = startedAt && stoppedAt
              ? Math.round((stoppedAt.getTime() - startedAt.getTime()) / 1000)
              : null;
            const timeAgo = startedAt ? (() => {
              const diff = Math.floor((Date.now() - startedAt.getTime()) / 1000);
              if (diff < 60) return `${diff}s ago`;
              if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
              if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
              return `${Math.floor(diff / 86400)}d ago`;
            })() : '—';
            return (
              <div
                key={exec.id}
                style={{
                  background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8,
                  padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: rc, flexShrink: 0 }} />
                <span style={{ fontSize: '0.875rem', color: '#e4ede6', flex: 1 }}>
                  {startedAt ? startedAt.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Execution'}
                  {exec.mode ? <span style={{ color: '#6a8870', marginLeft: 8, fontSize: '0.75rem' }}>{exec.mode}</span> : null}
                </span>
                {duration != null && (
                  <span style={{ fontSize: '0.75rem', color: '#6a8870' }}>{duration}s</span>
                )}
                <span style={{ fontSize: '0.8rem', color: rc, fontWeight: 600 }}>{rl} · {timeAgo}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

interface N8NPageProps {
  sidebarWorkflows?: SidebarWorkflow[];
}

export function N8NPage({ sidebarWorkflows }: N8NPageProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [buckets, setBuckets] = useState<N8NSnapshot[]>([]);
  const [totals, setTotals] = useState<N8NTotals | null>(null);
  const [liveWorkflows, setLiveWorkflows] = useState<SidebarWorkflow[]>([]);
  const [projects, setProjects] = useState<ClickUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveLoading, setLiveLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = overview
  const [hideCompleted, setHideCompleted] = useState(true); // default: hide completed tasks

  // Fetch Notion period buckets + totals for the chart/KPIs
  useEffect(() => {
    setLoading(true);
    fetch(`/api/notion/n8n?period=${period}&_t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setBuckets(data.buckets ?? []);
        setTotals(data.totals ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  // Fetch live n8n + ClickUp data
  const fetchLive = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLiveLoading(true);
    try {
      const bust = `_t=${Date.now()}`;
      const [dashResult, cuResult] = await Promise.allSettled([
        fetch(`/api/dashboard?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/clickup/projects?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (dashResult.status === 'fulfilled') {
        const dashData = dashResult.value;
        const wfHealth: WorkflowHealthData[] = dashData.workflows ?? [];
        const mapped: SidebarWorkflow[] = wfHealth.map((w) => ({
          id: w.workflow.id,
          name: w.workflow.name,
          health: w.health,
          successRate: w.successRate != null ? Math.round(w.successRate) : null,
          lastRunAt: w.lastRunAt,
          failureCount: w.failureCount,
          runningCount: w.runningCount,
          executions: w.executions,
        }));
        setLiveWorkflows(mapped);
      }
      if (cuResult.status === 'fulfilled') {
        const tasks = cuResult.value.tasks ?? [];
        setProjects(tasks);
        console.log(`[n8n-page] ClickUp tasks: ${tasks.length}, n8n-tagged: ${tasks.filter((t: ClickUpTask) => t.platform === 'n8n').length}`);
      } else {
        console.error('[n8n-page] ClickUp fetch failed:', cuResult.reason);
      }
    } catch {
      // keep previous data on error
    } finally {
      setLiveLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchLive(false); }, [fetchLive]);

  const workflows = sidebarWorkflows ?? liveWorkflows;
  // Period success rate: reflect the selected timeline. If no triggers recorded
  // in the window, we show 0 (and a "no activity" note) instead of 100 — a
  // vacuous 100% would mislead when failures are present elsewhere.
  const successRate = totals && totals.totalTriggers > 0
    ? Math.round(((totals.totalTriggers - totals.failedTriggers) / totals.totalTriggers) * 100)
    : null;

  const chartData: ChartPoint[] = buildSuccessFromBuckets(
    buckets.map((b) => ({ label: b.label ?? b.weekLabel, metrics: { totalTriggers: b.totalTriggers, failedTriggers: b.failedTriggers } })),
    'totalTriggers',
    'failedTriggers',
  );

  const selectedWorkflow = selectedId ? workflows.find((w) => w.id === selectedId) ?? null : null;

  // Strictly failing: most-recent run was a failure (health === 'failing')
  const failingWorkflows = workflows.filter((w) => w.health === 'failing');
  // Warning: recovered but had failures in the 5-day window
  const warningWorkflows = workflows.filter((w) => w.health === 'degraded');
  // Any workflow that had a failure in the last 24 hours (regardless of current health)
  const recentlyFailedWorkflows = workflows.filter((w) =>
    (w.executions ?? []).some(
      (e) =>
        (e.status === 'error' || e.status === 'crashed') &&
        e.startedAt &&
        Date.now() - new Date(e.startedAt).getTime() <= 24 * 60 * 60 * 1000,
    ),
  );

  const allN8nProjects = projects.filter((p) => p.platform === 'n8n');
  const completedN8nCount = allN8nProjects.filter((p) => p.status === 'complete').length;
  const n8nProjects = hideCompleted
    ? allN8nProjects.filter((p) => p.status !== 'complete')
    : allN8nProjects;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top bar: period tabs + refresh */}
        <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <PeriodTabs active={period} onChange={setPeriod} />
          <button
            onClick={() => { fetchLive(true); setLoading(true); fetch(`/api/notion/n8n?period=${period}&_t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).then(d => { setBuckets(d.buckets ?? []); setTotals(d.totals ?? null); setLoading(false); }).catch(() => setLoading(false)); }}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'transparent', border: '1px solid #1a2c1d',
              borderRadius: 6, padding: '5px 10px', cursor: refreshing ? 'not-allowed' : 'pointer',
              color: '#6a8870', fontSize: '0.65rem', fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              opacity: refreshing ? 0.5 : 1, transition: 'opacity 0.2s',
            }}
          >
            <RefreshCw size={11} color="#6a8870" className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

          {/* ── OVERVIEW VIEW ── */}
          {!selectedWorkflow && (
            <>
              <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="N8N Performance Overview" />

              <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <ProgressMetric
                  label={`AUTOMATION SUCCESS RATE · ${period.toUpperCase()}`}
                  value={loading || successRate == null ? 0 : successRate}
                />
                {!loading && totals && totals.totalTriggers > 0 && (
                  <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8 }}>
                    {(totals.totalTriggers - totals.failedTriggers).toLocaleString()} successful / {totals.totalTriggers.toLocaleString()} total triggers · {totals.failedTriggers} failed
                  </p>
                )}
                {!loading && (!totals || totals.totalTriggers === 0) && (
                  <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8 }}>
                    No triggers recorded in the selected {period} window.
                  </p>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                <BenchKPICard
                  label="Total Automation Triggers"
                  value={loading ? '—' : (totals?.totalTriggers ?? 0).toLocaleString()}
                  showInfo
                  tooltip={period === 'weekly'
                    ? `Live count: every n8n execution started in the last 7 days across every active workflow. Pulled from the n8n Executions API and bucketed per day.`
                    : `Sum of "Total Triggers" from weekly Notion rollup rows that fall inside the selected ${period} window.`}
                />
                <BenchKPICard
                  label="Estimated Hours Saved"
                  value={loading ? '—' : formatHours(totals?.hoursSaved ?? 0)}
                  showInfo
                  tooltip={`Derived from Notion's "Total Hours Saved" formula (manual-equivalent effort × triggers). ${period === 'weekly' ? 'For weekly, uses the latest Notion weekly row (live executions don\u2019t carry business-impact estimates).' : `Summed across Notion rows in the ${period} window.`}`}
                />
                <BenchKPICard
                  label="Estimated Revenue Impact"
                  value={loading ? '—' : formatCurrency(totals?.revenueImpact ?? 0)}
                  showInfo
                  tooltip={`Derived from Notion's "Total Revenue Impact" formula. Accounts for labour cost avoidance + revenue protected/unlocked per workflow. ${period === 'weekly' ? 'For weekly, uses the latest Notion weekly row.' : `Summed across Notion rows in the ${period} window.`}`}
                />
                <BenchKPICard
                  label="Workflows Active"
                  // Prefer live workflow count (reflects actual reality) over Notion snapshot
                  value={liveLoading ? '—' : (workflows.length || totals?.activeWorkflows || 0)}
                  showInfo
                  tooltip={`Live count from the n8n API — every workflow with active=true right now. Health: Healthy = all runs successful in the last 5 days; Warning = recovered (last run OK but there were failures in the last 5 days); Failing = most recent run failed.`}
                  subBadge={
                    <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3dba62', display: 'inline-block' }} />
                      {workflows.filter((w) => w.health === 'healthy').length} Healthy
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#d4912a', display: 'inline-block', marginLeft: 4 }} />
                      {warningWorkflows.length} Warning
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e05858', display: 'inline-block', marginLeft: 4 }} />
                      {failingWorkflows.length} Failing
                    </span>
                  }
                />
              </div>

              <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 28 }}>
                <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
                  Success vs Errors
                </p>
                <SuccessChart data={chartData} />
              </div>

              <SectionHeader eyebrow="2. AUTOMATIONS" title="All Workflows" />

              {liveLoading ? (
                <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center', marginBottom: 14 }}>
                  <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>Fetching live workflow data from n8n…</p>
                </div>
              ) : (
                <>
                  {/* Unified 24h failure banner — ALL workflows that had any failure in the last 24h */}
                  {(() => {
                    // recentlyFailedWorkflows = had any failure in last 24h (regardless of current health)
                    const allFailed24h = recentlyFailedWorkflows;
                    if (allFailed24h.length === 0) return <div style={{ marginBottom: 14 }} />;

                    // Split by severity for display ordering
                    const stillFailing  = allFailed24h.filter((w) => w.health === 'failing');
                    const nowRecovered  = allFailed24h.filter((w) => w.health !== 'failing');

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                        {/* Currently still failing */}
                        {stillFailing.length > 0 && (
                          <div style={{
                            background: 'rgba(224,88,88,0.08)', border: '1px solid rgba(224,88,88,0.3)',
                            borderRadius: 8, padding: '10px 14px',
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                          }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e05858', flexShrink: 0, marginTop: 5 }} />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.85rem', color: '#e05858', fontWeight: 700 }}>
                                {stillFailing.length} workflow{stillFailing.length > 1 ? 's' : ''} currently failing:
                              </span>
                              <span style={{ fontSize: '0.85rem', color: '#e4ede6', marginLeft: 6 }}>
                                {stillFailing.map((w) => w.name).join(', ')}
                              </span>
                              <p style={{ fontSize: '0.72rem', color: '#8a6060', margin: '3px 0 0 0' }}>
                                Most recent execution failed — no successful recovery run yet.
                              </p>
                            </div>
                          </div>
                        )}
                        {/* Recovered — had a failure in last 24h but last run succeeded */}
                        {nowRecovered.length > 0 && (
                          <div style={{
                            background: 'rgba(212,145,42,0.08)', border: '1px solid rgba(212,145,42,0.3)',
                            borderRadius: 8, padding: '10px 14px',
                            display: 'flex', alignItems: 'flex-start', gap: 10,
                          }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d4912a', flexShrink: 0, marginTop: 5 }} />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.85rem', color: '#d4912a', fontWeight: 700 }}>
                                {nowRecovered.length} workflow{nowRecovered.length > 1 ? 's' : ''} failed in the last 24h but recovered:
                              </span>
                              <span style={{ fontSize: '0.85rem', color: '#e4ede6', marginLeft: 6 }}>
                                {nowRecovered.map((w) => w.name).join(', ')}
                              </span>
                              <p style={{ fontSize: '0.72rem', color: '#8a7040', margin: '3px 0 0 0' }}>
                                Most recent run succeeded — monitor closely.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <WorkflowsOverview workflows={workflows} />
                </>
              )}

              {/* N8N ClickUp Projects */}
              {!liveLoading && (
                <div style={{ marginTop: 28 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <SectionHeader eyebrow="3. AI PROJECTS" title="N8N Workflow Projects" />
                    <HideCompletedToggle
                      checked={hideCompleted}
                      onChange={setHideCompleted}
                      count={completedN8nCount}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {n8nProjects.map((project) => {
                      const statusColor = STATUS_COLORS[project.status] ?? '#6a8870';
                      return (
                        <a
                          key={project.id}
                          href={project.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8,
                            padding: '12px 14px', display: 'flex', justifyContent: 'space-between',
                            alignItems: 'center', gap: 12, textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e4ede6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {project.name}
                            </p>
                            {project.assignees.length > 0 && (
                              <p style={{ fontSize: '0.75rem', color: '#6a8870', marginTop: 3 }}>
                                {project.assignees.join(', ')}
                              </p>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                            <span style={{
                              padding: '2px 8px', borderRadius: 4, background: `${statusColor}18`,
                              border: `1px solid ${statusColor}`, fontSize: '0.6rem', fontWeight: 700,
                              letterSpacing: '0.1em', textTransform: 'uppercase', color: statusColor,
                            }}>
                              {project.status}
                            </span>
                            <span style={{ fontSize: '0.6rem', color: '#6a8870' }}>
                              Updated {new Date(project.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </a>
                      );
                    })}
                    {n8nProjects.length === 0 && (
                      <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
                        <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>No n8n-tagged tasks found in ClickUp.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── WORKFLOW DETAIL VIEW ── */}
          {selectedWorkflow && <WorkflowDetail workflow={selectedWorkflow} />}

          <div style={{ height: 24 }} />
        </div>
      </div>

      {/* Right sidebar */}
      <AutomationWorkflowSidebar
        workflows={liveLoading ? [] : workflows}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
      />

    </div>
  );
}
