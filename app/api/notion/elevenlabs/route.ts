import { NextRequest, NextResponse } from 'next/server';
import type { ElevenLabsSnapshot, DashboardPeriod } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '344bc9ab-b211-8088-9a0d-f8e92d02a1a4';

const MOCK_SNAPSHOTS: ElevenLabsSnapshot[] = [
  {
    id: 'mock-el-1',
    weekLabel: 'Week 16 · Apr 10–16, 2026',
    calls: 1140,
    avgDuration: 39,
    transferRate: 49.3,
    agents: 3,
    hoursSaved: 95,
    revenueImpact: 475,
  },
  {
    id: 'mock-el-2',
    weekLabel: 'Week 15 · Apr 3–9, 2026',
    calls: 1082,
    avgDuration: 41,
    transferRate: 51.2,
    agents: 3,
    hoursSaved: 90,
    revenueImpact: 450,
  },
  {
    id: 'mock-el-3',
    weekLabel: 'Week 14 · Mar 27 – Apr 2, 2026',
    calls: 1021,
    avgDuration: 38,
    transferRate: 52.8,
    agents: 3,
    hoursSaved: 85,
    revenueImpact: 425,
  },
  {
    id: 'mock-el-4',
    weekLabel: 'Week 13 · Mar 20–26, 2026',
    calls: 968,
    avgDuration: 40,
    transferRate: 54.1,
    agents: 3,
    hoursSaved: 80,
    revenueImpact: 400,
  },
  {
    id: 'mock-el-5',
    weekLabel: 'Week 12 · Mar 13–19, 2026',
    calls: 912,
    avgDuration: 42,
    transferRate: 55.4,
    agents: 3,
    hoursSaved: 76,
    revenueImpact: 380,
  },
  {
    id: 'mock-el-6',
    weekLabel: 'Week 11 · Mar 6–12, 2026',
    calls: 870,
    avgDuration: 39,
    transferRate: 56.0,
    agents: 2,
    hoursSaved: 72,
    revenueImpact: 360,
  },
  {
    id: 'mock-el-7',
    weekLabel: 'Week 10 · Feb 27 – Mar 5, 2026',
    calls: 824,
    avgDuration: 43,
    transferRate: 57.3,
    agents: 2,
    hoursSaved: 68,
    revenueImpact: 340,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    const limit =
      period === 'weekly' ? 7
      : period === 'monthly' ? 4
      : period === 'quarterly' ? 13
      : 52;
    return NextResponse.json({ snapshots: MOCK_SNAPSHOTS.slice(0, limit), mock: true });
  }

  try {
    const { queryDatabase, getNumber, getText, getFormula } = await import('@/lib/notion');

    const limit =
      period === 'weekly' ? 7
      : period === 'monthly' ? 4
      : period === 'quarterly' ? 13
      : 52;

    const rows = await queryDatabase(
      DB_ID,
      undefined,
      [{ property: 'Week Number', direction: 'descending' }]
    );

    const snapshots: ElevenLabsSnapshot[] = rows.slice(0, limit).map((row) => ({
      id: (row.id as string) ?? '',
      weekLabel: getText(row, 'Week Label'),
      calls: getNumber(row, 'ElevenLabs Calls'),
      avgDuration: getNumber(row, 'ElevenLabs Average Call Duration'),
      transferRate: getNumber(row, 'Transfer to live agent %'),
      agents: getNumber(row, 'Active ElevenLabs Agents'),
      hoursSaved: getFormula(row, 'Total Hours Saved'),
      revenueImpact: getFormula(row, 'Total Revenue Impact'),
    }));

    return NextResponse.json({ snapshots, mock: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { snapshots: MOCK_SNAPSHOTS, mock: true, error: message },
      { status: 200 }
    );
  }
}
