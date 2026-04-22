import 'server-only';
import type { RawSnapshot } from './aggregate';

const EL_BASE = 'https://api.elevenlabs.io';
const PAGE_SIZE = 100;

interface ELConversation {
  conversation_id: string;
  agent_id?: string;
  start_time_unix_secs: number;
  call_duration_secs?: number;
  call_successful?: string;
}

interface ELListResponse {
  conversations?: ELConversation[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export async function fetchElevenLabsConversations(
  apiKey: string,
  afterUnix: number,
): Promise<ELConversation[]> {
  const out: ELConversation[] = [];
  let cursor: string | undefined;
  let guard = 0;

  while (guard++ < 500) {
    const url = new URL(`${EL_BASE}/v1/convai/conversations`);
    url.searchParams.set('page_size', String(PAGE_SIZE));
    url.searchParams.set('call_start_after_unix', String(afterUnix));
    if (cursor) url.searchParams.set('cursor', cursor);

    const resp = await fetch(url.toString(), {
      headers: { 'xi-api-key': apiKey, Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ElevenLabs list failed ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as ELListResponse;
    if (Array.isArray(data.conversations)) out.push(...data.conversations);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return out;
}

function toISODay(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function buildElevenLabsDailySnapshots(convs: ELConversation[]): RawSnapshot[] {
  interface Acc {
    calls: number;
    durationSum: number;
    durationCount: number;
    transfers: number;
    agentIds: Set<string>;
  }
  const byDay = new Map<string, Acc>();

  for (const c of convs) {
    const day = toISODay(c.start_time_unix_secs);
    const acc = byDay.get(day) ?? {
      calls: 0, durationSum: 0, durationCount: 0, transfers: 0, agentIds: new Set<string>(),
    };
    acc.calls += 1;
    if (typeof c.call_duration_secs === 'number' && c.call_duration_secs > 0) {
      acc.durationSum += c.call_duration_secs;
      acc.durationCount += 1;
    }
    if (c.call_successful !== 'success') acc.transfers += 1;
    if (c.agent_id) acc.agentIds.add(c.agent_id);
    byDay.set(day, acc);
  }

  const out: RawSnapshot[] = [];
  for (const [date, acc] of byDay) {
    out.push({
      date,
      metrics: {
        calls: acc.calls,
        avgDuration: acc.durationCount > 0 ? acc.durationSum / acc.durationCount : 0,
        transferRate: acc.calls > 0 ? (acc.transfers / acc.calls) * 100 : 0,
        agents: acc.agentIds.size,
        csat: 0,
        hoursSaved: 0,
        revenueImpact: 0,
      },
    });
  }

  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Fetch daily snapshots for the last `days` days from the ElevenLabs API. */
export async function fetchElevenLabsDailySnapshots(days: number): Promise<RawSnapshot[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not set');
  const afterUnix = Math.floor(Date.now() / 1000) - days * 86400;
  const convs = await fetchElevenLabsConversations(apiKey, afterUnix);
  return buildElevenLabsDailySnapshots(convs);
}
