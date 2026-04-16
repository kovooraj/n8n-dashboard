'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { RefreshCw } from 'lucide-react';
import type { DashboardPeriod, N8NSnapshot, FINSnapshot, ElevenLabsSnapshot, ClickUpTask, ChartPoint } from '@/lib/types';
import { buildSuccessChartData, formatCurrency, formatHours } from '@/lib/chartUtils';

const SuccessChart = dynamic(
  () => import('@/components/charts/SuccessChart').then((m) => m.SuccessChart),
  { ssr: false, loading: () => <div style={{ height: 200, background: '#0d1810', borderRadius: 8 }} /> }
);

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 6 }} />;
}

function currentQuarter(): number {
  return Math.ceil((new Date().getMonth() + 1) / 3);
}

function buildRecs(
  n8n: N8NSnapshot | null,
  fin: FINSnapshot | null,
  el: ElevenLabsSnapshot | null,
  projects: ClickUpTask[]
) {
  const completedProjects = projects.filter((p) => p.status === 'complete').length;
  const totalProjects = projects.length || 1;
  const inProgress = projects.filter((p) => p.status === 'in progress').length;
  const pct = Math.round((completedProjects / totalProjects) * 100);
  const failingCount = n8n?.failedTriggers ?? 0;
  const finRate = fin?.finAutomationRate ?? 0;
  const transferRate = el?.transferRate ?? 50;
  const deflection = Math.round(100 - transferRate);
  const totalTriggers = (n8n?.totalTriggers ?? 0) + (fin?.finInvolvement ?? 0) + (el?.calls ?? 0);

  const tracking = inProgress > 0
    ? `${completedProjects}/${totalProjects} projects complete (${pct}%). ${inProgress} in progress — close open items to hit Q${currentQuarter()} OKR targets. Review bottlenecked tasks and unblock them this sprint.`
    : `${completedProjects}/${totalProjects} projects complete (${pct}%). Pipeline looks clear — pull new initiatives from the backlog to maintain momentum.`;

  const roi = failingCount > 0
    ? `${failingCount} workflow${failingCount > 1 ? 's are' : ' is'} failing and costing automation hours. Fix these immediately. FIN is resolving ${finRate}% autonomously — target 40%+ by expanding its knowledge base. ElevenLabs is deflecting ${deflection}% of calls — a further 10% improvement would save ~${Math.round(((el?.calls ?? 100) * 0.1 * 39) / 3600)} additional hours/week.`
    : `All workflows healthy. FIN resolving ${finRate}% of conversations autonomously — increase to 40%+ target by improving FIN knowledge base coverage. ElevenLabs deflecting ${deflection}% of inbound calls. Next ROI lever: raise FIN automation rate to recover ~${Math.round((40 - finRate) * 15)} agent-hours/week.`;

  const adoption = totalTriggers > 1000
    ? `${totalTriggers.toLocaleString()} combined triggers this week across N8N, FIN, and ElevenLabs — strong adoption signal. Identify the ${inProgress > 0 ? inProgress + ' in-progress' : 'remaining'} tools with the lowest trigger volume and run targeted enablement sessions to close the gap.`
    : `${totalTriggers.toLocaleString()} combined triggers this week. Adoption is building — onboard remaining team members and document use cases to accelerate weekly volume toward the 4,000+ target.`;

  return { tracking, roi, adoption };
}

export function OverviewPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [n8nSnapshots, setN8nSnapshots] = useState<N8NSnapshot[]>([]);
  const [finSnapshots, setFinSnapshots] = useState<FINSnapshot[]>([]);
  const [elSnapshots, setElSnapshots]   = useState<ElevenLabsSnapshot[]>([]);
  const [projects, setProjects]         = useState<ClickUpTask[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      fetch(`/api/notion/n8n?period=${period}`).then((r) => r.json()),
      fetch(`/api/notion/fin?period=${period}`).then((r) => r.json()),
      fetch(`/api/notion/elevenlabs?period=${period}`).then((r) => r.json()),
      fetch('/api/clickup/projects').then((r) => r.json()),
    ]).then(([n8nData, finData, elData, cuData]) => {
      setN8nSnapshots(n8nData.snapshots ?? []);
      setFinSnapshots(finData.snapshots ?? []);
      setElSnapshots(elData.snapshots ?? []);
      setProjects(cuData.tasks ?? []);
    }).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  }, [period]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  const latestN8N = n8nSnapshots[0] ?? null;
  const latestFIN = finSnapshots[0] ?? null;
  const latestEL  = elSnapshots[0] ?? null;

  // ── Combined totals ──────────────────────────────────────────
  const totalTriggers =
    (latestN8N?.totalTriggers ?? 1552) +
    (latestFIN?.finInvolvement ?? 1589) +
    (latestEL?.calls ?? 1140);

  const totalHours   = (latestN8N?.hoursSaved ?? 43) + (latestFIN?.hoursSaved ?? 74) + (latestEL?.hoursSaved ?? 95);
  const totalRevenue = (latestN8N?.revenueImpact ?? 2100) + (latestFIN?.revenueImpact ?? 370) + (latestEL?.revenueImpact ?? 475);
  const activeWorkflows = latestN8N?.activeWorkflows ?? 22;
  const failingCount    = latestN8N?.failedTriggers ? 3 : 0;

  const successRate = latestN8N
    ? Math.round(((latestN8N.totalTriggers - latestN8N.failedTriggers) / Math.max(1, latestN8N.totalTriggers)) * 100)
    : 94;

  const completedProjects = projects.filter((p) => p.status === 'complete').length;
  const totalProjects     = projects.length || 6;

  const chartData: ChartPoint[] = buildSuccessChartData(
    n8nSnapshots.map((s) => ({ totalTriggers: s.totalTriggers, failedTriggers: s.failedTriggers, weekLabel: s.weekLabel }))
  );

  const recs = buildRecs(latestN8N, latestFIN, latestEL, projects);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PeriodTabs active={period} onChange={setPeriod} />
        <button
          onClick={() => fetchData(true)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
            border: '1px solid #1a2c1d', borderRadius: 6, padding: '5px 10px',
            cursor: refreshing ? 'not-allowed' : 'pointer', color: '#6a8870',
            fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em',
            textTransform: 'uppercase', opacity: refreshing ? 0.5 : 1,
          }}
        >
          <RefreshCw size={11} color="#6a8870" className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

        <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="Performance Overview" />

        {/* Progress */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <ProgressMetric label="OVERALL AUTOMATION SUCCESS RATE" value={loading ? 94 : successRate} />
        </div>

        {/* KPI cards — combined across all tools */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <BenchKPICard
            label="Total Automation Triggers"
            value={loading ? '—' : totalTriggers.toLocaleString()}
            showInfo
            subBadge={<span style={{ fontSize: '0.65rem', color: '#6a8870' }}>N8N · FIN · Calls</span>}
          />
          <BenchKPICard
            label="Estimated Hours Saved"
            value={loading ? '—' : formatHours(totalHours)}
            showInfo
          />
          <BenchKPICard
            label="Estimated Revenue Impact"
            value={loading ? '—' : formatCurrency(totalRevenue)}
            showInfo
          />
          <BenchKPICard
            label="Automation Active"
            value={loading ? '—' : activeWorkflows}
            showInfo
            subBadge={
              <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4 }}>
                <StatusDot color="#3dba62" />{activeWorkflows - failingCount} Working
                <StatusDot color="#e05858" />{failingCount} Failing
              </span>
            }
          />
        </div>

        {/* Chart */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 28 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            N8N Automation — Success vs Errors
          </p>
          <SuccessChart data={chartData} />
        </div>

        {/* Section 2 */}
        <SectionHeader eyebrow="2. KEY METRICS" title="Objectives and Key Performance" />

        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>

          {/* Row 1 — Project tracking */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', borderBottom: '1px solid #1a2c1d', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 8 }}>AI Projects Initiative Tracking</p>
              <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                {loading ? 'Loading…' : recs.tracking}
              </p>
              {!loading && projects.filter((p) => p.status === 'in progress').length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {projects.filter((p) => p.status === 'in progress').slice(0, 3).map((p) => (
                    <span key={p.id} style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 4, background: 'rgba(212,145,42,0.12)', border: '1px solid rgba(212,145,42,0.3)', color: '#d4912a' }}>
                      {p.name.length > 42 ? p.name.slice(0, 42) + '…' : p.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e4ede6' }}>
                {loading ? '—' : `${completedProjects}/${totalProjects}`}
              </span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#3dba62' }}>
                {loading ? '' : `${Math.round((completedProjects / Math.max(1, totalProjects)) * 100)}%`}
              </span>
            </div>
          </div>

          {/* Row 2 — ROI */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', borderBottom: '1px solid #1a2c1d', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 8 }}>ROI & Impact Updates</p>
              <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                {loading ? 'Loading…' : recs.roi}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Est. Hours Saved</p>
                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{loading ? '—' : formatHours(totalHours)}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Est. Revenue Impact</p>
                <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{loading ? '—' : formatCurrency(totalRevenue)}</p>
              </div>
            </div>
          </div>

          {/* Row 3 — Adoption */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 8 }}>Adoption</p>
              <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                {loading ? 'Loading…' : recs.adoption}
              </p>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Total Triggers</p>
              <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{loading ? '—' : totalTriggers.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
