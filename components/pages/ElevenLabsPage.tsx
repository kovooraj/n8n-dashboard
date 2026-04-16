'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import type { DashboardPeriod, ElevenLabsSnapshot, ClickUpTask } from '@/lib/types';
import { buildVolumeChartData, formatCurrency, formatHours } from '@/lib/chartUtils';
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

export function ElevenLabsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [snapshots, setSnapshots] = useState<ElevenLabsSnapshot[]>([]);
  const [projects, setProjects] = useState<ClickUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    Promise.allSettled([
      fetch(`/api/notion/elevenlabs?period=${period}`).then((r) => r.json()),
      fetch('/api/clickup/projects').then((r) => r.json()),
    ]).then(([elResult, cuResult]) => {
      if (elResult.status === 'fulfilled') setSnapshots(elResult.value.snapshots ?? []);
      if (cuResult.status === 'fulfilled') setProjects(cuResult.value.tasks ?? []);
    }).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  }, [period]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  const latest = snapshots[0];
  const deflectionRate = latest ? Math.round(100 - latest.transferRate) : 50.7;

  const chartData: VolumePoint[] = buildVolumeChartData(
    snapshots.map((s) => ({
      total: s.calls,
      resolved: Math.round(s.calls * (1 - s.transferRate / 100)),
      weekLabel: s.weekLabel,
    }))
  );

  const callProjects = projects.filter((p) => p.platform === 'elevenlabs');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Period tabs + refresh */}
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

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">
        {/* Section 1 */}
        <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="Call Performance Overview" />

        {/* Progress */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <ProgressMetric
            label="OVERALL DEFLECTION"
            value={loading ? 50.7 : deflectionRate}
          />
        </div>

        {/* KPI cards — 5 cards for ElevenLabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 20 }}>
          <BenchKPICard
            label="Total # of Calls"
            value={loading ? '—' : (latest?.calls ?? 1140).toLocaleString()}
            showInfo
          />
          <BenchKPICard
            label="Transferred to Live Agent"
            value={loading ? '—' : `${latest?.transferRate ?? 49.3}%`}
            showInfo
          />
          <BenchKPICard
            label="Estimated Hours Saved"
            value={loading ? '—' : formatHours(latest?.hoursSaved ?? 95)}
            showInfo
          />
          <BenchKPICard
            label="Estimated Revenue Impact"
            value={loading ? '—' : formatCurrency(latest?.revenueImpact ?? 475)}
            showInfo
          />
          <BenchKPICard
            label="CSAT Score"
            value="N/A"
            showInfo
          />
        </div>

        {/* Area chart */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            Calls Deflected vs Overall Call Volume
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
                action: `Raise deflection rate from ${loading ? 50.7 : deflectionRate.toFixed(1)}% → 65%+`,
                detail: `${loading ? 561 : Math.round((latest?.calls ?? 1140) * ((latest?.transferRate ?? 49.3) / 100))} calls transferred to live agents this week. Analyse the top 10 transfer reasons and add targeted agent responses for each — a 15-point deflection gain saves ~${Math.round(((latest?.calls ?? 1140) * 0.15 * (latest?.avgDuration ?? 39)) / 3600)} additional agent-hours/week.`,
              },
              {
                action: `Reduce average call duration from ${loading ? 39 : (latest?.avgDuration ?? 39)}s`,
                detail: 'Calls averaging 39 seconds suggests agents are not resolving intent in the first turn. Review conversation transcripts for ambiguous opening prompts and tighten the greeting + intent-detection logic.',
              },
              {
                action: 'Expand to after-hours call coverage',
                detail: 'ElevenLabs agents run 24/7 but after-hours routing may not be fully configured. Validate that inbound calls outside business hours are routed to the AI agent rather than voicemail — this is likely leaving call volume unserved.',
              },
              {
                action: 'Activate post-call CSAT surveys',
                detail: 'No CSAT data is being collected. Enable post-call SMS or IVR surveys immediately — without this signal you cannot measure quality or detect when deflection is happening for the wrong reasons (i.e. frustrated hang-ups).',
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
        <SectionHeader eyebrow="3. AUTOMATIONS" title="Call Related Projects" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(loading ? [] : callProjects).map((project) => {
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
          {!loading && callProjects.length === 0 && (
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 20, textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: '#6a8870' }}>No 11labs-tagged tasks found in ClickUp.</p>
            </div>
          )}
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
