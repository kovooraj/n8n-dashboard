import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET  → { excludedUserIds: string[] }
// POST { excludedUserIds: string[] } → persists which users are excluded from
// the HeartbeatOS Activity metrics (e.g. admins excluding their own test usage).

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('heartbeat_activity_settings').select('value').eq('key', 'excluded_users');
    const ids = Array.isArray(data?.[0]?.value) ? data[0].value : [];
    return NextResponse.json({ excludedUserIds: ids });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.excludedUserIds)
      ? body.excludedUserIds.filter((x: unknown) => typeof x === 'string')
      : [];
    const supabase = getSupabase();
    const { error } = await supabase
      .from('heartbeat_activity_settings')
      .upsert({ key: 'excluded_users', value: ids, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) return NextResponse.json({ error: error.message }, { status: 200 });
    return NextResponse.json({ ok: true, excludedUserIds: ids });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 200 });
  }
}
