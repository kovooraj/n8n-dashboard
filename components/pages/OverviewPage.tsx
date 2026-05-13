'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { PeriodTabs } from '@/components/PeriodTabs';
import { ProgressMetric } from '@/components/ProgressMetric';
import { BenchKPICard } from '@/components/BenchKPICard';
import { HideCompletedToggle } from '@/components/HideCompletedToggle';
import { ChartSkeleton, KPIGridSkeleton, InlineSkeletonRows } from '@/components/Skeleton';
import { useStaleData } from '@/lib/useStaleData';
import { RefreshCw, FileText, Download, X } from 'lucide-react';
import type { DashboardPeriod, N8NSnapshot, FINSnapshot, ElevenLabsSnapshot, ClickUpTask, ChartPoint, N8NTotals, FINTotals, ElevenLabsTotals, WorkflowHealthData } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';

const SuccessChart = dynamic(
  () => import('@/components/charts/SuccessChart').then((m) => m.SuccessChart),
  { ssr: false, loading: () => <ChartSkeleton height={200} /> }
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

/** Shape returned by /api/insights. Populated by Claude or heuristic fallback. */
interface InsightsResult {
  executive?: string;
  tracking: string;
  roi: string;
  adoption: string;
  source?: 'claude' | 'heuristic';
  reason?: string;
}

/** Shape returned by /api/insights/executive-summary. */
interface ExecutiveSummaryResult {
  executive: string;
  overview: string;
  improvements: string[];
  regressions: string[];
  drivers: string[];
  recommendations: string[];
  currentTotals: { n8n: unknown; fin: unknown; el: unknown };
  previousTotals: { n8n: Record<string, number>; fin: Record<string, number>; el: Record<string, number> };
  currentWindow: { startDate: string; endDate: string };
  previousWindow: { startDate: string; endDate: string };
  period: DashboardPeriod;
  source: 'claude' | 'heuristic';
  reason?: string;
}

// Claude: $1 spend ≈ 1.5 hrs saved (same as AIToolsPage)
const CLAUDE_HOURS_PER_DOLLAR = 1.5;
const HOURLY_RATE = 20; // $20/hr loaded labour rate

interface OverviewPageData {
  n8nBuckets: N8NSnapshot[];
  n8nTotals: N8NTotals | null;
  finBuckets: FINSnapshot[];
  finTotals: FINTotals | null;
  elBuckets: ElevenLabsSnapshot[];
  elTotals: ElevenLabsTotals | null;
  projects: ClickUpTask[];
  liveWorkflows: WorkflowHealthData[];
  claudeSpendUsd: number;
  chatgptTotals: { hoursSaved: number; revenueImpact: number } | null;
}

function periodLabelFor(p: DashboardPeriod): string {
  return p === 'weekly' ? 'week' : p === 'monthly' ? 'month' : p === 'quarterly' ? 'quarter' : 'year';
}

export function OverviewPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // ── Executive summary state (period-over-period AI analysis) ──────────────
  const [summary, setSummary] = useState<ExecutiveSummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // ── Main data — stale-while-revalidate with localStorage cache ───────────
  const { data: pageData, loading, refreshing, stale, refresh } = useStaleData<OverviewPageData>(
    `overview-${period}`,
    async (isRefresh) => {
      const bust = `_t=${Date.now()}`;
      const force = isRefresh ? '&refresh=1' : '';
      const [n8nRes, finRes, elRes, cuRes, dashRes, claudeRes, chatgptRes] = await Promise.allSettled([
        fetch(`/api/notion/n8n?period=${period}&${bust}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/intercom/fin?period=${period}&${bust}${force}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/elevenlabs/calls?period=${period}&${bust}${force}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/clickup/projects?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/dashboard?${bust}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/claude/leaderboard?period=${period}&${bust}${force}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch(`/api/chatgpt/usage?period=${period}&${bust}${force}`, { cache: 'no-store' }).then((r) => r.json()),
      ]);
      const claudeVal  = claudeRes.status  === 'fulfilled' ? claudeRes.value  : null;
      const chatgptVal = chatgptRes.status === 'fulfilled' ? chatgptRes.value : null;
      return {
        n8nBuckets:    n8nRes.status  === 'fulfilled' ? (n8nRes.value.buckets   ?? []) as N8NSnapshot[] : [],
        n8nTotals:     n8nRes.status  === 'fulfilled' ? (n8nRes.value.totals    ?? null) as N8NTotals | null : null,
        finBuckets:    finRes.status  === 'fulfilled' ? (finRes.value.buckets   ?? []) as FINSnapshot[] : [],
        finTotals:     finRes.status  === 'fulfilled' ? (finRes.value.totals    ?? null) as FINTotals | null : null,
        elBuckets:     elRes.status   === 'fulfilled' ? (elRes.value.buckets    ?? []) as ElevenLabsSnapshot[] : [],
        elTotals:      elRes.status   === 'fulfilled' ? (elRes.value.totals     ?? null) as ElevenLabsTotals | null : null,
        projects:      cuRes.status   === 'fulfilled' ? (cuRes.value.tasks      ?? []) as ClickUpTask[] : [],
        liveWorkflows: dashRes.status === 'fulfilled' ? (dashRes.value.workflows ?? []) as WorkflowHealthData[] : [],
        // AI tools — graceful: if API not configured they return an error field, we default to 0
        claudeSpendUsd: !claudeVal?.error ? (claudeVal?.totals?.spendUsd ?? 0) : 0,
        chatgptTotals:  !chatgptVal?.error ? (chatgptVal?.totals ?? null) : null,
      };
    },
    [period],
  );

  const n8nBuckets    = pageData?.n8nBuckets    ?? [];
  const n8nTotals     = pageData?.n8nTotals     ?? null;
  const finBuckets    = pageData?.finBuckets    ?? [];
  const finTotals     = pageData?.finTotals     ?? null;
  const elBuckets     = pageData?.elBuckets     ?? [];
  const elTotals      = pageData?.elTotals      ?? null;
  const projects      = pageData?.projects      ?? [];
  const liveWorkflows = pageData?.liveWorkflows ?? [];

  // ── AI tools hours/revenue (Claude + ChatGPT) ─────────────────
  const claudeHours   = (pageData?.claudeSpendUsd ?? 0) * CLAUDE_HOURS_PER_DOLLAR;
  const claudeRevenue = claudeHours * HOURLY_RATE;
  const chatgptHours  = pageData?.chatgptTotals?.hoursSaved   ?? 0;
  const chatgptRevenue = pageData?.chatgptTotals?.revenueImpact ?? 0;

  // ── Combined totals for the selected period ──────────────────
  const totalTriggers =
    (n8nTotals?.totalTriggers ?? 0) +
    (finTotals?.finInvolvement ?? 0) +
    (elTotals?.calls ?? 0);

  const totalHours   = (n8nTotals?.hoursSaved ?? 0) + (finTotals?.hoursSaved ?? 0) + (elTotals?.hoursSaved ?? 0) + claudeHours + chatgptHours;
  const totalRevenue = (n8nTotals?.revenueImpact ?? 0) + (finTotals?.revenueImpact ?? 0) + (elTotals?.revenueImpact ?? 0) + claudeRevenue + chatgptRevenue;

  const liveN8nActive  = liveWorkflows.length;
  const n8nActive      = liveN8nActive > 0 ? liveN8nActive : (n8nTotals?.activeWorkflows ?? 0);
  const finActive      = finTotals?.activeFinProcedures ?? 0;
  const elActive       = elTotals?.agents ?? 0;
  const totalActive    = n8nActive + finActive + elActive;
  const liveFailing    = liveWorkflows.filter((w) => w.health === 'failing').length;
  const liveDegraded   = liveWorkflows.filter((w) => w.health === 'degraded').length;
  const liveHealthy    = liveWorkflows.filter((w) => w.health === 'healthy').length;
  const failingCount   = liveWorkflows.length > 0 ? liveFailing : (n8nTotals?.failedTriggers ?? 0);

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
  const visibleProjects = hideCompleted
    ? projects.filter((p) => norm(p.status) !== 'complete')
    : projects;
  const backlogProjects    = visibleProjects.filter((p) => norm(p.status) === 'to do');
  const scopingProjects    = visibleProjects.filter((p) => norm(p.status) === 'planning / scoping');
  const inProgressProjects = visibleProjects.filter((p) => norm(p.status) === 'in progress');
  const completedProjects  = projects.filter((p) => norm(p.status) === 'complete');
  const highUrgentInProg   = inProgressProjects.filter((p) => p.priority === 'high' || p.priority === 'urgent');

  // ── Combined chart — aligned by ISO-date id ──────────────────
  const n8nById = new Map(n8nBuckets.map((b) => [b.id, b]));
  const finById = new Map(finBuckets.map((b) => [b.id, b]));
  const elById  = new Map(elBuckets.map((b)  => [b.id, b]));
  const primaryBuckets = (n8nBuckets.length >= finBuckets.length && n8nBuckets.length >= elBuckets.length)
    ? n8nBuckets
    : finBuckets.length >= elBuckets.length ? finBuckets : elBuckets;

  const chartData: ChartPoint[] = primaryBuckets.map((primary) => {
    const n = n8nById.get(primary.id);
    const f = finById.get(primary.id);
    const e = elById.get(primary.id);
    const n8nSuccess = n ? Math.max(0, (n.totalTriggers ?? 0) - (n.failedTriggers ?? 0)) : 0;
    const n8nErr     = n?.failedTriggers ?? 0;
    const finInv     = f?.finInvolvement ?? 0;
    const finRes     = f?.finResolved ?? 0;
    const finSuccess = Math.max(0, finRes);
    const finErr     = Math.max(0, finInv - finRes);
    const elCalls    = e?.calls ?? 0;
    const elXferRate = (e?.transferRate ?? 0) / 100;
    const elErr      = Math.round(elCalls * elXferRate);
    const elSuccess  = Math.max(0, elCalls - elErr);
    return {
      label: primary.label ?? primary.weekLabel,
      success: n8nSuccess + finSuccess + elSuccess,
      error: n8nErr + finErr + elErr,
    };
  });

  // ── AI Insights ───────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    if (!n8nTotals && !finTotals && !elTotals) return;
    const controller = new AbortController();
    setInsightsLoading(true);
    const payload = {
      period,
      n8n: n8nTotals,
      fin: finTotals,
      el: elTotals,
      liveN8n: {
        healthy: liveHealthy,
        degraded: liveDegraded,
        failing: liveFailing,
        failingNames: liveWorkflows.filter((w) => w.health === 'failing').map((w) => w.workflow.name),
      },
      projects: {
        backlog: backlogProjects.length,
        scoping: scopingProjects.length,
        inProgress: inProgressProjects.length,
        complete: completedProjects.length,
        highUrgent: highUrgentInProg.slice(0, 5).map((p) => p.name),
      },
    };
    fetch('/api/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data: InsightsResult) => { setInsights(data); })
      .catch(() => { /* keep last insights on error */ })
      .finally(() => setInsightsLoading(false));
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, loading, n8nTotals, finTotals, elTotals, liveWorkflows.length]);

  // ── Generate executive summary (current vs previous period via Claude) ────
  async function generateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    setShowSummaryModal(true);
    try {
      const resp = await fetch('/api/insights/executive-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          current: { n8n: n8nTotals, fin: finTotals, el: elTotals },
        }),
        cache: 'no-store',
      });
      const data = (await resp.json()) as ExecutiveSummaryResult & { error?: string };
      if (!resp.ok || data.error) throw new Error(data.error ?? `HTTP ${resp.status}`);
      // Defensive: rewrite £/€ → $ in case Claude slips. All underlying values
      // are USD ($20/hr labour rate set in code).
      const fixCurrency = (s: string) => (s ?? '').replace(/£/g, '$').replace(/€/g, '$');
      setSummary({
        ...data,
        executive:       fixCurrency(data.executive),
        overview:        fixCurrency(data.overview),
        improvements:    (data.improvements    ?? []).map(fixCurrency),
        regressions:     (data.regressions     ?? []).map(fixCurrency),
        drivers:         (data.drivers         ?? []).map(fixCurrency),
        recommendations: (data.recommendations ?? []).map(fixCurrency),
      });
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  }

  // ── Download the current summary as a PDF (jsPDF, client-side) ────────────
  // Styled to match the popup modal: dark cards with rounded corners, eyebrow
  // labels in accent colours, side-by-side Improvements/Regressions.
  async function downloadSummaryPDF() {
    if (!summary) return;
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentW = pageW - margin * 2;

    // Helvetica (jsPDF's default font) is Latin-1 only — Unicode arrows / dashes
    // / curly quotes render as garbled `!'` etc. Normalise everything to ASCII
    // before drawing. Also defensively convert £/€ to $ in case Claude slips.
    const safeText = (s: string): string =>
      (s ?? '')
        .replace(/→/g, '->')
        .replace(/←/g, '<-')
        .replace(/·/g, '-')      // U+00B7 middot — NOT the U+2022 bullet glyph
        .replace(/[–—]/g, '-')
        .replace(/['']/g, "'")
        .replace(/[""]/g, '"')
        .replace(/…/g, '...')
        .replace(/£/g, '$')
        .replace(/€/g, '$');

    // Palette mirrors the modal styling
    const PAGE_BG       = '#0a130c';
    const CARD_BG       = '#0d1810';
    const CARD_BORDER   = '#1a2c1d';
    const HEADLINE_BG   = '#0f1e13'; // slight green tint
    const HEADLINE_BORDER = '#1f4a2a';
    const TEXT_PRIMARY   = '#e4ede6';
    const TEXT_SECONDARY = '#c8d4cc';
    const TEXT_MUTED     = '#6a8870';
    const ACCENT_GREEN   = '#3dba62';
    const ACCENT_RED     = '#e05858';
    const ACCENT_BLUE    = '#4a9eca';

    const periodLabel = periodLabelFor(summary.period);

    // Paint the page background and reset on every new page
    const paintPage = () => {
      doc.setFillColor(PAGE_BG);
      doc.rect(0, 0, pageW, pageH, 'F');
    };
    paintPage();

    let y = margin;

    // ── Header ───────────────────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(TEXT_MUTED);
    doc.text(safeText('AUTOMATION DASHBOARD · EXECUTIVE SUMMARY'), margin, y + 10);
    y += 22;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(TEXT_PRIMARY);
    const title = `${summary.period[0].toUpperCase() + summary.period.slice(1)} comparison`;
    doc.text(safeText(title), margin, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_MUTED);
    doc.text(
      safeText(`${summary.currentWindow.startDate} -> ${summary.currentWindow.endDate}    vs previous ${periodLabel} (${summary.previousWindow.startDate} -> ${summary.previousWindow.endDate})`),
      margin, y,
    );
    y += 12;
    doc.text(
      safeText(`Generated ${new Date().toLocaleString()} - ${summary.source === 'claude' ? 'AI-analysed (Claude)' : 'Heuristic fallback'}`),
      margin, y,
    );
    y += 22;

    // ── Card helpers (match modal sizing) ────────────────────────────────
    const CARD_PADDING_X = 14;
    const CARD_PADDING_Y = 14;
    const EYEBROW_H      = 12;
    const EYEBROW_GAP    = 8;
    const CARD_RADIUS    = 6;
    const SECTION_GAP    = 12;

    function measureParagraph(text: string, width: number, size: number): number {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(safeText(text), width) as string[];
      return lines.length * (size * 1.45);
    }

    function measureBullets(items: string[], width: number, size: number): number {
      doc.setFontSize(size);
      const lineH = size * 1.45;
      let total = 0;
      for (const item of items) {
        const lines = doc.splitTextToSize(safeText(item), width - 12) as string[];
        total += lines.length * lineH + 3; // small inter-bullet gap
      }
      return Math.max(0, total - 3); // trim trailing gap
    }

    function ensureSpace(needed: number) {
      if (y + needed > pageH - margin) {
        doc.addPage();
        paintPage();
        y = margin;
      }
    }

    function drawCard(
      x: number, yTop: number, w: number, h: number,
      bg: string = CARD_BG, border: string = CARD_BORDER,
    ) {
      doc.setFillColor(bg);
      doc.setDrawColor(border);
      doc.setLineWidth(0.6);
      doc.roundedRect(x, yTop, w, h, CARD_RADIUS, CARD_RADIUS, 'FD');
    }

    function drawEyebrow(text: string, x: number, yTop: number, color: string) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(color);
      doc.text(safeText(text).toUpperCase(), x, yTop + 8); // baseline ~8pt below box top
    }

    function drawParagraph(text: string, x: number, yTop: number, width: number, size: number, color: string) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
      doc.setTextColor(color);
      const lines = doc.splitTextToSize(safeText(text), width) as string[];
      const lineH = size * 1.45;
      lines.forEach((line, i) => doc.text(line, x, yTop + (i + 1) * lineH - 2));
    }

    function drawBullets(items: string[], x: number, yTop: number, width: number, size: number) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
      const lineH = size * 1.45;
      let cursor = yTop;
      for (const item of items) {
        const lines = doc.splitTextToSize(safeText(item), width - 12) as string[];
        // bullet glyph in green (matches modal) — U+2022 IS supported by Helvetica
        doc.setTextColor(ACCENT_GREEN);
        doc.text('•', x, cursor + lineH - 2);
        doc.setTextColor(TEXT_SECONDARY);
        lines.forEach((line, i) => doc.text(line, x + 12, cursor + lineH - 2 + i * lineH));
        cursor += lines.length * lineH + 3;
      }
    }

    function renderParagraphCard(eyebrow: string, eyebrowColor: string, text: string) {
      const innerW = contentW - CARD_PADDING_X * 2;
      const contentH = measureParagraph(text, innerW, 10);
      const cardH = CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP + contentH + CARD_PADDING_Y;
      ensureSpace(cardH + SECTION_GAP);
      drawCard(margin, y, contentW, cardH);
      drawEyebrow(eyebrow, margin + CARD_PADDING_X, y + CARD_PADDING_Y, eyebrowColor);
      drawParagraph(
        text,
        margin + CARD_PADDING_X,
        y + CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP - 2,
        innerW, 10, TEXT_SECONDARY,
      );
      y += cardH + SECTION_GAP;
    }

    function renderBulletsCard(eyebrow: string, eyebrowColor: string, items: string[]) {
      const innerW = contentW - CARD_PADDING_X * 2;
      const contentH = measureBullets(items, innerW, 10);
      const cardH = CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP + contentH + CARD_PADDING_Y;
      ensureSpace(cardH + SECTION_GAP);
      drawCard(margin, y, contentW, cardH);
      drawEyebrow(eyebrow, margin + CARD_PADDING_X, y + CARD_PADDING_Y, eyebrowColor);
      drawBullets(items, margin + CARD_PADDING_X, y + CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP - 2, innerW, 10);
      y += cardH + SECTION_GAP;
    }

    // ── HEADLINE (green-tinted card) ─────────────────────────────────────
    {
      const innerW = contentW - CARD_PADDING_X * 2;
      const contentH = measureParagraph(summary.executive, innerW, 12);
      const cardH = CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP + contentH + CARD_PADDING_Y;
      ensureSpace(cardH + SECTION_GAP);
      drawCard(margin, y, contentW, cardH, HEADLINE_BG, HEADLINE_BORDER);
      drawEyebrow('HEADLINE', margin + CARD_PADDING_X, y + CARD_PADDING_Y, ACCENT_GREEN);
      drawParagraph(
        summary.executive,
        margin + CARD_PADDING_X,
        y + CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP - 2,
        innerW, 12, TEXT_PRIMARY,
      );
      y += cardH + SECTION_GAP;
    }

    // ── Overview ─────────────────────────────────────────────────────────
    renderParagraphCard('Period-over-Period Overview', TEXT_MUTED, summary.overview);

    // ── Improvements + Regressions side-by-side (matches grid 1fr 1fr) ───
    if (summary.improvements.length > 0 || summary.regressions.length > 0) {
      const colGap = 10;
      const colW = (contentW - colGap) / 2;
      const innerColW = colW - CARD_PADDING_X * 2;

      const leftItems  = summary.improvements;
      const rightItems = summary.regressions;
      const leftH  = leftItems.length  ? measureBullets(leftItems,  innerColW, 10) : 0;
      const rightH = rightItems.length ? measureBullets(rightItems, innerColW, 10) : 0;
      const maxContentH = Math.max(leftH, rightH);
      const cardH = CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP + maxContentH + CARD_PADDING_Y;

      ensureSpace(cardH + SECTION_GAP);

      if (leftItems.length > 0) {
        drawCard(margin, y, colW, cardH);
        drawEyebrow('What Improved', margin + CARD_PADDING_X, y + CARD_PADDING_Y, ACCENT_GREEN);
        drawBullets(
          leftItems,
          margin + CARD_PADDING_X,
          y + CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP - 2,
          innerColW, 10,
        );
      }
      if (rightItems.length > 0) {
        const rx = margin + colW + colGap;
        drawCard(rx, y, colW, cardH);
        drawEyebrow('What Regressed', rx + CARD_PADDING_X, y + CARD_PADDING_Y, ACCENT_RED);
        drawBullets(
          rightItems,
          rx + CARD_PADDING_X,
          y + CARD_PADDING_Y + EYEBROW_H + EYEBROW_GAP - 2,
          innerColW, 10,
        );
      }
      y += cardH + SECTION_GAP;
    }

    // ── Drivers ──────────────────────────────────────────────────────────
    if (summary.drivers.length > 0) {
      renderBulletsCard('Possible Drivers', TEXT_MUTED, summary.drivers);
    }

    // ── Recommendations (blue accent) ────────────────────────────────────
    if (summary.recommendations.length > 0) {
      renderBulletsCard('Recommended Next Actions', ACCENT_BLUE, summary.recommendations);
    }

    const filename = `executive-summary-${summary.period}-${summary.currentWindow.startDate}.pdf`;
    doc.save(filename);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <PeriodTabs active={period} onChange={setPeriod} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {stale && !loading && (
            <span style={{
              fontSize: '0.6rem', color: '#d4912a', letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4,
              background: 'rgba(212,145,42,0.08)', border: '1px solid rgba(212,145,42,0.25)',
            }}>
              Updating…
            </span>
          )}
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
            onClick={generateSummary}
            disabled={loading || summaryLoading}
            title={`Analyse current ${periodLabelFor(period)} vs previous ${periodLabelFor(period)} and produce a downloadable PDF summary.`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: summaryLoading ? 'rgba(61,186,98,0.10)' : 'rgba(61,186,98,0.05)',
              border: '1px solid rgba(61,186,98,0.35)', borderRadius: 6, padding: '5px 10px',
              cursor: (loading || summaryLoading) ? 'not-allowed' : 'pointer', color: '#3dba62',
              fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em',
              textTransform: 'uppercase', opacity: (loading || summaryLoading) ? 0.6 : 1,
            }}
          >
            <FileText size={11} color="#3dba62" />
            {summaryLoading ? 'Analysing…' : 'Executive Summary'}
          </button>
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
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

        <SectionHeader eyebrow="1. OVERALL PERFORMANCE" title="Performance Overview" />

        {/* Progress — combined success rate */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 16 }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <InlineSkeletonRows rows={2} />
            </div>
          ) : (
            <>
              <ProgressMetric
                label={`OVERALL AUTOMATION SUCCESS RATE · ${periodLabelFor(period).toUpperCase()}`}
                value={successRate == null ? 0 : successRate}
              />
              {combinedEvents > 0 && (
                <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8, letterSpacing: '0.02em' }}>
                  {combinedGood.toLocaleString()} successful / {combinedEvents.toLocaleString()} total · N8N {n8nGood}/{n8nEvents}, FIN {finGood}/{finEvents}, 11L {elGood}/{elEvents}
                </p>
              )}
              {combinedEvents === 0 && (
                <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 8 }}>
                  No activity recorded in the selected period.
                </p>
              )}
            </>
          )}
        </div>

        {/* KPI cards */}
        {loading ? (
          <div style={{ marginBottom: 20 }}>
            <KPIGridSkeleton count={4} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            <BenchKPICard
              label="Total Automation Triggers"
              value={totalTriggers.toLocaleString()}
              showInfo
              tooltip={`Sum of events handled across all three platforms in the selected ${periodLabelFor(period)}.`}
              subBadge={<span style={{ fontSize: '0.65rem', color: '#6a8870' }}>N8N · FIN · Calls</span>}
            />
            <BenchKPICard
              label="Estimated Hours Saved"
              value={formatHours(totalHours)}
              showInfo
              tooltip={`Hours saved across all platforms for the selected ${periodLabelFor(period)}. N8N: successful executions × 10 min / 60. FIN: FIN-resolved conversations × 5 min / 60. ElevenLabs: AI-handled calls × avg call duration / 3600. Claude: spend × $${CLAUDE_HOURS_PER_DOLLAR} hrs/$. ChatGPT: messages ÷ 15 msgs/hr.`}
              subBadge={<span style={{ fontSize: '0.65rem', color: '#6a8870' }}>N8N · FIN · Calls · Claude · ChatGPT</span>}
            />
            <BenchKPICard
              label="Estimated Cost Savings Impact"
              value={formatCurrency(totalRevenue)}
              showInfo
              tooltip={`Estimated cost savings — labour cost avoided based on total hours saved × $${HOURLY_RATE}/hr loaded labour rate. Includes N8N, FIN, ElevenLabs, Claude, and ChatGPT for the selected ${periodLabelFor(period)}.`}
              subBadge={<span style={{ fontSize: '0.65rem', color: '#6a8870' }}>N8N · FIN · Calls · Claude · ChatGPT</span>}
            />
            <BenchKPICard
              label="Automation Active"
              value={totalActive}
              showInfo
              tooltip={`Live count of active automations right now.`}
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
        )}

        {/* Combined chart */}
        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 16, marginBottom: 28 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 12 }}>
            All Platforms — Success vs Errors · N8N + FIN + ElevenLabs
          </p>
          <SuccessChart data={chartData} loading={loading} />
        </div>

        {/* Section 2 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <SectionHeader eyebrow="2. KEY METRICS" title="Objectives and Key Performance" />
          <span
            style={{
              fontSize: '0.6rem', color: insights?.source === 'claude' ? '#3dba62' : '#6a8870',
              letterSpacing: '0.1em', textTransform: 'uppercase', padding: '3px 8px',
              borderRadius: 4, background: insights?.source === 'claude' ? 'rgba(61,186,98,0.1)' : 'rgba(106,136,112,0.08)',
              border: `1px solid ${insights?.source === 'claude' ? 'rgba(61,186,98,0.3)' : 'rgba(106,136,112,0.25)'}`,
              marginBottom: 20,
            }}
            title={insights?.reason ?? (insights?.source === 'claude' ? 'Analysed by Claude Sonnet 4.5' : 'Heuristic fallback — set ANTHROPIC_API_KEY to enable AI insights')}
          >
            {insightsLoading ? 'Analysing…' : insights?.source === 'claude' ? 'AI-analysed · Claude' : 'Heuristic'}
          </span>
        </div>

        {/* Executive summary */}
        {!loading && insights?.executive && (
          <div style={{
            background: 'rgba(61,186,98,0.05)', border: '1px solid rgba(61,186,98,0.25)',
            borderRadius: 8, padding: '12px 16px', marginBottom: 14,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{
              fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
              color: '#3dba62', flexShrink: 0, marginTop: 2, padding: '2px 6px',
              background: 'rgba(61,186,98,0.12)', borderRadius: 3,
            }}>
              TL;DR
            </span>
            <p style={{ fontSize: '0.9rem', color: '#e4ede6', lineHeight: 1.5, margin: 0, fontWeight: 500 }}>
              {insights.executive}
            </p>
          </div>
        )}

        <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>

          {/* Row 1 — Project tracking */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', borderBottom: '1px solid #1a2c1d', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', margin: 0 }}>AI Projects Initiative Tracking</p>
                <HideCompletedToggle
                  checked={hideCompleted}
                  onChange={setHideCompleted}
                  count={completedProjects.length}
                />
              </div>

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

              {loading ? (
                <InlineSkeletonRows rows={3} />
              ) : (
                <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                  {insightsLoading && !insights ? 'Analysing…' : insights?.tracking ?? '—'}
                </p>
              )}

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

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <div className="skeleton" style={{ height: 40, width: 40, borderRadius: 6 }} />
                  <div className="skeleton" style={{ height: 10, width: 60, borderRadius: 4 }} />
                </div>
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
              {loading ? <InlineSkeletonRows rows={2} /> : (
                <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                  {insightsLoading && !insights ? 'Analysing…' : insights?.roi ?? '—'}
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Est. Hours Saved</p>
                {loading
                  ? <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 4 }} />
                  : <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{formatHours(totalHours)}</p>
                }
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Est. Cost Savings</p>
                {loading
                  ? <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 4 }} />
                  : <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{formatCurrency(totalRevenue)}</p>
                }
              </div>
            </div>
          </div>

          {/* Row 3 — Adoption */}
          <div style={{ display: 'flex', alignItems: 'flex-start', padding: '20px 20px', gap: 20 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#e4ede6', marginBottom: 8 }}>Adoption</p>
              {loading ? <InlineSkeletonRows rows={2} /> : (
                <p style={{ fontSize: '0.875rem', color: '#8aad90', lineHeight: 1.7 }}>
                  {insightsLoading && !insights ? 'Analysing…' : insights?.adoption ?? '—'}
                </p>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>Total Triggers</p>
              {loading
                ? <div className="skeleton" style={{ height: 22, width: 80, borderRadius: 4 }} />
                : <p style={{ fontSize: '1.3rem', fontWeight: 700, color: '#e4ede6' }}>{totalTriggers.toLocaleString()}</p>
              }
            </div>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>

      {/* ── Executive Summary modal ─────────────────────────────────────── */}
      {showSummaryModal && (
        <div
          onClick={() => !summaryLoading && setShowSummaryModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0a130c', border: '1px solid #1a2c1d', borderRadius: 10,
              maxWidth: 880, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 24px', borderBottom: '1px solid #1a2c1d',
            }}>
              <div>
                <p className="section-eyebrow" style={{ marginBottom: 4 }}>Executive Summary</p>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
                  {summary
                    ? `${summary.period[0].toUpperCase() + summary.period.slice(1)} comparison · ${summary.currentWindow.startDate} → ${summary.currentWindow.endDate}`
                    : `Analysing the current ${periodLabelFor(period)}…`}
                </h2>
                {summary && (
                  <p style={{ fontSize: '0.7rem', color: '#6a8870', margin: '4px 0 0 0' }}>
                    vs previous {periodLabelFor(summary.period)} ({summary.previousWindow.startDate} → {summary.previousWindow.endDate})
                    {' · '}
                    {summary.source === 'claude' ? 'AI-analysed (Claude)' : 'Heuristic fallback'}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {summary && (
                  <button
                    onClick={downloadSummaryPDF}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      background: 'rgba(61,186,98,0.10)',
                      border: '1px solid rgba(61,186,98,0.35)', borderRadius: 6, padding: '6px 12px',
                      cursor: 'pointer', color: '#3dba62',
                      fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}
                  >
                    <Download size={12} /> Download PDF
                  </button>
                )}
                <button
                  onClick={() => !summaryLoading && setShowSummaryModal(false)}
                  disabled={summaryLoading}
                  style={{
                    background: 'transparent', border: '1px solid #1a2c1d', borderRadius: 6,
                    padding: 6, cursor: summaryLoading ? 'not-allowed' : 'pointer',
                    color: '#6a8870', display: 'flex', opacity: summaryLoading ? 0.4 : 1,
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">
              {summaryLoading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#6a8870' }}>
                  <RefreshCw size={20} className="animate-spin" style={{ margin: '0 auto 12px' }} />
                  <p style={{ fontSize: '0.85rem' }}>
                    Comparing current {periodLabelFor(period)} with previous {periodLabelFor(period)} via Claude…
                  </p>
                </div>
              )}

              {summaryError && !summaryLoading && (
                <div style={{
                  background: 'rgba(224,88,88,0.08)', border: '1px solid rgba(224,88,88,0.25)',
                  borderRadius: 6, padding: 16, color: '#e05858',
                }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>Could not generate summary</p>
                  <p style={{ fontSize: '0.75rem' }}>{summaryError}</p>
                </div>
              )}

              {summary && !summaryLoading && !summaryError && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  {/* Headline */}
                  <div style={{
                    background: 'rgba(61,186,98,0.05)', border: '1px solid rgba(61,186,98,0.25)',
                    borderRadius: 8, padding: 16,
                  }}>
                    <p className="section-eyebrow" style={{ marginBottom: 6, color: '#3dba62' }}>HEADLINE</p>
                    <p style={{ fontSize: '1.05rem', color: '#e4ede6', fontWeight: 500, margin: 0, lineHeight: 1.45 }}>
                      {summary.executive}
                    </p>
                  </div>

                  {/* Overview */}
                  <SummarySection title="Period-over-Period Overview">
                    <p style={{ fontSize: '0.85rem', color: '#c8d4cc', lineHeight: 1.55, margin: 0 }}>{summary.overview}</p>
                  </SummarySection>

                  {/* Improvements + Regressions side-by-side */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {summary.improvements.length > 0 && (
                      <SummarySection title="What Improved" accent="#3dba62">
                        <SummaryBullets items={summary.improvements} />
                      </SummarySection>
                    )}
                    {summary.regressions.length > 0 && (
                      <SummarySection title="What Regressed" accent="#e05858">
                        <SummaryBullets items={summary.regressions} />
                      </SummarySection>
                    )}
                  </div>

                  {/* Drivers */}
                  {summary.drivers.length > 0 && (
                    <SummarySection title="Possible Drivers">
                      <SummaryBullets items={summary.drivers} />
                    </SummarySection>
                  )}

                  {/* Recommendations */}
                  {summary.recommendations.length > 0 && (
                    <SummarySection title="Recommended Next Actions" accent="#4a9eca">
                      <SummaryBullets items={summary.recommendations} />
                    </SummarySection>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummarySection({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: 14 }}>
      <p className="section-eyebrow" style={{ marginBottom: 8, color: accent ?? '#6a8870' }}>{title}</p>
      {children}
    </div>
  );
}

function SummaryBullets({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ fontSize: '0.82rem', color: '#c8d4cc', lineHeight: 1.5, paddingLeft: 14, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, color: '#3dba62' }}>•</span>
          {item}
        </li>
      ))}
    </ul>
  );
}
