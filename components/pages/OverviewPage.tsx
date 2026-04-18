'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { RefreshCw } from 'lucide-react';
import type { DashboardPeriod, N8NSnapshot, FINSnapshot, ElevenLabsSnapshot, ClickUpTask, ChartPoint, N8NTotals, FINTotals, ElevenLabsTotals, WorkflowHealthData } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';

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
  n8n: N8NTotals | null,
  fin: FINTotals | null,
  el: ElevenLabsTotals | null,
  projects: ClickUpTask[],
  periodLabel: string,
) {
  const inProgress = projects.filter((p) => p.status === 'in progress').length;
  const done = projects.filter((p) => p.status === 'complete').length;
  const scoping = projects.filter((p) => p.status === 'planning / scoping').length;
  const failingCount = n8n?.failedTriggers ?? 0;
  const finRate = fin?.finAutomationRate ?? 0;
  const transferRate = el?.transferRate ?? 50;
  const deflection = Math.round(100 - transferRate);
  const totalTriggers = (n8n?.totalTriggers ?? 0) + (fin?.finInvolvement ?? 0) + (el?.calls ?? 0);

  const tracking = inProgress > 0
    ? `${inProgress} task${inProgress > 1 ? 's' : ''} in progress, ${scoping} in scoping, ${done} complete. Focus on unblocking high-priority items to hit Q${currentQuarter()} OKR targets this sprint.`
    : `${done} tasks complete, ${scoping} in scoping. Pipeline looks clear — pull new initiatives from the backlog to maintain momentum.`;

  const roi = failingCount > 0
    ? `${failingCount} workflow${failingCount > 1 ? 's are' : ' is'} failing and costing automation hours. Fix these immediately. FIN is resolving ${finRate}% autonomously — target 40%+ by expanding its knowledge base. ElevenLabs is deflecting ${deflection}% of calls — a further 10% improvement would save ~${Math.round(((el?.calls ?? 100) * 0.1 * 39) / 3600)} additional hours over this ${periodLabel}.`
    : `All workflows healthy. FIN resolving ${finRate}% of conversations autonomously — increase to 40%+ target by improving FIN knowledge base coverage. ElevenLabs deflecting ${deflection}% of inbound calls. Next ROI lever: raise FIN automation rate to recover ~${Math.round((40 - finRate) * 15)} agent-hours/${periodLabel}.`;

  const adoption = totalTriggers > 1000
    ? `${totalTriggers.toLocaleString()} combined triggers this ${periodLabel} across N8N, FIN, and ElevenLabs — strong adoption signal. Identify the ${inProgress > 0 ? inProgress + ' in-progress' : 'remaining'} tools with the lowest trigger volume and run targeted enablement sessions to close the gap.`
    : `${totalTriggers.toLocaleString()} combined triggers this ${periodLabel}. Adoption is building — onboard remaining team members and document use cases to accelerate volume toward targets.`;

  return { tracking, roi, adoption };
}

function periodLabelFor(p: DashboardPeriod): string {
  return p === 'weekly' ? 'week' : p === 'monthly' ? 'month' : p === 'quarterly' ? 'quarter' : 'year';
}

export function OverviewPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [n8nBuckets, setN8nBuckets] = useState<N8NSnapshot[]>([]);
  const [finBuckets, setFinBuckets] = useState<FINSnapshot[]>([]);
  const [elBuckets,  setElBuckets]  = useState<ElevenLabsSnapshot[]>([]);
  const [n8nTotals, setN8nTotals] = useState<N8NTotals | null>(null);
  const [finTotals, setFinTotals] = useState<FINTotals | null>(null);
  const [elTotals,  setElTotals]  = useState<ElevenLabsTotals | null>(null);
  const [liveWorkflows, setLiveWorkflows] = useState<WorkflowHealthData[]>([]);
  const [projects, setProjects]         = useState<ClickUpTask[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

  const fetchData = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const bust = `_t=${Date.now()}`;
    Promise.allSettled([
      fetch(`/api/notion/n8n?period=${period}&${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/notion/fin?period=${period}&${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/notion/elevenlabs?period=${period}&${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/clickup/projects?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/dashboard?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
    ]).then(([n8nResult, finResult, elResult, cuResult, dashResult]) => {
      if (n8nResult.status === 'fulfilled') {
        setN8nBuckets(n8nResult.value.buckets ?? []);
        setN8nTotals(n8nResult.value.totals ?? null);
      }
      if (finResult.status === 'fulfilled') {
        setFinBuckets(finResult.value.buckets ?? []);
        setFinTotals(finResult.value.totals ?? null);
      }
      if (elResult.status === 'fulfilled') {
        setElBuckets(elResult.value.buckets ?? []);
        setElTotals(elResult.value.totals ?? null);
      }
      if (dashResult.status === 'fulfilled') {
        setLiveWorkflows(dashResult.value.workflows ?? []);
      }
      if (cuResult.status === 'fulfilled') {
        const tasks = cuResult.value.tasks ?? [];
        setProjects(tasks);
        console.log(`[dashboard] ClickUp tasks loaded: ${tasks.length}`, {
          build: 'v3',
          period,
          statuses: tasks.reduce((a: Record<string, number>, t: ClickUpTask) => {
            a[t.status] = (a[t.status] ?? 0) + 1;
            return a;
          }, {}),
        });
      } else {
        console.error('[dashboard] ClickUp fetch failed:', cuResult.reason);
      }
    }).catch(() => {}).finally(() => { setLoading(false); setRefreshing(false); });
  }, [period]);

  useEffect(() => { fetchData(false); }, [fetchData]);

  // ── Combined totals for the selected period ──────────────────
  const totalTriggers =
    (n8nTotals?.totalTriggers ?? 0) +
    (finTotals?.finInvolvement ?? 0) +
    (elTotals?.calls ?? 0);

  const totalHours   = (n8nTotals?.hoursSaved ?? 0) + (finTotals?.hoursSaved ?? 0) + (elTotals?.hoursSaved ?? 0);
  const totalRevenue = (n8nTotals?.revenueImpact ?? 0) + (finTotals?.revenueImpact ?? 0) + (elTotals?.revenueImpact ?? 0);

  // Active automations — use LIVE n8n workflow count when available so the
  // number reflects actual reality (14 healthy + 2 degraded + 2 failing, etc)
  // rather than a Notion snapshot that can lag. Fall back to Notion totals
  // only if the live API is down.
  const liveN8nActive = liveWorkflows.length;
  const n8nActive = liveN8nActive > 0 ? liveN8nActive : (n8nTotals?.activeWorkflows ?? 0);
  const finActive = finTotals?.activeFinProcedures ?? 0;
  const elActive  = elTotals?.agents ?? 0;
  const totalActive = n8nActive + finActive + elActive;
  // Live failing count wins over Notion's weekly aggregate (current state > snapshot)
  const liveFailing = liveWorkflows.filter((w) => w.health === 'failing').length;
  const liveDegraded = liveWorkflows.filter((w) => w.health === 'degraded').length;
  const liveHealthy = liveWorkflows.filter((w) => w.health === 'healthy').length;
  const failingCount = liveWorkflows.length > 0 ? liveFailing : (n8nTotals?.failedTriggers ?? 0);

  // Combined success rate: weighted by event volume across all three tools.
  //   N8N success = triggers - failedTriggers
  //   FIN success = finResolved (autonomously resolved)
  //   EL  success = calls - calls*transferRate/100 (deflected, not transferred)
  const n8nEvents = n8nTotals?.totalTriggers ?? 0;
  const n8nGood   = Math.max(0, n8nEvents - (n8nTotals?.failedTriggers ?? 0));
  const finEvents = finTotals?.finInvolvement ?? 0;
  const finGood   = finTotals?.finResolved ?? 0;
  const elEvents  = elTotals?.calls ?? 0;
  const elGood    = elEvents > 0 && elTotals
    ? Math.max(0, Math.round(elEvents * (1 - (elTotals.transferRate / 100))))
    : 0;
  const combinedEvents = n8nEvents + finEvents + elEvents;
  const combinedGood   = n8nGood + finGood + elGood;
  const successRate = combinedEvents > 0
    ? Math.round((combinedGood / combinedEvents) * 100)
    : null;

  const norm = (s: string) => s.toLowerCase().trim();
  const backlogProjects    = projects.filter((p) => norm(p.status) === 'to do');
  const scopingProjects    = projects.filter((p) => norm(p.status) === 'planning / scoping');
  const inProgressProjects = projects.filter((p) => norm(p.status) === 'in progress');
  const completedProjects  = projects.filter((p) => norm(p.status) === 'complete');
  const highUrgentInProg   = inProgressProjects.filter((p) => p.priority === 'high' || p.priority === 'urgent');

  // ── Combined chart: merge N8N + FIN + ElevenLabs buckets by label ──────────
  // All three sources produce the same period-aligned labels (day/week/month),
  // so we align them by label index. Each platform contributes:
  //   success = events it handled correctly
  //   error   = events that failed / escalated
  //     N8N : totalTriggers / failedTriggers
  //     FIN : finResolved as success, (finInvolvement - finResolved) as error
  //     11L : deflected calls as success, transferred calls as error
  const chartLabels = (n8nBuckets.length > 0 ? n8nBuckets : finBuckets.length > 0 ? finBuckets : elBuckets)
    .map((b) => b.label ?? b.weekLabel);

  const chartData: ChartPoint[] = chartLabels.map((label, i) => {
    const n = n8nBuckets[i];
    const f = finBuckets[i];
    const e = elBuckets[i];

    const n8nSuccess = n ? Math.max(0, (n.totalTriggers ?? 0) - (n.failedTriggers ?? 0)) : 0;
    const n8nErr     = n?.failedTriggers ?? 0;

    const finInv  = f?.finInvolvement ?? 0;
    const finRes  = f?.finResolved ?? 0;
    const finSuccess = Math.max(0, finRes);
    const finErr     = Math.max(0, finInv - finRes);

    const elCalls    = e?.calls ?? 0;
    const elXferRate = (e?.transferRate ?? 0) / 100;
    const elErr     = Math.round(elCalls * elXferRate);
    const elSuccess = Math.max(0, elCalls - elErr);

    return {
      label,
      success: n8nSuccess + finSuccess + elSuccess,
      error: n8nErr + finErr + elErr,
    };
  });

  const recs = buildRecs(n8nTotals, finTotals, elTotals, projects, periodLabelFor(period));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PeriodTabs active={period} onChange={setPeriod} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            title="Build marker — confirms browser is on the latest bundle"
            style={{
              fontSize: '0.6rem', color: '#6a8870', letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4,
              background: 'rgba(61,186,98,0.08)', border: '1px solid rgba(61,186,98,0.25)',
            }}
          >
            Build v3 · {loading ? '…' : `${projects.length} tasks · ${period}`}
          </span>
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
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

        <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="Performance Overview" />

        {/* Progress — combined success rate across N8N, FIN, and ElevenLabs */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <ProgressMetric
            label={`OVERALL AUTOMATION SUCCESS RATE · ${periodLabelFor(period).toUpperCase()}`}
            value={loading || successRate == null ? 0 : successRate}
          />
          {!loading && combinedEvents > 0 && (
            <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8, letterSpacing: '0.02em' }}>
              {combinedGood.toLocaleString()} successful / {combinedEvents.toLocaleString()} total · N8N {n8nGood}/{n8nEvents}, FIN {finGood}/{finEvents}, 11L {elGood}/{elEvents}
            </p>
          )}
          {!loading && combinedEvents === 0 && (
            <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8 }}>
              No activity recorded in the selected period.
            </p>
          )}
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
            value={loading ? '—' : totalActive}
            showInfo
            subBadge={
              <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <span>{n8nActive} N8N</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>{finActive} FIN</span>
                <span style={{ opacity: 0.5 }}>·</span>
                <span>{elActive} 11L</span>
                {liveWorkflows.length > 0 && (
                  <>
                    <span style={{ opacity: 0.5, marginLeft: 2 }}>·</span>
                    <StatusDot color="#3dba62" /><span>{liveHealthy}</span>
                    <StatusDot color="#d4912a" /><span>{liveDegraded}</span>
                    <StatusDot color="#e05858" /><span style={{ color: liveFailing > 0 ? '#e05858' : undefined }}>{liveFailing}</span>
                  </>
                )}
                {liveWorkflows.length === 0 && failingCount > 0 && (
                  <>
                    <span style={{ opacity: 0.5 }}>·</span>
                    <StatusDot color="#e05858" /><span style={{ color: '#e05858' }}>{failingCount} Failing</span>
                  </>
                )}
              </span>
            }
          />
        </div>

        {/* Combined chart — N8N + FIN + ElevenLabs success vs errors */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 28 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            All Platforms — Success vs Errors · N8N + FIN + ElevenLabs
          </p>
          <SuccessChart data={chartData} />
        </div>

        {/* Section 2 */}
        <SectionHeader eyebrow="2. KEY METRICS" title="Objectives and Key Performance" />

        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>

          {/* Row 1 — Project tracking */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', borderBottom: '1px solid #1a2c1d', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 10 }}>AI Projects Initiative Tracking</p>

              {/* Status pill row */}
              {!loading && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {[
                    { label: 'Backlog', count: backlogProjects.length, color: '#6a8870' },
                    { label: 'Scoping', count: scopingProjects.length, color: '#4a9eca' },
                    { label: 'In Progress', count: inProgressProjects.length, color: '#d4912a' },
                    { label: 'Done', count: completedProjects.length, color: '#3dba62' },
                  ].map(({ label, count, color }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 4, background: `${color}14`, border: `1px solid ${color}40` }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: '0.7rem', color, fontWeight: 600 }}>{label}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e4ede6' }}>{count}</span>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                {loading ? 'Loading…' : recs.tracking}
              </p>

              {/* High/urgent in-progress task chips */}
              {!loading && highUrgentInProg.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {highUrgentInProg.slice(0, 4).map((p) => (
                    <a
                      key={p.id}
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 4, background: 'rgba(212,145,42,0.12)', border: '1px solid rgba(212,145,42,0.3)', color: '#d4912a', textDecoration: 'none', cursor: 'pointer' }}
                    >
                      {p.name.length > 42 ? p.name.slice(0, 42) + '…' : p.name}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* Right: High/urgent in-progress count */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              {loading ? (
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e4ede6' }}>—</span>
              ) : (
                <>
                  <span style={{ fontSize: '2rem', fontWeight: 700, color: highUrgentInProg.length > 0 ? '#d4912a' : '#3dba62' }}>
                    {highUrgentInProg.length}
                  </span>
                  <span style={{ fontSize: '0.65rem', color: '#6a8870', textAlign: 'right', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    High Priority<br />In Progress
                  </span>
                </>
              )}
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
