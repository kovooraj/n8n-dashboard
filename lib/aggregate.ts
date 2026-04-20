/**
 * Period-aware bucketing for dashboard metrics.
 *
 * Given raw snapshots (daily or weekly) and a DashboardPeriod, produces
 * chronologically-ordered buckets suitable for charts + KPI totals.
 *
 * Bucket granularity per period:
 *   weekly     → day   (last 7 days)
 *   monthly    → week  (last ~4 weeks)
 *   quarterly  → month (current fiscal quarter — 3 months)
 *   annually   → month (current fiscal year — up to 12 months starting August)
 *
 * Fiscal year starts in August. Fiscal quarters:
 *   Q1 FY: Aug–Oct
 *   Q2 FY: Nov–Jan
 *   Q3 FY: Feb–Apr
 *   Q4 FY: May–Jul
 */
import type { DashboardPeriod } from './types';

/** Month when the fiscal year starts (0-indexed). August = 7. */
export const FISCAL_YEAR_START_MONTH = 7;

/**
 * Return the start Date (UTC) of the current fiscal year for the given
 * reference date. If the reference month >= August, FY starts this year's Aug;
 * else it started last year's Aug.
 */
export function fiscalYearStart(ref: Date): Date {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth();
  const startYear = m >= FISCAL_YEAR_START_MONTH ? y : y - 1;
  return new Date(Date.UTC(startYear, FISCAL_YEAR_START_MONTH, 1));
}

/**
 * Return the start Date (UTC) of the current fiscal quarter for ref.
 * Fiscal quarters are Aug–Oct, Nov–Jan, Feb–Apr, May–Jul.
 */
export function fiscalQuarterStart(ref: Date): Date {
  const fyStart = fiscalYearStart(ref);
  // How many months into the fiscal year is `ref`?
  let monthsIntoFY = (ref.getUTCFullYear() - fyStart.getUTCFullYear()) * 12
    + (ref.getUTCMonth() - fyStart.getUTCMonth());
  if (monthsIntoFY < 0) monthsIntoFY = 0;
  const quarterIndex = Math.floor(monthsIntoFY / 3); // 0..3
  const startMonthOffset = quarterIndex * 3;
  return new Date(Date.UTC(
    fyStart.getUTCFullYear(),
    fyStart.getUTCMonth() + startMonthOffset,
    1,
  ));
}

export type Granularity = 'day' | 'week' | 'month';
export type SourceGranularity = 'daily' | 'weekly';

export interface RawSnapshot {
  date: string; // ISO yyyy-mm-dd — primary date (day for daily source, week-start for weekly source)
  metrics: Record<string, number | null>;
}

export interface Bucket {
  id: string;
  label: string; // short display label, e.g. 'Mon 13', 'Week 15', 'Apr'
  longLabel: string; // fuller label, e.g. 'Mon Apr 13', 'Week 15 · Apr 6-12', 'Apr 2026'
  start: string; // ISO yyyy-mm-dd
  end: string; // ISO yyyy-mm-dd (inclusive)
  count: number; // how many source rows fed this bucket
  metrics: Record<string, number>; // summed metrics across source rows (NaN-safe = 0)
}

export function periodBucketGranularity(period: DashboardPeriod): Granularity {
  if (period === 'weekly') return 'day';
  if (period === 'monthly') return 'week';
  return 'month'; // quarterly + annually
}

/** Number of buckets expected for a period. */
export function periodBucketCount(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly': return 7;
    case 'monthly': return 4;
    case 'quarterly': return 3;
    case 'annually': return 12;
  }
}

/** Two-digit pad for date parts. */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse a yyyy-mm-dd string to a local Date at midnight UTC. */
function parseISO(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, day || 1));
}

/** Serialize Date → yyyy-mm-dd (UTC). */
function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Start of UTC day for a Date (or today). */
function startOfDay(d?: Date): Date {
  const ref = d ?? new Date();
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
}

/** Start of ISO week (Monday) for a UTC date. */
function startOfISOWeek(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + diff);
  return startOfDay(result);
}

/** Start of month for a UTC date. */
function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** ISO week number for a UTC date (Thursday-centric, per ISO 8601). */
function isoWeekNumber(d: Date): number {
  const target = new Date(d);
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.floor(diff / 7);
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface BucketRange {
  rangeStart: Date; // inclusive
  rangeEnd: Date;   // inclusive (last day of the window)
  buckets: Array<{ id: string; start: Date; end: Date; label: string; longLabel: string }>;
}

/**
 * Build the canonical list of empty buckets spanning the period window,
 * ending at today. We pre-generate buckets so sparse data still produces a
 * contiguous time-series (empty days/weeks/months show as zeros).
 */
export function buildBucketRange(period: DashboardPeriod, now: Date = new Date()): BucketRange {
  const today = startOfDay(now);
  const gran = periodBucketGranularity(period);
  const count = periodBucketCount(period);

  const buckets: BucketRange['buckets'] = [];

  if (gran === 'day') {
    // Last `count` days ending today
    for (let i = count - 1; i >= 0; i--) {
      const day = new Date(today);
      day.setUTCDate(day.getUTCDate() - i);
      const d = startOfDay(day);
      buckets.push({
        id: toISO(d),
        start: d,
        end: d,
        label: `${DOW_SHORT[d.getUTCDay()]} ${d.getUTCDate()}`,
        longLabel: `${DOW_SHORT[d.getUTCDay()]} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`,
      });
    }
  } else if (gran === 'week') {
    // Last `count` ISO weeks ending in the week containing today
    const thisWeekStart = startOfISOWeek(today);
    for (let i = count - 1; i >= 0; i--) {
      const ws = new Date(thisWeekStart);
      ws.setUTCDate(ws.getUTCDate() - i * 7);
      const we = new Date(ws);
      we.setUTCDate(we.getUTCDate() + 6);
      const wn = isoWeekNumber(ws);
      buckets.push({
        id: toISO(ws),
        start: ws,
        end: we,
        label: `W${wn}`,
        longLabel: `Week ${wn} · ${MONTH_SHORT[ws.getUTCMonth()]} ${ws.getUTCDate()}–${we.getUTCDate()}`,
      });
    }
  } else if (period === 'quarterly') {
    // Current fiscal quarter (3 months starting from fiscal Q start)
    const qStart = fiscalQuarterStart(today);
    for (let i = 0; i < 3; i++) {
      const ms = new Date(Date.UTC(qStart.getUTCFullYear(), qStart.getUTCMonth() + i, 1));
      const me = new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth() + 1, 0));
      buckets.push({
        id: `${ms.getUTCFullYear()}-${pad(ms.getUTCMonth() + 1)}`,
        start: ms,
        end: me,
        label: MONTH_SHORT[ms.getUTCMonth()],
        longLabel: `${MONTH_SHORT[ms.getUTCMonth()]} ${ms.getUTCFullYear()}`,
      });
    }
  } else {
    // annually — 12 months of the current fiscal year (Aug → Jul)
    const fyStart = fiscalYearStart(today);
    for (let i = 0; i < 12; i++) {
      const ms = new Date(Date.UTC(fyStart.getUTCFullYear(), fyStart.getUTCMonth() + i, 1));
      const me = new Date(Date.UTC(ms.getUTCFullYear(), ms.getUTCMonth() + 1, 0));
      buckets.push({
        id: `${ms.getUTCFullYear()}-${pad(ms.getUTCMonth() + 1)}`,
        start: ms,
        end: me,
        label: MONTH_SHORT[ms.getUTCMonth()],
        longLabel: `${MONTH_SHORT[ms.getUTCMonth()]} ${ms.getUTCFullYear()}`,
      });
    }
  }

  return {
    rangeStart: buckets[0].start,
    rangeEnd: buckets[buckets.length - 1].end,
    buckets,
  };
}

/**
 * Snap a raw snapshot's date to the bucket it belongs to, based on target granularity.
 */
function bucketKeyFor(snapDate: Date, gran: Granularity): string {
  const d = startOfDay(snapDate);
  if (gran === 'day') return toISO(d);
  if (gran === 'week') return toISO(startOfISOWeek(d));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Aggregate raw snapshots into period-aligned buckets.
 *
 * - `snapshots` can be any chronological mix of daily/weekly rows; each row
 *   will be assigned to exactly one bucket based on its date.
 * - `metricAggregations` controls how each numeric metric is combined across
 *   source rows in the same bucket. Default is 'sum'. Use 'avg' for rates,
 *   'last' for a single-snapshot-wins metric, 'latestDate' to pick the most
 *   recent row's value (useful for things like activeWorkflows).
 */
export function aggregate(
  snapshots: RawSnapshot[],
  period: DashboardPeriod,
  metricAggregations: Record<string, 'sum' | 'avg' | 'last' | 'max' | 'min'> = {},
  now: Date = new Date(),
): { buckets: Bucket[]; granularity: Granularity; totals: Record<string, number> } {
  const range = buildBucketRange(period, now);
  const gran = periodBucketGranularity(period);

  // Index snapshots by their bucket key
  const byKey = new Map<string, RawSnapshot[]>();
  for (const s of snapshots) {
    if (!s.date) continue;
    const d = parseISO(s.date);
    // Only include snapshots within the period window
    if (d < range.rangeStart || d > range.rangeEnd) continue;
    const key = bucketKeyFor(d, gran);
    const arr = byKey.get(key) ?? [];
    arr.push(s);
    byKey.set(key, arr);
  }

  // Collect all metric keys encountered
  const allMetricKeys = new Set<string>();
  for (const s of snapshots) for (const k of Object.keys(s.metrics)) allMetricKeys.add(k);

  const out: Bucket[] = [];
  for (const b of range.buckets) {
    const rows = byKey.get(b.id) ?? [];
    const metrics: Record<string, number> = {};

    for (const key of allMetricKeys) {
      const agg = metricAggregations[key] ?? 'sum';
      const vals = rows
        .map((r) => r.metrics[key])
        .filter((v): v is number => typeof v === 'number' && isFinite(v));
      if (vals.length === 0) { metrics[key] = 0; continue; }
      switch (agg) {
        case 'avg':
          metrics[key] = vals.reduce((a, v) => a + v, 0) / vals.length;
          break;
        case 'last':
          metrics[key] = vals[vals.length - 1];
          break;
        case 'max':
          metrics[key] = Math.max(...vals);
          break;
        case 'min':
          metrics[key] = Math.min(...vals);
          break;
        case 'sum':
        default:
          metrics[key] = vals.reduce((a, v) => a + v, 0);
      }
    }

    out.push({
      id: b.id,
      label: b.label,
      longLabel: b.longLabel,
      start: toISO(b.start),
      end: toISO(b.end),
      count: rows.length,
      metrics,
    });
  }

  // Totals across the whole period window (sum/avg per metric agg rule)
  const totals: Record<string, number> = {};
  for (const key of allMetricKeys) {
    const agg = metricAggregations[key] ?? 'sum';
    const vals = out
      .filter((b) => b.count > 0) // only buckets with actual data
      .map((b) => b.metrics[key])
      .filter((v): v is number => typeof v === 'number' && isFinite(v));
    if (vals.length === 0) { totals[key] = 0; continue; }
    if (agg === 'avg') totals[key] = vals.reduce((a, v) => a + v, 0) / vals.length;
    else if (agg === 'last') totals[key] = vals[vals.length - 1];
    else if (agg === 'max') totals[key] = Math.max(...vals);
    else if (agg === 'min') totals[key] = Math.min(...vals);
    else totals[key] = vals.reduce((a, v) => a + v, 0);
  }

  return { buckets: out, granularity: gran, totals };
}
