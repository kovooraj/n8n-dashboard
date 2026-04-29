'use client';

import { useState } from 'react';
import { useStaleData } from '@/lib/useStaleData';
import dynamic from 'next/dynamic';
import { RefreshCw } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { HideCompletedToggle } from '@/components/HideCompletedToggle';
import type { DashboardPeriod, FINSnapshot, FINTotals, ClickUpTask } from '@/lib/types';
import { buildVolumeFromBuckets, formatCurrency, formatHours } from '@/lib/chartUtils';
import type { VolumePoint } from '@/lib/types';

const VolumeChart = dynamic(
  () => import('@/components/charts/VolumeChart').then((m) => m.VolumeChart),
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

const STATUS_COLORS: Record<string, string> = {
  complete: '#3dba62',
  'in progress': '#d4912a',
  'on hold': '#e05858',
  'to do': '#6a8870',
  'planning / scoping': '#4a9eca',
  cancelled: '#4a4a4a',
};

type ChannelFilter = 'all' | 'messenger' | 'email';

const CHANNEL_OPTIONS: { key: ChannelFilter; label: string; icon: string }[] = [
  { key: 'all',       label: 'All Channels', icon: '⊕' },
  { key: 'messenger', label: 'Messenger',    icon: '💬' },
  { key: 'email',     label: 'Email',        icon: '✉' },
];

export function FINPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [hideCompleted, setHideCompleted] = useState(true);

  const { data, loading, refreshing, stale, refresh } = useStaleData(
    `fin-${period}-${channel}`,
    async (isRefresh) => {
      const force = isRefresh ? '&refresh=1' : '';
      const [finResult, cuResult] = await Promise.allSettled([
        fetch(`/api/intercom/fin?period=${period}&channel=${channel}&_t=${Date.now()}${force}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/clickup/projects?_t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      return {
        buckets: finResult.status === 'fulfilled' ? (finResult.value.buckets ?? []) as FINSnapshot[] : [] as FINSnapshot[],
        totals: finResult.status === 'fulfilled' ? (finResult.value.totals ?? null) as FINTotals | null : null,
        projects: cuResult.status === 'fulfilled' ? (cuResult.value.tasks ?? []) as ClickUpTask[] : [] as ClickUpTask[],
      };
    },
    [period, channel],
  );

  const buckets = data?.buckets ?? [];
  const totals = data?.totals ?? null;
  const projects = data?.projects ?? [];

  const chartData: VolumePoint[] = buildVolumeFromBuckets(
    buckets.map((b) => ({ label: b.label ?? b.weekLabel, metrics: { total: b.finInvolvement, resolved: b.finResolved } })),
    'total',
    'resolved',
  );

  const resolutionRate = totals?.finAutomationRate ?? 0;
  const escalatedCount = totals ? Math.max(0, totals.finInvolvement - totals.finResolved) : 0;

  const allFinProjects = projects.filter((p) => p.platform === 'fin');
  const completedFinCount = allFinProjects.filter((p) => p.status === 'complete').length;
  const finProjects = hideCompleted
    ? allFinProjects.filter((p) => p.status !== 'complete')
    : allFinProjects;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Period tabs + channel filter + refresh */}
      <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, borderBottom: '1px solid #1a2c1d', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <PeriodTabs active={period} onChange={setPeriod} />
          <button
            onClick={() => refresh()}
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

        {/* Channel filter pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870', marginRight: 4 }}>Channel</span>
          {CHANNEL_OPTIONS.map((opt) => {
            const active = channel === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setChannel(opt.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  background: active ? '#1a2c1d' : 'transparent',
                  color: active ? '#e4ede6' : '#8aad90',
                  border: `1px solid ${active ? '#3dba62' : '#1a2c1d'}`,
                  fontSize: '0.7rem', fontWeight: active ? 700 : 500,
                  letterSpacing: '0.04em', transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: '0.75rem' }}>{opt.icon}</span>
                {opt.label}
              </button>
            );
          })}
          {channel !== 'all' && (
            <span style={{
              fontSize: '0.6rem', color: '#d4912a', fontWeight: 600, letterSpacing: '0.08em',
              padding: '2px 8px', background: 'rgba(212,145,42,0.1)', border: '1px solid rgba(212,145,42,0.3)',
              borderRadius: 4, marginLeft: 4,
            }}>
              Filtered · {CHANNEL_OPTIONS.find(o => o.key === channel)?.label} only
            </span>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">
        {/* Section 1 */}
        <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="FIN Performance Overview" />

        {/* Progress */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <ProgressMetric
            label="OVERALL RESOLUTION RATE"
            value={loading ? 28 : resolutionRate}
          />
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
          <BenchKPICard
            label="Conversations"
            value={loading ? '—' : (totals?.finInvolvement ?? 0).toLocaleString()}
            showInfo
            tooltip={`"Fin Involvement" from the Intercom FIN Notion database — count of customer conversations where Fin engaged. Summed across daily rows in the selected ${period} window.`}
          />
          <BenchKPICard
            label="Estimated Hours Saved"
            value={loading ? '—' : formatHours(totals?.hoursSaved ?? 0)}
            showInfo
            tooltip={`Notion formula "Total Hours Saved" for FIN: resolved conversations × average human handle time saved. Summed over the ${period} window.`}
          />
          <BenchKPICard
            label="Estimated Revenue Impact"
            value={loading ? '—' : formatCurrency(totals?.revenueImpact ?? 0)}
            showInfo
            tooltip={`Notion formula "Total Revenue Impact" for FIN: labour cost avoided on autonomously resolved chats + retention value from faster response. Summed over the ${period} window.`}
          />
          <BenchKPICard
            label="CSAT Score"
            value={loading ? '—' : `${totals?.csat ?? 0}%`}
            showInfo
            tooltip={`Customer satisfaction rating averaged across daily Notion rows in the ${period} window. Source: Intercom's post-conversation CSAT pulled into the Notion FIN database.`}
          />
        </div>

        {/* Area chart */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            Volume of Resolved vs Overall Volume
          </p>
          <VolumeChart data={chartData} />
        </div>

        {/* Section 2 */}
        <SectionHeader eyebrow="2. KEY METRICS" title="Performance Summary" />
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, marginBottom: 24 }}>
          <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 14 }}>Key Improvement Areas</p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              {
                action: `Raise FIN resolution rate from ${loading ? 0 : resolutionRate}% → 40%+`,
                detail: 'Audit the top 20 unresolved conversation topics and add targeted Fin Guidance rules for each. A 12-point gain saves ~50 additional agent-hours over this period.',
              },
              {
                action: 'Reduce escalation rate on billing & account queries',
                detail: `${loading ? 0 : escalatedCount.toLocaleString()} conversations escalated to agents this period. Map common billing intent patterns and add FIN procedures to handle order status, invoice questions, and refund eligibility autonomously.`,
              },
              {
                action: `Push CSAT from ${loading ? 0 : (totals?.csat ?? 0)}% toward 85%`,
                detail: 'Review negative-rated conversations for response latency outliers. Enable follow-up messaging for high-volume topic clusters where response time exceeds 2 seconds.',
              },
              {
                action: 'Expand FIN to cover new product category queries',
                detail: 'Roll stock, large format, and specialty substrate queries are arriving via live chat but not yet handled by FIN. Add 3–5 new procedures this sprint to cover the most frequent inbound topics.',
              },
            ].map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 12, lineHeight: 1.6 }}>
                <span style={{ color: '#3dba62', flexShrink: 0, marginTop: 3, fontSize: '0.9rem' }}>→</span>
                <div>
                  <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e4ede6', marginBottom: 3 }}>{item.action}</p>
                  <p style={{ fontSize: '0.825rem', color: '#8aad90' }}>{item.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Section 3 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionHeader eyebrow="3. AUTOMATIONS" title="Fin Related Projects" />
          <HideCompletedToggle
            checked={hideCompleted}
            onChange={setHideCompleted}
            count={completedFinCount}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(loading ? [] : finProjects).map((project) => {
            const statusColor = STATUS_COLORS[project.status] ?? '#6a8870';
            return (
              <a
                key={project.id}
                href={project.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: '#0d1810',
                  border: '1px solid #1a2c1d',
                  borderRadius: 8,
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  textDecoration: 'none',
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
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: `${statusColor}18`,
                      border: `1px solid ${statusColor}`,
                      fontSize: '0.6rem',
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: statusColor,
                    }}
                  >
                    {project.status}
                  </span>
                  <span style={{ fontSize: '0.6rem', color: '#6a8870' }}>
                    Updated {new Date(project.updatedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </a>
            );
          })}
          {loading && (
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>Loading projects…</p>
            </div>
          )}
          {!loading && finProjects.length === 0 && (
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>No FIN-tagged tasks found in ClickUp.</p>
            </div>
          )}
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
