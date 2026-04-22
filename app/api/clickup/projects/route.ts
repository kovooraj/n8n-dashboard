import { NextResponse } from 'next/server';
import type { ClickUpTask, TaskPlatform } from '@/lib/types';

// Never cache this route — always hit ClickUp live
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LIST_ID = '901112680070';
const CLICKUP_API = 'https://api.clickup.com/api/v2';

// Map ClickUp tag names → platform buckets
const TAG_PLATFORM_MAP: Record<string, TaskPlatform> = {
  'n8n': 'n8n',
  '11labs': 'elevenlabs',
  'elevenlabs': 'elevenlabs',
  'fin': 'fin',
  'ai tool': 'ai-tool',
  'ai tools': 'ai-tool',
  'ai-tool': 'ai-tool',
  'claude': 'ai-tool',
  'chatgpt': 'ai-tool',
  'gemini': 'ai-tool',
  'perplexity': 'ai-tool',
};

function detectPlatformFromTags(tags: string[]): TaskPlatform | null {
  for (const tag of tags) {
    const mapped = TAG_PLATFORM_MAP[tag.toLowerCase().trim()];
    if (mapped) return mapped;
  }
  return null;
}

function detectPlatformFromName(name: string): TaskPlatform {
  const n = name.toLowerCase().trim();
  if (
    n.startsWith('fin ') || n.startsWith('fin-') || n.startsWith('fin\t') ||
    n.includes('fin tool') || n.includes('fin -') || n.includes('fin co') ||
    n.includes('refund') || n.includes('resend proof') || n.includes('change spec') ||
    n.includes('order cancel') || n.includes('intercom') ||
    n === 'fin'
  ) return 'fin';
  if (
    n.includes('elevenlabs') || n.includes('eleven labs') || n.includes('11labs') ||
    n.includes('call agent') || n.includes('outbound call') || n.includes('call rubric') ||
    n.includes('voice agent') || n.includes('rippit') || n.includes('onboarding call') ||
    n.includes('call ai agent') || n.includes('voice call') ||
    n.includes('reporting for voice') || n.includes('english voice') || n.includes('engish voice')
  ) return 'elevenlabs';
  if (
    n.includes('n8n') || n.includes('workflow') || n.includes('supabase') ||
    n.includes('powerbi') || n.includes('power bi') || n.includes('tier agent') ||
    n.includes('notion') || n.includes('rag') || n.includes('brain') ||
    n.includes('customer tier') || n.includes('salesforce') || n.includes('automat') ||
    n.includes('email report') || n.includes('icp report') ||
    n.includes('approval agent') || n.includes('apollo') || n.includes('tier classifier') ||
    n.includes('tier report') || n.includes('tiering') || n.includes('account approver') ||
    n.includes('deal strategist') || n.includes('company auditor') || n.includes('ads report') ||
    n.includes('forecasting') || n.includes('zapier') || n.includes('weekly report') ||
    n.includes('ai report') || n.includes('ai agent') || n.includes('classifier') ||
    n.includes('margin analyzer') || n.includes('retro') || n.includes('retroactive')
  ) return 'n8n';
  return 'general';
}

async function fetchAllTasks(key: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let page = 0;

  while (true) {
    const url = `${CLICKUP_API}/list/${LIST_ID}/task?include_closed=true&page=${page}&subtasks=false`;
    const res = await fetch(url, {
      headers: { Authorization: key },
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`ClickUp API error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json() as { tasks: Record<string, unknown>[] };
    const tasks = data.tasks ?? [];
    all.push(...tasks);

    // ClickUp returns up to 100 tasks per page; fewer means last page
    if (tasks.length < 100) break;
    page++;
  }

  return all;
}

export async function GET() {
  const key = process.env.CLICKUP_API_KEY;
  if (!key) {
    return NextResponse.json({ tasks: [], mock: true, error: 'CLICKUP_API_KEY not set' });
  }

  try {
    const raw = await fetchAllTasks(key);

    const tasks: ClickUpTask[] = raw.map((t) => {
      const status = t.status as { status?: string; color?: string } | undefined;
      const assignees = (t.assignees as Array<{ username?: string; email?: string }> | undefined) ?? [];
      const name = (t.name as string) ?? '';
      const tagNames = ((t.tags as Array<{ name: string }>) ?? []).map((tag) => tag.name);
      const platform = detectPlatformFromTags(tagNames) ?? detectPlatformFromName(name);
      const rawPriority = t.priority as { priority?: string } | null | undefined;
      const priority = (rawPriority?.priority ?? null) as ClickUpTask['priority'];
      return {
        id: (t.id as string) ?? '',
        name,
        status: status?.status ?? 'unknown',
        statusColor: status?.color ?? '#6a8870',
        url: (t.url as string) ?? '#',
        assignees: assignees.map((a) => a.username ?? a.email ?? 'Unknown'),
        updatedAt: new Date(Number(t.date_updated ?? 0)).toISOString(),
        platform,
        priority,
      };
    });

    return NextResponse.json({ tasks, mock: false }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { tasks: [], mock: false, error: message },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
