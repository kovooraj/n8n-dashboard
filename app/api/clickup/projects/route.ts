import { NextResponse } from 'next/server';
import type { ClickUpTask, TaskPlatform } from '@/lib/types';

const LIST_ID = '901112680070';

function detectPlatform(name: string): TaskPlatform {
  const n = name.toLowerCase().trim();
  // FIN / Intercom — check first (many tasks start with "fin")
  if (
    n.startsWith('fin ') || n.startsWith('fin-') || n.startsWith('fin\t') ||
    n.includes('fin tool') || n.includes('fin -') || n.includes('fin co') ||
    n.includes('refund') || n.includes('resend proof') || n.includes('change spec') ||
    n.includes('order cancel') || n.includes('intercom') ||
    n === 'fin'
  ) return 'fin';
  // ElevenLabs voice / call agents
  if (
    n.includes('elevenlabs') || n.includes('eleven labs') || n.includes('11labs') ||
    n.includes('call agent') || n.includes('outbound call') || n.includes('call rubric') ||
    n.includes('voice agent') || n.includes('rippit') || n.includes('onboarding call') ||
    n.includes('call ai agent') || n.includes('voice call') ||
    n.includes('reporting for voice') || n.includes('english voice') || n.includes('engish voice')
  ) return 'elevenlabs';
  // N8N / automation workflows
  if (
    n.includes('n8n') || n.includes('workflow') || n.includes('supabase') ||
    n.includes('powerbi') || n.includes('power bi') || n.includes('tier agent') ||
    n.includes('notion') || n.includes('rag') || n.includes('brain') ||
    n.includes('customer tier') || n.includes('salesforce') || n.includes('automat') ||
    n.includes('email report') || n.includes('email report') || n.includes('icp report') ||
    n.includes('approval agent') || n.includes('apollo') || n.includes('tier classifier') ||
    n.includes('tier report') || n.includes('tiering') || n.includes('account approver') ||
    n.includes('deal strategist') || n.includes('company auditor') || n.includes('ads report') ||
    n.includes('forecasting') || n.includes('zapier') || n.includes('weekly report') ||
    n.includes('ai report') || n.includes('ai agent') || n.includes('classifier') ||
    n.includes('margin analyzer') || n.includes('retro') || n.includes('retroactive')
  ) return 'n8n';
  return 'general';
}

const MOCK_TASKS: ClickUpTask[] = [
  {
    id: 'mock-cu-1',
    name: 'FIN Tool — Resolution Rate Improvement',
    status: 'in progress',
    statusColor: '#d4912a',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-15T10:30:00Z',
    platform: 'fin',
  },
  {
    id: 'mock-cu-2',
    name: 'ElevenLabs Voice Agent — Call Deflection Optimisation',
    status: 'in progress',
    statusColor: '#d4912a',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-14T14:20:00Z',
    platform: 'elevenlabs',
  },
  {
    id: 'mock-cu-3',
    name: 'N8N PowerBI Integration — Automated Reporting',
    status: 'complete',
    statusColor: '#3dba62',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-12T09:15:00Z',
    platform: 'n8n',
  },
  {
    id: 'mock-cu-4',
    name: 'Salesforce Automation — Quote Update Workflow',
    status: 'complete',
    statusColor: '#3dba62',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-10T11:00:00Z',
    platform: 'n8n',
  },
  {
    id: 'mock-cu-5',
    name: 'Outbound Call Agent — Customer Follow-up',
    status: 'to do',
    statusColor: '#6a8870',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-08T16:45:00Z',
    platform: 'elevenlabs',
  },
  {
    id: 'mock-cu-6',
    name: 'FIN Tool — Billing & Account Query Handling',
    status: 'on hold',
    statusColor: '#e05858',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-05T08:00:00Z',
    platform: 'fin',
  },
  {
    id: 'mock-cu-7',
    name: 'N8N Notion Sync Agent — Weekly Reporting',
    status: 'complete',
    statusColor: '#3dba62',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-03T12:00:00Z',
    platform: 'n8n',
  },
  {
    id: 'mock-cu-8',
    name: 'Customer Tier Agent — Lead Scoring Automation',
    status: 'in progress',
    statusColor: '#d4912a',
    url: '#',
    assignees: ['Alex Kovoor'],
    updatedAt: '2026-04-13T09:00:00Z',
    platform: 'n8n',
  },
];

export async function GET() {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) {
    return NextResponse.json({ tasks: MOCK_TASKS, mock: true });
  }

  try {
    const { getListTasks } = await import('@/lib/clickup');
    const raw = await getListTasks(LIST_ID);

    const tasks: ClickUpTask[] = raw.map((t) => {
      const status = t.status as { status?: string; color?: string } | undefined;
      const assignees = (t.assignees as Array<{ username?: string; email?: string }> | undefined) ?? [];
      const name = (t.name as string) ?? '';
      return {
        id: (t.id as string) ?? '',
        name,
        status: status?.status ?? 'unknown',
        statusColor: status?.color ?? '#6a8870',
        url: (t.url as string) ?? '#',
        assignees: assignees.map((a) => a.username ?? a.email ?? 'Unknown'),
        updatedAt: new Date((t.date_updated as number) ?? 0).toISOString(),
        platform: detectPlatform(name),
      };
    });

    return NextResponse.json({ tasks, mock: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { tasks: MOCK_TASKS, mock: true, error: message },
      { status: 200 }
    );
  }
}
