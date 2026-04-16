import { NextRequest, NextResponse } from 'next/server';
import type { N8NSnapshot, DashboardPeriod } from '@/lib/types';

// Never cache this route — period parameter drives fresh Notion reads every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DB_ID = '88be8990-0676-4789-a5ca-0fdbff431c46';

// Mock data for when no token is present
const MOCK_SNAPSHOTS: N8NSnapshot[] = [
  {
    id: 'mock-1',
    weekLabel: 'Week 16 · Apr 10–16, 2026',
    weekNumber: 16,
    quarter: 'Q2',
    totalTriggers: 1552,
    failedTriggers: 0,
    activeWorkflows: 22,
    newWorkflows: 2,
    hoursSaved: 43,
    revenueImpact: 2100,
  },
  {
    id: 'mock-2',
    weekLabel: 'Week 15 · Apr 3–9, 2026',
    weekNumber: 15,
    quarter: 'Q2',
    totalTriggers: 1438,
    failedTriggers: 12,
    activeWorkflows: 20,
    newWorkflows: 1,
    hoursSaved: 40,
    revenueImpact: 1950,
  },
  {
    id: 'mock-3',
    weekLabel: 'Week 14 · Mar 27 – Apr 2, 2026',
    weekNumber: 14,
    quarter: 'Q1',
    totalTriggers: 1321,
    failedTriggers: 8,
    activeWorkflows: 19,
    newWorkflows: 0,
    hoursSaved: 37,
    revenueImpact: 1820,
  },
  {
    id: 'mock-4',
    weekLabel: 'Week 13 · Mar 20–26, 2026',
    weekNumber: 13,
    quarter: 'Q1',
    totalTriggers: 1209,
    failedTriggers: 15,
    activeWorkflows: 19,
    newWorkflows: 2,
    hoursSaved: 34,
    revenueImpact: 1700,
  },
  {
    id: 'mock-5',
    weekLabel: 'Week 12 · Mar 13–19, 2026',
    weekNumber: 12,
    quarter: 'Q1',
    totalTriggers: 1180,
    failedTriggers: 22,
    activeWorkflows: 17,
    newWorkflows: 1,
    hoursSaved: 33,
    revenueImpact: 1650,
  },
  {
    id: 'mock-6',
    weekLabel: 'Week 11 · Mar 6–12, 2026',
    weekNumber: 11,
    quarter: 'Q1',
    totalTriggers: 1095,
    failedTriggers: 18,
    activeWorkflows: 16,
    newWorkflows: 0,
    hoursSaved: 31,
    revenueImpact: 1540,
  },
  {
    id: 'mock-7',
    weekLabel: 'Week 10 · Feb 27 – Mar 5, 2026',
    weekNumber: 10,
    quarter: 'Q1',
    totalTriggers: 1002,
    failedTriggers: 10,
    activeWorkflows: 16,
    newWorkflows: 1,
    hoursSaved: 28,
    revenueImpact: 1400,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  const token = process.env.NOTION_TOKEN;
  if (!token) {
    // Return appropriate mock slice based on period
    let snapshots = MOCK_SNAPSHOTS;
    if (period === 'weekly') snapshots = MOCK_SNAPSHOTS.slice(0, 7);
    else if (period === 'monthly') snapshots = MOCK_SNAPSHOTS.slice(0, 4);
    else if (period === 'quarterly') snapshots = MOCK_SNAPSHOTS;
    return NextResponse.json({ snapshots, mock: true });
  }

  try {
    const { queryDatabase, getNumber, getText, getSelect, getFormula } = await import('@/lib/notion');

    const rows = await queryDatabase(
      DB_ID,
      undefined,
      [{ property: 'Week Number', direction: 'descending' }]
    );

    const limit =
      period === 'weekly' ? 7
      : period === 'monthly' ? 4
      : period === 'quarterly' ? 13
      : 52;

    const snapshots: N8NSnapshot[] = rows.slice(0, limit).map((row) => ({
      id: (row.id as string) ?? '',
      weekLabel: getText(row, 'Week Label'),
      weekNumber: getNumber(row, 'Week Number'),
      quarter: getSelect(row, 'Quarter'),
      totalTriggers: getNumber(row, 'Total Triggers'),
      failedTriggers: getNumber(row, 'Total Failed Triggers'),
      activeWorkflows: getNumber(row, 'Total Active Workflows'),
      newWorkflows: getNumber(row, 'New Workflows Launched'),
      hoursSaved: getFormula(row, 'Total Hours Saved'),
      revenueImpact: getFormula(row, 'Total Revenue Impact'),
    }));

    return NextResponse.json({ snapshots, mock: false }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { snapshots: MOCK_SNAPSHOTS, mock: true, error: message },
      { status: 200 }
    );
  }
}
