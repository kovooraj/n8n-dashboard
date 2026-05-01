import 'server-only';
import type { DashboardPeriod } from './types';

// Business-impact constants
// 15 messages = 5 min of manual work saved → 180 msgs/hr
const MESSAGES_PER_HOUR = 180;
const REVENUE_PER_HOUR  = 20;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatGPTUser {
  name: string;
  email: string;
  messages: number;
  gptMessages: number;
  toolMessages: number;
  connectorMessages: number;
  projectMessages: number;
  hoursSaved: number;
  revenueImpact: number;
  seatType: string;
}

export interface ChatGPTOrgStats {
  claimedSeats: number;
  activeUsers: number;
  purchasedSeats: number;
  totalMessages: number;
}

export interface ChatGPTPayload {
  users: ChatGPTUser[];
  stats: ChatGPTOrgStats;
  totals: {
    activeUsers: number;
    totalMessages: number;
    hoursSaved: number;
    revenueImpact: number;
  };
  window: { startDate: string; endDate: string };
  source: 'chatgpt-enterprise';
  error?: string;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function periodDays(period: DashboardPeriod): number {
  switch (period) {
    case 'weekly':    return 7;
    case 'monthly':   return 30;
    case 'quarterly': return 90;
    case 'annually':  return 365;
  }
}

function dateRange(period: DashboardPeriod): { startDate: string; endDate: string } {
  const now  = new Date();
  const days = periodDays(period);
  const start = new Date(now.getTime() - days * 86400 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(now) };
}

// ── Auth — exchange long-lived session token for a short-lived Bearer JWT ─────

async function getAccessToken(sessionToken: string): Promise<string> {
  const resp = await fetch('https://chatgpt.com/api/auth/session', {
    headers: {
      cookie: `__Secure-next-auth.session-token=${sessionToken}`,
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    },
    cache: 'no-store',
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`ChatGPT session ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as { accessToken?: string };
  if (!data.accessToken) throw new Error('No accessToken in ChatGPT session response — session may have expired');
  return data.accessToken;
}

function apiHeaders(accountId: string, accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'chatgpt-account-id': accountId,
    accept: '*/*',
    'oai-language': 'en-US',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  };
}

// ── user_list — paginated, returns ALL users ──────────────────────────────────

async function fetchUserList(
  accountId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ChatGPTUser[]> {
  const users: ChatGPTUser[] = [];
  let cursor: string | null = null;
  let guard = 0;

  while (guard++ < 20) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date:   endDate,
      filter_query: '',
      order_by_field: 'messages',
      order_by_direction: 'DESC',
      page_size: '100',
    });
    if (cursor) params.set('cursor', cursor);

    const url = `https://chatgpt.com/backend-api/accounts/${accountId}/analytics/user_list?${params}`;
    const resp = await fetch(url, { headers: apiHeaders(accountId, accessToken), cache: 'no-store' });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`ChatGPT user_list ${resp.status}: ${body.slice(0, 200)}`);
    }

    const data = await resp.json() as {
      users?: Array<{
        name: string;
        email: string;
        messages: number;
        gpt_messages: number;
        tool_messages: number;
        connector_messages: number;
        project_messages: number;
        credits_used: number;
        seat_type: string;
      }>;
      next_cursor?: string | null;
    };

    for (const u of data.users ?? []) {
      const hoursSaved = u.messages / MESSAGES_PER_HOUR;
      users.push({
        name:               u.name,
        email:              u.email,
        messages:           u.messages,
        gptMessages:        u.gpt_messages,
        toolMessages:       u.tool_messages,
        connectorMessages:  u.connector_messages,
        projectMessages:    u.project_messages,
        hoursSaved,
        revenueImpact:      hoursSaved * REVENUE_PER_HOUR,
        seatType:           u.seat_type,
      });
    }

    if (!data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return users;
}

// ── user_stats — org-level totals ────────────────────────────────────────────

async function fetchUserStats(
  accountId: string,
  accessToken: string,
  startDate: string,
  endDate: string,
): Promise<ChatGPTOrgStats> {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const url = `https://chatgpt.com/backend-api/accounts/${accountId}/analytics/user_stats?${params}`;
  const resp = await fetch(url, { headers: apiHeaders(accountId, accessToken), cache: 'no-store' });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`ChatGPT user_stats ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    claimed_seat?: number;
    active_users?: number;
    purchased_seats?: number;
    total_messages?: number;
  };

  return {
    claimedSeats:   data.claimed_seat    ?? 0,
    activeUsers:    data.active_users    ?? 0,
    purchasedSeats: data.purchased_seats ?? 0,
    totalMessages:  data.total_messages  ?? 0,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function fetchChatGPTPayload(period: DashboardPeriod): Promise<ChatGPTPayload> {
  const sessionToken = process.env.CHATGPT_SESSION_TOKEN;
  const accountId    = process.env.CHATGPT_ACCOUNT_ID;

  if (!sessionToken || !accountId) {
    throw new Error('CHATGPT_SESSION_TOKEN and CHATGPT_ACCOUNT_ID must be set in Vercel env vars');
  }

  const { startDate, endDate } = dateRange(period);
  const accessToken = await getAccessToken(sessionToken);

  const [users, stats] = await Promise.all([
    fetchUserList(accountId, accessToken, startDate, endDate),
    fetchUserStats(accountId, accessToken, startDate, endDate),
  ]);

  const totalMessages = users.reduce((s, u) => s + u.messages, 0);
  const totalHours    = totalMessages / MESSAGES_PER_HOUR;

  return {
    users,
    stats,
    totals: {
      activeUsers:   users.filter((u) => u.messages > 0).length,
      totalMessages,
      hoursSaved:    totalHours,
      revenueImpact: totalHours * REVENUE_PER_HOUR,
    },
    window: { startDate, endDate },
    source: 'chatgpt-enterprise',
  };
}
