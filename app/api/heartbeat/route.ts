import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import type { DashboardPeriod } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// "HeartbeatOS Activity" — usage analytics for the separate heartbeatOS app,
// read from the shared Supabase project (heartbeat_events written by heartbeatOS).
// No changes to heartbeatOS are needed at read time; it just emits events.

// Keep in sync with heartbeatOS lib/roles.ts ALL_VIEWS + Sidebar labels. New
// views still auto-appear via discovery once they receive events; listing them
// here makes them show (as "Not used") even before their first event.
const DASH_LABELS: Record<string, { label: string; brand: 'sinalite' | 'willowpack' | null }> = {
  pipeline: { label: 'Pipeline Performance', brand: 'willowpack' },
  am: { label: 'AM Performance', brand: 'willowpack' },
  ads: { label: 'Ads Performance', brand: 'willowpack' },
  'sl-revenue': { label: 'SL- Revenue Performance', brand: 'sinalite' },
  'wl-apollo': { label: 'WL- Apollo Performance', brand: 'willowpack' },
  cx: { label: 'CX Performance', brand: 'willowpack' },
  bdr: { label: 'BDR Performance', brand: 'willowpack' },
  ae: { label: 'AE Performance', brand: 'willowpack' },
  chat: { label: 'Chat', brand: null },
};
const DASH_ORDER = ['pipeline', 'am', 'ads', 'sl-revenue', 'wl-apollo', 'cx', 'bdr', 'ae', 'chat'];

const DASHBOARD_OPEN_MINUTES = 5; // credit per user, per dashboard, per day (deduped)

interface Ev {
  user_id: string | null;
  user_email: string | null;
  session_id: string | null;
  event_type: string;
  view: string | null;
  brand: string | null;
  minutes_saved: number | null;
  created_at: string;
}

interface Bucket { key: string; label: string; start: number; end: number }

// ---- date helpers (no deps) -------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function mondayOf(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day);
  return x;
}

function buildBuckets(period: DashboardPeriod, now: Date): Bucket[] {
  const out: Bucket[] = [];
  if (period === 'weekly') {
    const cur = mondayOf(now);
    for (let i = 7; i >= 0; i--) {
      const s = new Date(cur); s.setDate(s.getDate() - i * 7);
      const e = new Date(s); e.setDate(e.getDate() + 7);
      out.push({ key: s.toISOString().slice(0, 10), label: `${MONTHS[s.getMonth()]} ${s.getDate()}`, start: s.getTime(), end: e.getTime() });
    }
  } else if (period === 'monthly') {
    for (let i = 5; i >= 0; i--) {
      const s = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const e = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      out.push({ key: `${s.getFullYear()}-${s.getMonth()}`, label: MONTHS[s.getMonth()], start: s.getTime(), end: e.getTime() });
    }
  } else if (period === 'quarterly') {
    const curQ = Math.floor(now.getMonth() / 3);
    for (let i = 3; i >= 0; i--) {
      const qIndex = curQ - i;
      const y = now.getFullYear() + Math.floor(qIndex / 4);
      const q = ((qIndex % 4) + 4) % 4;
      const s = new Date(y, q * 3, 1);
      const e = new Date(y, q * 3 + 3, 1);
      out.push({ key: `${y}-Q${q + 1}`, label: `Q${q + 1} ${String(y).slice(2)}`, start: s.getTime(), end: e.getTime() });
    }
  } else { // annually
    for (let i = 2; i >= 0; i--) {
      const y = now.getFullYear() - i;
      const s = new Date(y, 0, 1);
      const e = new Date(y + 1, 0, 1);
      out.push({ key: String(y), label: String(y), start: s.getTime(), end: e.getTime() });
    }
  }
  return out;
}

function uniqKey(e: Ev): string { return e.user_id || e.session_id || 'anon'; }

export async function GET(req: NextRequest) {
  const period = (req.nextUrl.searchParams.get('period') || 'weekly') as DashboardPeriod;
  const brand = req.nextUrl.searchParams.get('brand') || 'all'; // all | sinalite | willowpack

  let supabase;
  try { supabase = getSupabase(); }
  catch (e: any) { return NextResponse.json({ error: e.message, configured: false }, { status: 200 }); }

  const now = new Date();
  const buckets = buildBuckets(period, now);
  const sinceISO = new Date(buckets[0].start).toISOString();

  // Pull all events in window (internal volume is small) + the user roster.
  const [{ data: evRows, error: evErr }, { data: userRows }, { data: settingRows }] = await Promise.all([
    supabase
      .from('heartbeat_events')
      .select('user_id,user_email,session_id,event_type,view,brand,minutes_saved,created_at')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: true })
      .limit(100000),
    supabase.from('heartbeat_users').select('id,email,full_name,role,last_login,allowed_views'),
    supabase.from('heartbeat_activity_settings').select('value').eq('key', 'excluded_users'),
  ]);

  if (evErr) return NextResponse.json({ error: evErr.message, configured: true }, { status: 200 });

  // Users excluded from all metrics (e.g. admins testing their own usage).
  const excludedUserIds: string[] = Array.isArray(settingRows?.[0]?.value) ? settingRows[0].value : [];
  const excluded = new Set(excludedUserIds);

  let events = (evRows || []) as Ev[];
  if (brand !== 'all') events = events.filter((e) => (e.brand || null) === brand);
  if (excluded.size) events = events.filter((e) => !(e.user_id && excluded.has(e.user_id)));

  // ---- per-bucket series (visits + active users) ----------------------------
  const bucketOf = (t: number) => buckets.find((b) => t >= b.start && t < b.end);
  const series = buckets.map((b) => ({ key: b.key, label: b.label, visits: 0, users: new Set<string>(), ai: 0, minutes: 0 }));
  const seriesByKey = new Map(series.map((s) => [s.key, s]));

  // deduped dashboard-open credit: set of `${bucketKey}|${user}|${view}|${day}`
  const openCredit = new Set<string>();

  for (const e of events) {
    const t = new Date(e.created_at).getTime();
    const b = bucketOf(t);
    if (!b) continue;
    const s = seriesByKey.get(b.key)!;
    s.users.add(uniqKey(e));
    if (e.event_type === 'page_view') {
      s.visits++;
      const day = e.created_at.slice(0, 10);
      const ck = `${b.key}|${uniqKey(e)}|${e.view || '?'}|${day}`;
      if (!openCredit.has(ck)) { openCredit.add(ck); s.minutes += DASHBOARD_OPEN_MINUTES; }
    }
    if (e.event_type === 'ai_insight') s.ai++;
    s.minutes += Number(e.minutes_saved || 0);
  }

  const seriesOut = series.map((s) => ({
    label: s.label, visits: s.visits, users: s.users.size,
    ai: s.ai, hours: Math.round((s.minutes / 60) * 10) / 10,
  }));

  // ---- KPIs: current period-to-date vs the SAME elapsed slice of the prior --
  // period (apples-to-apples, so a partial current week doesn't read as a crash).
  function aggWindow(start: number, end: number) {
    let visits = 0, ai = 0, minutes = 0;
    const users = new Set<string>();
    const opens = new Set<string>();
    for (const e of events) {
      const t = new Date(e.created_at).getTime();
      if (t < start || t >= end) continue;
      users.add(uniqKey(e));
      if (e.event_type === 'page_view') {
        visits++;
        const ck = `${uniqKey(e)}|${e.view || '?'}|${e.created_at.slice(0, 10)}`;
        if (!opens.has(ck)) { opens.add(ck); minutes += DASHBOARD_OPEN_MINUTES; }
      }
      if (e.event_type === 'ai_insight') ai++;
      minutes += Number(e.minutes_saved || 0);
    }
    return { visits, users: users.size, ai, hours: Math.round((minutes / 60) * 10) / 10 };
  }
  // The KPI cards summarize the LATEST period that actually has activity — so
  // rolling into a fresh, still-empty month/week doesn't show all zeros while
  // the chart clearly has data. If that period is the current (in-progress) one
  // we compare it to the same elapsed slice of the prior period; if it's a
  // completed past period we compare full period vs full previous period.
  const nowMs = now.getTime();
  const hasData = (b: (typeof seriesOut)[number]) => b.visits > 0 || b.users > 0 || b.ai > 0;
  let kpiIdx = seriesOut.length - 1;
  for (let i = seriesOut.length - 1; i >= 0; i--) { if (hasData(seriesOut[i])) { kpiIdx = i; break; } }
  const kpiIsCurrent = kpiIdx === buckets.length - 1;

  let cur: { visits: number; users: number; ai: number; hours: number };
  let prev: { visits: number; users: number; ai: number; hours: number };
  if (kpiIsCurrent) {
    const lastB = buckets[kpiIdx];
    const prevB = buckets[kpiIdx - 1];
    const elapsed = nowMs - lastB.start;
    cur = aggWindow(lastB.start, nowMs);
    prev = prevB ? aggWindow(prevB.start, prevB.start + elapsed) : { visits: 0, users: 0, ai: 0, hours: 0 };
  } else {
    cur = seriesOut[kpiIdx];
    prev = seriesOut[kpiIdx - 1] || { visits: 0, users: 0, ai: 0, hours: 0 };
  }
  const delta = (a: number, b: number) => (b === 0 ? (a > 0 ? 100 : 0) : Math.round(((a - b) / b) * 1000) / 10);
  const kpis = {
    visits: { value: cur.visits, delta: delta(cur.visits, prev.visits) },
    users: { value: cur.users, delta: delta(cur.users, prev.users) },
    ai: { value: cur.ai, delta: delta(cur.ai, prev.ai) },
    hours: { value: cur.hours, delta: delta(cur.hours, prev.hours) },
  };
  const kpiPeriodLabel = buckets[kpiIdx]?.label ?? '';

  // ---- breakdown by dashboard (over the whole window) -----------------------
  const byView = new Map<string, { visits: number; users: Set<string>; ai: number; minutes: number }>();
  const byType: Record<string, number> = {};
  const byUser = new Map<string, { email: string; name: string; sessions: Set<string>; events: number; ai: number; minutes: number }>();

  for (const e of events) {
    byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    const v = e.view || 'other';
    if (!byView.has(v)) byView.set(v, { visits: 0, users: new Set(), ai: 0, minutes: 0 });
    const bv = byView.get(v)!;
    bv.users.add(uniqKey(e));
    if (e.event_type === 'page_view') bv.visits++;
    if (e.event_type === 'ai_insight') bv.ai++;
    bv.minutes += Number(e.minutes_saved || 0);

    const uk = uniqKey(e);
    if (!byUser.has(uk)) byUser.set(uk, { email: e.user_email || '—', name: e.user_email || 'Unknown', sessions: new Set(), events: 0, ai: 0, minutes: 0 });
    const bu = byUser.get(uk)!;
    if (e.session_id) bu.sessions.add(e.session_id);
    bu.events++;
    if (e.event_type === 'ai_insight') bu.ai++;
    bu.minutes += Number(e.minutes_saved || 0);
  }

  // add deduped dashboard-open credit into per-view minutes
  for (const ck of openCredit) {
    const view = ck.split('|')[2];
    const bv = byView.get(view);
    if (bv) bv.minutes += DASHBOARD_OPEN_MINUTES;
  }

  const userMeta = new Map((userRows || []).map((u: any) => [u.id, u]));

  // Merge all known heartbeat_users into byUser so new users with 0 events still appear.
  for (const u of (userRows || []) as any[]) {
    if (!byUser.has(u.id) && !excluded.has(u.id)) {
      byUser.set(u.id, {
        email: u.email || '—',
        name: u.full_name || u.email || 'Unknown',
        sessions: new Set<string>(),
        events: 0,
        ai: 0,
        minutes: 0,
      });
    }
  }

  // Auto-discover dashboards: known ones in fixed order, then any NEW view key
  // from events, then any view keys found in user allowed_views (covers dashboards
  // that exist but have zero events yet — new dashboards appear immediately).
  const prettify = (k: string) => k.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const discoveredFromEvents = [...byView.keys()].filter((k) => k && k !== 'other' && !DASH_ORDER.includes(k));
  const viewsFromUsers = new Set<string>();
  for (const u of (userRows || []) as any[]) {
    if (Array.isArray(u.allowed_views)) {
      for (const v of u.allowed_views as string[]) { if (v && v !== 'other') viewsFromUsers.add(v); }
    }
  }
  const discoveredFromUsers = [...viewsFromUsers].filter((k) => !DASH_ORDER.includes(k) && !discoveredFromEvents.includes(k));
  const allViewKeys = [...DASH_ORDER, ...discoveredFromEvents, ...discoveredFromUsers];

  const dashboards = allViewKeys
    .map((key) => {
      const bv = byView.get(key);
      const meta = DASH_LABELS[key] || { label: prettify(key), brand: null };
      if (brand !== 'all' && meta.brand !== brand) return null;
      return {
        key, label: meta.label, brand: meta.brand,
        visits: bv?.visits || 0,
        users: bv?.users.size || 0,
        ai: bv?.ai || 0,
        hours: bv ? Math.round((bv.minutes / 60) * 10) / 10 : 0,
        live: !!bv && (bv.visits > 0 || bv.ai > 0),
      };
    })
    .filter(Boolean);

  const activeDashboards = (dashboards as any[]).filter((d) => d.live).length;

  const topUsers = [...byUser.entries()]
    .map(([id, u]) => {
      const meta = userMeta.get(id);
      return {
        name: meta?.full_name || u.email,
        email: u.email,
        role: meta?.role || '—',
        sessions: u.sessions.size,
        events: u.events,
        ai: u.ai,
        hours: Math.round((u.minutes / 60) * 10) / 10,
      };
    })
    // Active users (any events) first by hours desc, then 0-activity users alpha
    .sort((a, b) => {
      const aActive = a.events > 0, bActive = b.events > 0;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.hours - a.hours || b.events - a.events || a.name.localeCompare(b.name);
    });

  const activity = [
    { key: 'page_view', label: 'Page views', value: byType['page_view'] || 0 },
    { key: 'click', label: 'Clicks', value: byType['click'] || 0 },
    { key: 'ai_insight', label: 'AI insights', value: byType['ai_insight'] || 0 },
    { key: 'export', label: 'Exports', value: byType['export'] || 0 },
  ];

  return NextResponse.json({
    configured: true,
    period, brand,
    totalUsers: (userRows || []).length,
    activeDashboards,
    kpis,
    kpiPeriodLabel,
    kpiIsCurrent,
    series: seriesOut,
    dashboards,
    activity,
    topUsers,
    allUsers: (userRows || []).map((u: any) => ({ id: u.id, name: u.full_name || u.email, email: u.email, role: u.role })),
    excludedUserIds,
    eventCount: events.length,
    asOf: now.toISOString(),
  });
}
