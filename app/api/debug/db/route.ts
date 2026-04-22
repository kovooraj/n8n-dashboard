import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { writeSnapshots, readSnapshots, todayUTC } from '@/lib/db-snapshots';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // 1. Check env vars
  results.env = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
    supabaseKey: process.env.SUPABASE_ANON_KEY ? `set (${process.env.SUPABASE_ANON_KEY.length} chars)` : 'MISSING',
  };

  // 2. Try a raw Supabase select
  try {
    const { data, error } = await getSupabase()
      .from('dashboard_daily_snapshots')
      .select('source, date')
      .order('synced_at', { ascending: false })
      .limit(5);
    results.select = error ? { error: error.message } : { rows: data };
  } catch (e) {
    results.select = { threw: String(e) };
  }

  // 3. Try a write via writeSnapshots
  const today = todayUTC();
  try {
    await writeSnapshots('debug-test', [{ date: today, metrics: { ts: Date.now() } }]);
    results.write = 'ok';
  } catch (e) {
    results.write = { threw: String(e) };
  }

  // 4. Verify the write landed
  try {
    const snaps = await readSnapshots('debug-test', today, today);
    results.verify = snaps.length > 0 ? { found: snaps[0] } : 'not found after write';
  } catch (e) {
    results.verify = { threw: String(e) };
  }

  return NextResponse.json(results);
}
