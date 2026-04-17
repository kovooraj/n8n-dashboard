import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod } from '@/lib/types';
import { aggregate, type RawSnapshot, type Bucket, type Granularity } from '@/lib/aggregate';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '344bc9ab-b211-8088-9a0d-f8e92d02a1a4';

const AGG_RULES = {
  calls: 'sum',
  avgDuration: 'avg',
  transferRate: 'avg',
  agents: 'last',
  csat: 'avg',
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
        calls: 150 + (i % 7) * 30,
        avgDuration: 35 + (i % 5) * 3,
        transferRate: 49 + (i % 5),
        agents: 3,
        csat: 0,
        hoursSaved: 13 + (i % 3),
        revenueImpact: 65 + (i % 3) * 10,
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
  calls: number;
  avgDuration: number;
  transferRate: number;
  agents: number;
  csat: number;
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
    calls: Math.round(b.metrics.calls ?? 0),
    avgDuration: Number((b.metrics.avgDuration ?? 0).toFixed(1)),
    transferRate: Number((b.metrics.transferRate ?? 0).toFixed(1)),
    agents: Math.round(b.metrics.agents ?? 0),
    csat: Number((b.metrics.csat ?? 0).toFixed(1)),
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
            calls: getNumber(row, 'ElevenLabs Calls'),
            avgDuration: getNumber(row, 'ElevenLabs Average Call Duration'),
            transferRate: getNumber(row, 'Transfer to live agent %'),
            agents: getNumber(row, 'Active ElevenLabs Agents'),
            csat: getNumber(row, 'CSAT'),
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
      calls: Math.round(totals.calls ?? 0),
      avgDuration: Number((totals.avgDuration ?? 0).toFixed(1)),
      transferRate: Number((totals.transferRate ?? 0).toFixed(1)),
      agents: Math.round(totals.agents ?? 0),
      csat: Number((totals.csat ?? 0).toFixed(1)),
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
