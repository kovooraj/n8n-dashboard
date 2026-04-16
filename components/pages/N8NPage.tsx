'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { AutomationWorkflowSidebar } from '@/components/AutomationWorkflowSidebar';
import type { DashboardPeriod, N8NSnapshot, SidebarWorkflow, ChartPoint } from '@/lib/types';
import { buildSuccessChartData, formatCurrency, formatHours } from '@/lib/chartUtils';

const SuccessChart = dynamic(
  () => import('@/components/charts/SuccessChart').then((m) => m.SuccessChart),
  { ssr: false, loading: () => <div style={{ height: 200, background: '#0d1810', borderRadius: 8 }} /> }
);

const MOCK_SIDEBAR_WORKFLOWS: SidebarWorkflow[] = [
  { id: '1', name: 'PowerBI Report - Insert Data Into Supabase', health: 'failing' },
  { id: '2', name: 'Claude send Emails', health: 'failing' },
  { id: '3', name: "Update Alex's Notion", health: 'degraded' },
  { id: '4', name: 'Salesforce - OLP - Willowpack Quote Update', health: 'healthy' },
  { id: '5', name: 'WP Lead Tier Auditing Agent', health: 'healthy' },
  { id: '6', name: 'SinaLite AI Approval Agent', health: 'healthy' },
  { id: '7', name: 'Sales Call Intelligence', health: 'healthy' },
  { id: '8', name: 'WP Account Summarizer', health: 'healthy' },
  { id: '9', name: 'Claude Email Sender', health: 'healthy' },
  { id: '10', name: 'Notion Updater', health: 'healthy' },
];

const HEALTH_COLOR: Record<string, string> = {
  healthy: '#3dba62',
  degraded: '#d4912a',
  failing: '#e05858',
};

const HEALTH_LABEL: Record<string, string> = {
  healthy: 'Active',
  degraded: 'Degraded',
  failing: 'Failing',
};

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

/** All-workflows overview table shown when nothing is selected */
function WorkflowsOverview({ workflows }: { workflows: SidebarWorkflow[] }) {
  return (
    <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>Workflow Name</span>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>Status</span>
        <span style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870', textAlign: 'right' }}>Health</span>
      </div>
      {workflows.map((wf, i) => {
        const color = HEALTH_COLOR[wf.health] ?? '#6a8870';
        const label = HEALTH_LABEL[wf.health] ?? wf.health;
        return (
          <div
            key={wf.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 100px',
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
            <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>Running</span>
            <div style={{ textAlign: 'right' }}>
              <span style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                background: `${color}18`,
                border: `1px solid ${color}40`,
                color,
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

/** Detail view for a single selected workflow */
function WorkflowDetail({ workflow, snapshots }: { workflow: SidebarWorkflow; snapshots: N8NSnapshot[] }) {
  const color = HEALTH_COLOR[workflow.health] ?? '#6a8870';
  const label = HEALTH_LABEL[workflow.health] ?? workflow.health;
  const mockHistory = [
    { status: 'success', ago: '10H ago' },
    { status: 'error',   ago: '4H ago' },
    { status: 'success', ago: '3H ago' },
    { status: 'success', ago: '2H ago' },
    { status: 'error',   ago: '1H ago' },
  ];

  return (
    <>
      {/* Workflow title + badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e4ede6', margin: 0 }}>
          Automation: {workflow.name}
        </h1>
        <span style={{
          padding: '3px 10px',
          borderRadius: 4,
          background: `${color}18`,
          border: `1px solid ${color}50`,
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color,
          flexShrink: 0,
        }}>
          {label}
        </span>
      </div>

      {/* Recent run history */}
      <SectionHeader eyebrow="2. AUTOMATIONS" title="Recent Automation Status" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mockHistory.map((run, i) => {
          const rc = run.status === 'success' ? '#3dba62' : '#e05858';
          const rl = run.status === 'success' ? 'Success' : 'Failed';
          return (
            <div
              key={i}
              style={{
                background: '#0d1810',
                border: '1px solid #1a2c1d',
                borderRadius: 8,
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: rc, flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', color: '#e4ede6', flex: 1 }}>{workflow.name}</span>
              <span style={{ fontSize: '0.8rem', color: rc, fontWeight: 600 }}>{rl} {run.ago}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

interface N8NPageProps {
  sidebarWorkflows?: SidebarWorkflow[];
}

export function N8NPage({ sidebarWorkflows }: N8NPageProps) {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [snapshots, setSnapshots] = useState<N8NSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = overview

  const workflows = sidebarWorkflows ?? MOCK_SIDEBAR_WORKFLOWS;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/notion/n8n?period=${period}`)
      .then((r) => r.json())
      .then((data) => { setSnapshots(data.snapshots ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [period]);

  const latest = snapshots[0];
  const successRate = latest
    ? Math.round(((latest.totalTriggers - latest.failedTriggers) / Math.max(1, latest.totalTriggers)) * 100)
    : 94;

  const chartData: ChartPoint[] = buildSuccessChartData(
    snapshots.map((s) => ({ totalTriggers: s.totalTriggers, failedTriggers: s.failedTriggers, weekLabel: s.weekLabel }))
  );

  const selectedWorkflow = selectedId ? workflows.find((w) => w.id === selectedId) ?? null : null;

  const failingWorkflows = workflows.filter((w) => w.health === 'failing');

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16 }}>
          <PeriodTabs active={period} onChange={setPeriod} />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

          {/* Always show the aggregate KPIs + chart at top */}
          <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="N8N Performance Overview" />

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <ProgressMetric label="OVERALL AUTOMATION SUCCESS RATE" value={loading ? 94 : successRate} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <BenchKPICard
              label="Total Automation Triggers"
              value={loading ? '—' : (latest?.totalTriggers ?? 1552).toLocaleString()}
              showInfo
            />
            <BenchKPICard
              label="Estimated Hours Saved"
              value={loading ? '—' : formatHours(latest?.hoursSaved ?? 43)}
              showInfo
            />
            <BenchKPICard
              label="Estimated Revenue Impact"
              value={loading ? '—' : formatCurrency(latest?.revenueImpact ?? 2100)}
              showInfo
            />
            <BenchKPICard
              label="Automation Active"
              value={loading ? '—' : (latest?.activeWorkflows ?? 22)}
              showInfo
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3dba62', display: 'inline-block' }} />
                  {(latest?.activeWorkflows ?? 22) - failingWorkflows.length} Working
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e05858', display: 'inline-block', marginLeft: 6 }} />
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

          {/* Section 2: Overview table OR individual detail */}
          {selectedWorkflow ? (
            <WorkflowDetail workflow={selectedWorkflow} snapshots={snapshots} />
          ) : (
            <>
              <SectionHeader eyebrow="2. AUTOMATIONS" title="All Workflows" />

              {/* Failure alert strip */}
              {failingWorkflows.length > 0 && (
                <div style={{
                  background: 'rgba(224,88,88,0.08)',
                  border: '1px solid rgba(224,88,88,0.25)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e05858', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.85rem', color: '#e05858', fontWeight: 600 }}>
                    {failingWorkflows.length} workflow{failingWorkflows.length > 1 ? 's' : ''} currently failing:&nbsp;
                  </span>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6' }}>
                    {failingWorkflows.map((w) => w.name).join(', ')}
                  </span>
                </div>
              )}

              <WorkflowsOverview workflows={workflows} />
            </>
          )}

          <div style={{ height: 24 }} />
        </div>
      </div>

      {/* Right sidebar — click a workflow to see its detail */}
      <AutomationWorkflowSidebar
        workflows={workflows}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} // toggle off = back to overview
      />
    </div>
  );
}
