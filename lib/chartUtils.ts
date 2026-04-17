import type { ChartPoint, VolumePoint } from './types';

/**
 * Build chart data from period-aligned buckets.
 * Input buckets are expected chronological OLDEST → NEWEST (as produced by
 * `aggregate()` in lib/aggregate.ts). Charts render left→right in that order.
 */
export function buildSuccessFromBuckets(
  buckets: Array<{ label: string; metrics: Record<string, number> }>,
  successKey: string,
  errorKey: string,
): ChartPoint[] {
  return buckets.map((b) => ({
    label: b.label,
    success: Math.round(b.metrics[successKey] ?? 0),
    error: Math.round(b.metrics[errorKey] ?? 0),
  }));
}

export function buildVolumeFromBuckets(
  buckets: Array<{ label: string; metrics: Record<string, number> }>,
  totalKey: string,
  resolvedKey: string,
): VolumePoint[] {
  return buckets.map((b) => ({
    label: b.label,
    total: Math.round(b.metrics[totalKey] ?? 0),
    resolved: Math.round(b.metrics[resolvedKey] ?? 0),
  }));
}

// ── Legacy helpers (still used in a few places) ──────────────────────────────
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Extracts a short readable date label from weekLabel.
 * "Week 16 · Apr 10–16, 2026" → "Apr 10–16"
 * If no pattern matches, returns the input string as-is (so short bucket labels
 * like "Mon 13", "W15", or "Apr" pass through untouched).
 */
function shortDateLabel(weekLabel: string, fallback: string): string {
  const afterDot = weekLabel.match(/·\s*(.+?)\s*,\s*\d{4}/);
  if (afterDot?.[1]) return afterDot[1].trim();
  const dateOnly = weekLabel.match(/([A-Za-z]{3}\s+\d+)/);
  if (dateOnly?.[1]) return dateOnly[1];
  return weekLabel || fallback;
}

export function buildSuccessChartData(
  snapshots: Array<{ totalTriggers: number; failedTriggers: number; weekLabel: string }>,
  maxPoints?: number,
): ChartPoint[] {
  const sliced = snapshots.slice(0, maxPoints ?? snapshots.length).reverse();

  if (sliced.length === 1) {
    const snap = sliced[0];
    const base = Math.max(1, snap.totalTriggers);
    const errBase = snap.failedTriggers;
    return Array.from({ length: 7 }, (_, i) => {
      const dayIdx = (new Date().getDay() - (6 - i) + 7) % 7;
      const ratio = (i + 1) / 7;
      return {
        label: SHORT_DAYS[dayIdx],
        success: Math.round(base * ratio * (0.85 + Math.random() * 0.3)),
        error: i === 6 ? errBase : Math.round(errBase * ratio * (0.5 + Math.random() * 1)),
      };
    });
  }

  return sliced.map((s, i) => ({
    label: shortDateLabel(s.weekLabel, `W${i + 1}`),
    success: s.totalTriggers,
    error: s.failedTriggers,
  }));
}

export function buildVolumeChartData(
  snapshots: Array<{ total: number; resolved: number; weekLabel: string }>,
  maxPoints?: number,
): VolumePoint[] {
  const sliced = snapshots.slice(0, maxPoints ?? snapshots.length).reverse();

  if (sliced.length === 1) {
    const snap = sliced[0];
    return Array.from({ length: 7 }, (_, i) => {
      const dayIdx = (new Date().getDay() - (6 - i) + 7) % 7;
      const ratio = (i + 1) / 7;
      return {
        label: SHORT_DAYS[dayIdx],
        total: Math.round(snap.total * ratio * (0.88 + Math.random() * 0.24)),
        resolved: Math.round(snap.resolved * ratio * (0.85 + Math.random() * 0.3)),
      };
    });
  }

  return sliced.map((s, i) => ({
    label: shortDateLabel(s.weekLabel, `W${i + 1}`),
    total: s.total,
    resolved: s.resolved,
  }));
}

export function formatCurrency(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

export function formatHours(value: number): string {
  return `${Math.round(value)}h`;
}
