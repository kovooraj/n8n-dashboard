import { NextRequest, NextResponse } from 'next/server';
import type { FINSnapshot, DashboardPeriod } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '344bc9ab-b211-8078-848d-e21dfb052948';

const MOCK_SNAPSHOTS: FINSnapshot[] = [
  {
    id: 'mock-fin-1',
    weekLabel: 'Week 16 · Apr 10–16, 2026',
    finInvolvement: 1589,
    finResolved: 445,
    finAutomationRate: 28,
    csat: 78.1,
    hoursSaved: 74,
    revenueImpact: 370,
  },
  {
    id: 'mock-fin-2',
    weekLabel: 'Week 15 · Apr 3–9, 2026',
    finInvolvement: 1501,
    finResolved: 390,
    finAutomationRate: 26,
    csat: 76.5,
    hoursSaved: 68,
    revenueImpact: 340,
  },
  {
    id: 'mock-fin-3',
    weekLabel: 'Week 14 · Mar 27 – Apr 2, 2026',
    finInvolvement: 1420,
    finResolved: 355,
    finAutomationRate: 25,
    csat: 75.0,
    hoursSaved: 62,
    revenueImpact: 310,
  },
  {
    id: 'mock-fin-4',
    weekLabel: 'Week 13 · Mar 20–26, 2026',
    finInvolvement: 1360,
    finResolved: 326,
    finAutomationRate: 24,
    csat: 74.2,
    hoursSaved: 58,
    revenueImpact: 290,
  },
  {
    id: 'mock-fin-5',
    weekLabel: 'Week 12 · Mar 13–19, 2026',
    finInvolvement: 1298,
    finResolved: 299,
    finAutomationRate: 23,
    csat: 73.8,
    hoursSaved: 54,
    revenueImpact: 270,
  },
  {
    id: 'mock-fin-6',
    weekLabel: 'Week 11 · Mar 6–12, 2026',
    finInvolvement: 1241,
    finResolved: 272,
    finAutomationRate: 22,
    csat: 73.1,
    hoursSaved: 50,
    revenueImpact: 250,
  },
  {
    id: 'mock-fin-7',
    weekLabel: 'Week 10 · Feb 27 – Mar 5, 2026',
    finInvolvement: 1180,
    finResolved: 248,
    finAutomationRate: 21,
    csat: 72.5,
    hoursSaved: 46,
    revenueImpact: 230,
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

    const snapshots: FINSnapshot[] = rows.slice(0, limit).map((row) => ({
      id: (row.id as string) ?? '',
      weekLabel: getText(row, 'Week Label'),
      finInvolvement: getNumber(row, 'Fin Involvement'),
      finResolved: getNumber(row, 'FIN Resolved'),
      finAutomationRate: getNumber(row, 'Fin Automation Rate'),
      csat: getNumber(row, 'CSAT'),
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
