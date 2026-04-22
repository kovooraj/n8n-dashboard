import 'server-only';
import type { RawSnapshot } from './aggregate';

const INTERCOM_BASE = 'https://api.intercom.io';
const INTERCOM_VERSION = '2.11';
const PAGE_SIZE = 150;
const HANDLE_TIME_MIN_PER_RESOLUTION = 5;
const REVENUE_PER_HOUR = 20;
const RESOLVED_STATES = new Set(['assumed_resolution', 'confirmed_resolution']);

interface IntercomConversation {
  id: string;
  created_at: number;
  ai_agent_participated?: boolean;
  ai_agent?: { resolution_state?: string } | null;
  conversation_rating?: { rating?: number | null } | null;
}

interface IntercomSearchResponse {
  conversations: IntercomConversation[];
  pages?: { next?: { starting_after?: string } | null };
}

export async function fetchIntercomRange(
  token: string,
  fromUnix: number,
  toUnix: number,
): Promise<IntercomConversation[]> {
  const out: IntercomConversation[] = [];
  let cursor: string | undefined;
  let guard = 0;

  while (guard++ < 500) {
    const body = {
      query: {
        operator: 'AND',
        value: [
          { field: 'created_at', operator: '>', value: fromUnix },
          { field: 'created_at', operator: '<', value: toUnix },
        ],
      },
      pagination: {
        per_page: PAGE_SIZE,
        ...(cursor ? { starting_after: cursor } : {}),
      },
    };

    const resp = await fetch(`${INTERCOM_BASE}/conversations/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Intercom-Version': INTERCOM_VERSION,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Intercom search failed ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as IntercomSearchResponse;
    if (Array.isArray(data.conversations)) out.push(...data.conversations);
    const next = data.pages?.next?.starting_after;
    if (!next) break;
    cursor = next;
  }

  return out;
}

export async function fetchIntercomConversations(
  token: string,
  afterUnix: number,
): Promise<IntercomConversation[]> {
  const nowUnix = Math.floor(Date.now() / 1000);
  const totalSec = nowUnix - afterUnix;
  const CHUNKS = 6;
  const chunkSec = Math.ceil(totalSec / CHUNKS);

  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < CHUNKS; i++) {
    const from = afterUnix + i * chunkSec;
    const to = i === CHUNKS - 1 ? nowUnix + 1 : afterUnix + (i + 1) * chunkSec;
    ranges.push([from, to]);
  }

  const results = await Promise.all(
    ranges.map(([from, to]) => fetchIntercomRange(token, from, to)),
  );

  const byId = new Map<string, IntercomConversation>();
  for (const chunk of results) {
    for (const c of chunk) byId.set(c.id, c);
  }
  return [...byId.values()];
}

function toISODay(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildIntercomDailySnapshots(
  convs: Array<{
    id: string;
    created_at: number;
    ai_agent_participated?: boolean;
    ai_agent?: { resolution_state?: string } | null;
    conversation_rating?: { rating?: number | null } | null;
  }>,
): RawSnapshot[] {
  interface Acc {
    involved: number;
    resolved: number;
    csatSum: number;
    csatCount: number;
  }
  const byDay = new Map<string, Acc>();

  for (const c of convs) {
    const day = toISODay(c.created_at);
    const acc = byDay.get(day) ?? { involved: 0, resolved: 0, csatSum: 0, csatCount: 0 };
    if (c.ai_agent_participated) {
      acc.involved += 1;
      const state = c.ai_agent?.resolution_state;
      if (state && RESOLVED_STATES.has(state)) acc.resolved += 1;
    }
    const rating = c.conversation_rating?.rating;
    if (typeof rating === 'number' && rating > 0) {
      acc.csatSum += rating;
      acc.csatCount += 1;
    }
    byDay.set(day, acc);
  }

  const out: RawSnapshot[] = [];
  for (const [date, acc] of byDay) {
    const automationRate = acc.involved > 0 ? (acc.resolved / acc.involved) * 100 : 0;
    const csatPct = acc.csatCount > 0 ? (acc.csatSum / acc.csatCount) * 20 : 0;
    const hoursSaved = (acc.resolved * HANDLE_TIME_MIN_PER_RESOLUTION) / 60;
    out.push({
      date,
      metrics: {
        finInvolvement: acc.involved,
        finResolved: acc.resolved,
        finAutomationRate: automationRate,
        csat: csatPct,
        finProcedureUses: 0,
        activeFinProcedures: 0,
        hoursSaved,
        revenueImpact: hoursSaved * REVENUE_PER_HOUR,
      },
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Fetch daily snapshots for the last `days` days from the Intercom API. */
export async function fetchIntercomDailySnapshots(days: number): Promise<RawSnapshot[]> {
  const token = process.env.INTERCOM_ACCESS_TOKEN;
  if (!token) throw new Error('INTERCOM_ACCESS_TOKEN not set');
  const afterUnix = Math.floor(Date.now() / 1000) - days * 86400;
  const convs = await fetchIntercomConversations(token, afterUnix);
  return buildIntercomDailySnapshots(convs);
}
