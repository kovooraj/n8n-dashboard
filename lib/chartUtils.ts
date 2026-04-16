import type { ChartPoint, VolumePoint } from './types';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Extracts a short readable date label from weekLabel.
 * "Week 16 · Apr 10–16, 2026" → "Apr 10–16"
 * Falls back to "W16" or "W{i+1}" if parsing fails.
 */
function shortDateLabel(weekLabel: string, fallback: string): string {
  // Match "Apr 10–16" or "Mar 27 – Apr 2" style after the "·"
  const afterDot = weekLabel.match(/·\s*(.+?)\s*,\s*\d{4}/);
  if (afterDot?.[1]) return afterDot[1].trim();
  // Fallback: try to match just "Apr 10" (first date)
  const dateOnly = weekLabel.match(/([A-Za-z]{3}\s+\d+)/);
  if (dateOnly?.[1]) return dateOnly[1];
  return fallback;
}

/**
 * Given an array of (success, error) snapshots ordered newest→oldest,
 * returns ChartPoints for rendering oldest→newest.
 * If only 1 snapshot, generates 7 synthetic daily points ending at snapshot value.
 * maxPoints defaults to the full array length (use the period-limited slice from the API).
 */
export function buildSuccessChartData(
  snapshots: Array<{ totalTriggers: number; failedTriggers: number; weekLabel: string }>,
  maxPoints?: number
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

/**
 * Similar for volume (total + resolved) charts.
 */
export function buildVolumeChartData(
  snapshots: Array<{ total: number; resolved: number; weekLabel: string }>,
  maxPoints?: number
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
  return `$${value}`;
}

export function formatHours(value: number): string {
  return `${value}h`;
}
