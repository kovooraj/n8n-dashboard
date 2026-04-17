import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '344bc9ab-b211-8078-848d-e21dfb052948';

const AGG_RULES = {
  finInvolvement: 'sum',
  finResolved: 'sum',
  finAutomationRate: 'avg',
  csat: 'avg',
  finProcedureUses: 'sum',
  activeFinProcedures: 'last',
  hoursSaved: 'sum',
  revenueImpact: 'sum',
} as const;

function mockSnapshots(now: Date = new Date()): RawSnapshot[] {
  const out: RawSnapshot[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({
      date: iso,
      metrics: {
        finInvolvement: 200 + (i % 7) * 30,
        finResolved: 60 + (i % 7) * 10,
        finAutomationRate: 28 + (i % 5),
        csat: 78 + (i % 4),
        finProcedureUses: 15 + (i % 5),
        activeFinProcedures: 12,
        hoursSaved: 10 + (i % 3),
        revenueImpact: 50 + (i % 3) * 10,
      },
    });
  }
  return out;
}

interface BucketPayload {
  id: string;
  weekLabel: string;
  label: string;
  start: string;
  end: string;
  count: number;
  finInvolvement: number;
  finResolved: number;
  finAutomationRate: number;
  csat: number;
  finProcedureUses: number;
  activeFinProcedures: number;
  hoursSaved: number;
  revenueImpact: number;
}

function payloadFromBuckets(buckets: Bucket[]): BucketPayload[] {
  return buckets.map((b) => ({
    id: b.id,
    weekLabel: b.longLabel,
    label: b.label,
    start: b.start,
    end: b.end,
    count: b.count,
    finInvolvement: Math.round(b.metrics.finInvolvement ?? 0),
    finResolved: Math.round(b.metrics.finResolved ?? 0),
    finAutomationRate: Number((b.metrics.finAutomationRate ?? 0).toFixed(1)),
    csat: Number((b.metrics.csat ?? 0).toFixed(1)),
    finProcedureUses: Math.round(b.metrics.finProcedureUses ?? 0),
    activeFinProcedures: Math.round(b.metrics.activeFinProcedures ?? 0),
    hoursSaved: b.metrics.hoursSaved ?? 0,
    revenueImpact: b.metrics.revenueImpact ?? 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;
  const now = new Date();

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const raw = mockSnapshots(now);
    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, true);
  }

  try {
    const { queryDatabase, getNumber, getFormula, getDate } = await import('@/lib/notion');
    const rows = await queryDatabase(
      DB_ID,
      undefined,
      [{ property: 'Week Start Date', direction: 'descending' }],
    );

    const raw: RawSnapshot[] = rows
      .map((row) => {
        const date = getDate(row, 'Week Start Date');
        if (!date) return null;
        return {
          date,
          metrics: {
            finInvolvement: getNumber(row, 'Fin Involvement'),
            finResolved: getNumber(row, 'FIN Resolved'),
            finAutomationRate: getNumber(row, 'Fin Automation Rate'),
            csat: getNumber(row, 'CSAT'),
            finProcedureUses: getNumber(row, 'Fin Procedure Uses'),
            activeFinProcedures: getNumber(row, 'Active Fin Procedures'),
            hoursSaved: getFormula(row, 'Total Hours Saved'),
            revenueImpact: getFormula(row, 'Total Revenue Impact'),
          },
        } as RawSnapshot;
      })
      .filter((r): r is RawSnapshot => r !== null);

    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const raw = mockSnapshots(now);
    const { buckets, totals, granularity } = aggregate(raw, period, AGG_RULES, now);
    return mkResponse(buckets, totals, granularity, true, message);
  }
}

function mkResponse(
  buckets: Bucket[],
  totals: Record<string, number>,
  granularity: Granularity,
  mock: boolean,
  error?: string,
) {
  const bucketPayload = payloadFromBuckets(buckets);
  const snapshots = [...bucketPayload].reverse();
  const body = {
    snapshots,
    buckets: bucketPayload,
    totals: {
      finInvolvement: Math.round(totals.finInvolvement ?? 0),
      finResolved: Math.round(totals.finResolved ?? 0),
      finAutomationRate: Number((totals.finAutomationRate ?? 0).toFixed(1)),
      csat: Number((totals.csat ?? 0).toFixed(1)),
      finProcedureUses: Math.round(totals.finProcedureUses ?? 0),
      activeFinProcedures: Math.round(totals.activeFinProcedures ?? 0),
      hoursSaved: totals.hoursSaved ?? 0,
      revenueImpact: totals.revenueImpact ?? 0,
    },
    granularity,
    mock,
    ...(error ? { error } : {}),
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}
