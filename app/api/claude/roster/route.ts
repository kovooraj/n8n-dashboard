import { NextRequest, NextResponse } from 'next/server';
import { readPayload, writePayload } from '@/lib/db-snapshots';
import type { Company } from '@/lib/aiToolsTeam';

export const dynamic = 'force-dynamic';

/**
 * Persistent roster overrides — stored in dashboard_daily_snapshots
 * at a fixed sentinel date so they never expire like regular snapshots.
 *
 * Shape stored: Record<email, { department: string; companies: Company[] }>
 */
const OVERRIDE_SOURCE = 'team-overrides';
const OVERRIDE_DATE   = '0000-01-01';   // sentinel — never conflicts with real dates

export interface MemberOverride {
  department: string;
  companies: Company[];
}

export type RosterOverrides = Record<string, MemberOverride>;

/** GET — return current overrides (or empty object if none saved yet). */
export async function GET() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ overrides: {} });
  }
  try {
    const overrides = await readPayload<RosterOverrides>(OVERRIDE_SOURCE, OVERRIDE_DATE);
    return NextResponse.json({ overrides: overrides ?? {} });
  } catch {
    return NextResponse.json({ overrides: {} });
  }
}

/** PUT — save updated overrides. Body: { overrides: RosterOverrides } */
export async function PUT(request: NextRequest) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 501 });
  }
  try {
    const body = (await request.json()) as { overrides: RosterOverrides };
    // Basic validation — every value must have department (string) and companies (non-empty array)
    for (const [email, ov] of Object.entries(body.overrides ?? {})) {
      if (typeof ov.department !== 'string' || !Array.isArray(ov.companies) || ov.companies.length === 0) {
        return NextResponse.json({ error: `Invalid override for ${email}` }, { status: 400 });
      }
    }
    await writePayload(OVERRIDE_SOURCE, OVERRIDE_DATE, body.overrides);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
