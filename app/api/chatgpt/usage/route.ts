import { NextRequest, NextResponse } from 'next/server';
import type { DashboardPeriod } from '@/lib/types';
import { fetchChatGPTPayload } from '@/lib/chatgpt-usage';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = (searchParams.get('period') ?? 'weekly') as DashboardPeriod;

  if (!process.env.CHATGPT_SESSION_TOKEN || !process.env.CHATGPT_ACCOUNT_ID) {
    return NextResponse.json(
      { error: 'CHATGPT_SESSION_TOKEN and CHATGPT_ACCOUNT_ID must be set in Vercel env vars', source: 'none' },
      { status: 501, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const payload = await fetchChatGPTPayload(period);
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `chatgpt-error: ${message}`, source: 'none' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
