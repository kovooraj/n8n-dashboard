'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { RefreshCw } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { HideCompletedToggle } from '@/components/HideCompletedToggle';
import type { DashboardPeriod, ElevenLabsSnapshot, ElevenLabsTotals, ClickUpTask } from '@/lib/types';
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

export function ElevenLabsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [buckets, setBuckets] = useState<ElevenLabsSnapshot[]>([]);
  const [totals, setTotals] = useState<ElevenLabsTotals | null>(null);
  const [projects, setProjects] = useState<ClickUpTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const bust = `_t=${Date.now()}`;
    Promise.allSettled([
      fetch(`/api/elevenlabs/calls?period=${period}&${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/clickup/projects?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([elResult, cuResult]) => {
      if (elResult.status === 'fulfilled') {
        setBuckets(elResult.value.buckets ?? []);
        setTotals(elResult.value.totals ?? null);
      }
      if (cuResult.status === 'fulfilled') setProjects(cuResult.value.tasks ?? []);
    }).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  }, [period]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  const deflectionRate = totals ? Number((100 - totals.transferRate).toFixed(1)) : 0;
  const transferredCount = totals ? Math.round(totals.calls * (totals.transferRate / 100)) : 0;
  const resolvedCount = totals ? Math.round(totals.calls * (1 - totals.transferRate / 100)) : 0;
  // Hours saved = resolved calls × average call duration (seconds) ÷ 3600
  const hoursSavedCalc = totals ? (resolvedCount * (totals.avgDuration ?? 0)) / 3600 : 0;
  // Revenue impact = hours saved × $20/hr (loaded labour rate)
  const REVENUE_PER_HOUR = 20;
  const revenueImpactCalc = hoursSavedCalc * REVENUE_PER_HOUR;

  // Volume chart: total calls vs deflected (calls - transferred) per bucket
  const chartData: VolumePoint[] = buildVolumeFromBuckets(
    buckets.map((b) => ({
      label: b.label ?? b.weekLabel,
      metrics: {
        total: b.calls,
        resolved: Math.round(b.calls * (1 - b.transferRate / 100)),
      },
    })),
    'total',
    'resolved',
  );

  const allCallProjects = projects.filter((p) => p.platform === 'elevenlabs');
  const completedCallCount = allCallProjects.filter((p) => p.status === 'complete').length;
  const callProjects = hideCompleted
    ? allCallProjects.filter((p) => p.status !== 'complete')
    : allCallProjects;

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
            label="# of Calls Auto Resolved"
            value={loading ? '—' : resolvedCount.toLocaleString()}
            showInfo
            tooltip={`Calls handled end-to-end by the AI voice agent without transferring to a human: total calls × (100 − transfer rate). Total calls ${loading ? 0 : (totals?.calls ?? 0).toLocaleString()} × ${loading ? 0 : deflectionRate}% deflection for the ${period} window.`}
          />
          <BenchKPICard
            label="Transferred to Live Agent"
            value={loading ? '—' : `${totals?.transferRate ?? 0}%`}
            showInfo
            tooltip={`Average of daily "Transfer to live agent %" values over the ${period} window. The inverse (100 − this) is the deflection rate — calls the AI agent handled end-to-end without handing off.`}
          />
          <BenchKPICard
            label="Estimated Hours Saved"
            value={loading ? '—' : formatHours(hoursSavedCalc)}
            showInfo
            tooltip={`Resolved calls × average call duration (seconds) ÷ 3600. ${loading ? 0 : resolvedCount.toLocaleString()} resolved × ${loading ? 0 : (totals?.avgDuration ?? 0)}s avg duration for the ${period} window.`}
          />
          <BenchKPICard
            label="Estimated Revenue Impact"
            value={loading ? '—' : formatCurrency(revenueImpactCalc)}
            showInfo
            tooltip={`Hours saved × $${REVENUE_PER_HOUR}/hour (loaded labour rate). ${loading ? '0.0h' : formatHours(hoursSavedCalc)} × $${REVENUE_PER_HOUR} for the ${period} window.`}
          />
          <BenchKPICard
            label="CSAT Score"
            value={loading ? '—' : (totals && totals.csat > 0 ? `${totals.csat}%` : 'N/A')}
            showInfo
            tooltip={`Caller satisfaction rating averaged across daily Notion rows. Shows N/A when no CSAT data has been recorded for the ${period} window.`}
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
                action: `Raise deflection rate from ${loading ? 0 : deflectionRate}% → 65%+`,
                detail: `${loading ? 0 : transferredCount.toLocaleString()} calls transferred to live agents this period. Analyse the top 10 transfer reasons and add targeted agent responses for each — a 15-point deflection gain saves ~${loading ? 0 : Math.round(((totals?.calls ?? 0) * 0.15 * (totals?.avgDuration ?? 0)) / 3600)} additional agent-hours over this period.`,
              },
              {
                action: `Reduce average call duration from ${loading ? 0 : (totals?.avgDuration ?? 0)}s`,
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionHeader eyebrow="3. AUTOMATIONS" title="Call Related Projects" />
          <HideCompletedToggle
            checked={hideCompleted}
            onChange={setHideCompleted}
            count={completedCallCount}
          />
        </div>
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
