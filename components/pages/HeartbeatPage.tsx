'use client';

import { useCallback, useEffect, useState } from 'react';
import { Heart, RefreshCw, SlidersHorizontal, Check } from 'lucide-react';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { PeriodTabs } from '@/components/PeriodTabs';
import { BenchKPICard } from '@/components/BenchKPICard';
import { useStaleData } from '@/lib/useStaleData';
import type { DashboardPeriod } from '@/lib/types';

type Brand = 'all' | 'sinalite' | 'willowpack';

interface HeartbeatData {
  configured: boolean;
  error?: string;
  totalUsers: number;
  activeDashboards: number;
  kpis: { visits: KV; users: KV; ai: KV; hours: KV };
  series: { label: string; visits: number; users: number; ai: number; hours: number }[];
  dashboards: { key: string; label: string; brand: string | null; visits: number; users: number; ai: number; hours: number; live: boolean }[];
  activity: { key: string; label: string; value: number }[];
  topUsers: { name: string; email: string; role: string; sessions: number; events: number; ai: number; hours: number }[];
  allUsers: { id: string; name: string; email: string; role: string }[];
  excludedUserIds: string[];
  eventCount: number;
}
interface KV { value: number; delta: number }

const BLUE = '#5ea3e0';
const ACT_COLORS: Record<string, string> = { page_view: '#3dba62', click: BLUE, ai_insight: '#d4912a', export: '#c77dba' };
const DASH_COLORS = ['#3dba62', BLUE, '#d4912a', '#8b9d6a', '#c77dba', '#6a8870'];
const PERIOD_CHIP: Record<DashboardPeriod, string> = { weekly: 'PER WEEK', monthly: 'PER MONTH', quarterly: 'PER QUARTER', annually: 'PER YEAR' };

export function HeartbeatPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [brand, setBrand] = useState<Brand>('all');

  const fetcher = useCallback(async (): Promise<HeartbeatData> => {
    const res = await fetch(`/api/heartbeat?period=${period}&brand=${brand}`);
    return res.json();
  }, [period, brand]);

  const { data, loading, refreshing, refresh, error } = useStaleData<HeartbeatData>(
    `heartbeat:${period}:${brand}`, fetcher, [period, brand],
  );

  const d = data;
  const notConfigured = d && d.configured === false;

  // ---- exclude-users settings ----
  const [showSettings, setShowSettings] = useState(false);
  const [excl, setExcl] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (d?.excludedUserIds) setExcl(new Set(d.excludedUserIds)); }, [d?.excludedUserIds]);

  const toggleExcl = (id: string) => setExcl((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch('/api/heartbeat/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludedUserIds: [...excl] }),
      });
      setShowSettings(false);
      refresh();
    } finally { setSaving(false); }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto' }} className="custom-scroll">
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '22px 32px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Heart size={18} color="#3dba62" />
              <h1 style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.3px', margin: 0 }}>HeartbeatOS Activity</h1>
            </div>
            <p style={{ color: '#6a8870', fontSize: '0.8rem', margin: '4px 0 0' }}>
              Usage, active users &amp; hours saved across the heartbeatOS app
              {d ? ` · ${d.totalUsers} users · ${d.eventCount.toLocaleString()} events tracked` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowSettings((s) => !s)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '7px 13px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${showSettings || excl.size ? '#3dba62' : '#1a2c1d'}`, background: showSettings ? '#112014' : '#0d1810', color: showSettings || excl.size ? '#e4ede6' : '#6a8870' }}>
              <SlidersHorizontal size={11} /> Settings{excl.size ? ` · ${excl.size} excluded` : ''}
            </button>
            <button onClick={refresh} disabled={refreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '7px 13px', borderRadius: 7, border: '1px solid #1a2c1d', background: '#0d1810', color: '#6a8870', cursor: 'pointer' }}>
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <PeriodTabs active={period} onChange={setPeriod} />
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'sinalite', 'willowpack'] as Brand[]).map((b) => (
              <button key={b} onClick={() => setBrand(b)}
                style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${brand === b ? '#3dba62' : '#1a2c1d'}`, background: brand === b ? '#112014' : '#0d1810', color: brand === b ? '#e4ede6' : '#6a8870' }}>
                {b === 'all' ? 'All' : b === 'sinalite' ? 'SinaLite' : 'Willowpack'}
              </button>
            ))}
          </div>
        </div>

        {showSettings && d && (
          <div style={{ background: '#0d1810', border: '1px solid #3dba62', borderRadius: 10, padding: '16px 18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
              <h3 style={{ fontSize: '0.85rem', margin: 0, fontWeight: 600 }}>Exclude users from metrics</h3>
              <button onClick={saveSettings} disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '7px 14px', borderRadius: 7, border: 'none', background: '#3dba62', color: '#050d07', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                <Check size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <p style={{ color: '#6a8870', fontSize: '0.72rem', margin: '0 0 12px' }}>
              Checked users are removed from every metric on this page (visits, AI runs, hours saved, charts). Use this to exclude your own test usage.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
              {d.allUsers.map((u) => {
                const on = excl.has(u.id);
                return (
                  <button key={u.id} onClick={() => toggleExcl(u.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 11px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#3dba62' : '#1a2c1d'}`, background: on ? 'rgba(61,186,98,0.08)' : '#112014' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1px solid ${on ? '#3dba62' : '#2c4231'}`, background: on ? '#3dba62' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <Check size={11} color="#050d07" />}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '0.78rem', color: '#e4ede6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                      <span style={{ display: 'block', fontSize: '0.66rem', color: '#6a8870', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}{on ? ' · excluded' : ''}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {notConfigured && (
          <Banner text={`Supabase not configured: ${d?.error || 'set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_ANON_KEY'}`} />
        )}
        {error && !d && <Banner text={`Could not load activity: ${error}`} />}
        {loading && !d && <p style={{ color: '#6a8870', fontSize: '0.8rem' }}>Loading activity…</p>}

        {d && d.configured && (
          <>
            {/* KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 13, marginBottom: 13 }}>
              <BenchKPICard label="Active Users" value={d.kpis.users.value} subBadge={<Delta v={d.kpis.users.delta} />} showInfo tooltip="Distinct heartbeatOS users with at least one tracked action in the current period." />
              <BenchKPICard label="Page Visits" value={d.kpis.visits.value.toLocaleString()} subBadge={<Delta v={d.kpis.visits.delta} />} showInfo tooltip="Total dashboard/tab views across heartbeatOS in the current period." />
              <BenchKPICard label="AI Insights Run" value={d.kpis.ai.value.toLocaleString()} subBadge={<Delta v={d.kpis.ai.delta} />} showInfo tooltip="Every AI generation across heartbeatOS — Analyze-with-AI, AI coaching, next-step, email/outreach drafts, opportunity auto-fill, account signals, and ad regeneration — captured server-side." />
              <BenchKPICard label="Hours Saved" value={`${d.kpis.hours.value}h`} subBadge={<Delta v={d.kpis.hours.delta} />} showInfo tooltip="Σ(actions × time-saved multiplier): AI run 20m · export 30m · dashboard open 5m (1×/user/day) · email draft 10m." />
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 13, marginBottom: 13 }}>
              <Panel title="Page Visits" chip={PERIOD_CHIP[period]}>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={d.series} margin={{ top: 10, right: 6, left: -22, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2c1d" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6a8870', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1a2c1d' }} />
                    <YAxis tick={{ fill: '#6a8870', fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(61,186,98,0.06)' }} />
                    <Bar dataKey="visits" name="Page visits" fill="#3dba62" radius={[3, 3, 0, 0]} maxBarSize={46} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Active Users" chip={PERIOD_CHIP[period]}>
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={d.series} margin={{ top: 10, right: 6, left: -22, bottom: 4 }}>
                    <defs>
                      <linearGradient id="usersGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={BLUE} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1a2c1d" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#6a8870', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#1a2c1d' }} />
                    <YAxis tick={{ fill: '#6a8870', fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="users" name="Active users" stroke={BLUE} strokeWidth={2.2} fill="url(#usersGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
            </div>

            {/* Breakdown bars */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 13, marginBottom: 13 }}>
              <Panel title="Most-Used Dashboards" chip={`${d.activeDashboards} / ${d.dashboards.length} ACTIVE`}>
                <BarList rows={d.dashboards.map((x, i) => ({ name: x.label, value: x.visits, color: DASH_COLORS[i % DASH_COLORS.length] }))} suffix="" />
              </Panel>
              <Panel title="Activity Breakdown">
                <BarList rows={d.activity.map((a) => ({ name: a.label, value: a.value, color: ACT_COLORS[a.key] || '#6a8870' }))} suffix="" />
              </Panel>
            </div>

            {/* Table */}
            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 10, padding: '16px 18px', marginBottom: 13 }}>
              <p style={{ fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#6a8870', marginBottom: 4 }}>Dashboard Breakdown</p>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 14px', letterSpacing: '-0.3px' }}>Activity by heartbeatOS dashboard</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    {['Dashboard', 'Status', 'Visits', 'Active users', 'AI runs', 'Est. hrs saved'].map((h, i) => (
                      <th key={h} style={{ textAlign: i < 2 ? 'left' : 'right', color: '#6a8870', fontWeight: 600, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0 11px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.dashboards.map((r, i) => (
                    <tr key={r.key}>
                      <td style={{ padding: '13px 0', borderTop: '1px solid #1a2c1d' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: DASH_COLORS[i % DASH_COLORS.length] }} />{r.label}
                        </span>
                      </td>
                      <td style={{ padding: '13px 0', borderTop: '1px solid #1a2c1d' }}>
                        <Badge live={r.live} />
                      </td>
                      <Cell v={r.visits} /><Cell v={r.users} /><Cell v={r.ai} />
                      <td style={{ padding: '13px 0', borderTop: '1px solid #1a2c1d', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.hours ? <b>{r.hours}h</b> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* All users — active first, then 0-activity (new/inactive) dimmed */}
            {d.topUsers.length > 0 && (
              <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 10, padding: '16px 18px', marginBottom: 13 }}>
                <h3 style={{ fontSize: '0.82rem', margin: '0 0 14px', fontWeight: 600 }}>
                  All Users <span style={{ color: '#6a8870', fontWeight: 500 }}>· active first, by hours saved</span>
                </h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead><tr>
                    {['User', 'Role', 'Sessions', 'Actions', 'AI runs', 'Hrs saved'].map((h, i) => (
                      <th key={h} style={{ textAlign: i < 2 ? 'left' : 'right', color: '#6a8870', fontWeight: 600, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0 11px' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {d.topUsers.map((u) => {
                      const inactive = u.events === 0;
                      return (
                        <tr key={u.email} style={{ opacity: inactive ? 0.45 : 1 }}>
                          <td style={{ padding: '11px 0', borderTop: '1px solid #1a2c1d' }}>
                            {u.name}
                            {inactive && <span style={{ marginLeft: 7, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.06em', color: '#6a8870' }}>NO ACTIVITY</span>}
                          </td>
                          <td style={{ padding: '11px 0', borderTop: '1px solid #1a2c1d', color: '#6a8870', textTransform: 'capitalize' }}>{u.role}</td>
                          <Cell v={u.sessions} /><Cell v={u.events} /><Cell v={u.ai} />
                          <td style={{ padding: '11px 0', borderTop: '1px solid #1a2c1d', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {u.hours > 0 ? <b>{u.hours}h</b> : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderLeft: '2px solid #3dba62', borderRadius: 10, padding: '14px 18px', fontSize: '0.72rem', color: '#6a8870', lineHeight: 1.6 }}>
              <b style={{ color: '#e4ede6' }}>Source</b> — heartbeatOS emits anonymous-by-default usage events to the shared Supabase project. Page views &amp; AI-insight runs are captured live; hours saved is derived from tunable per-action multipliers. In-page click tracking is wired and grows as more buttons are instrumented.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Delta({ v }: { v: number }) {
  const up = v >= 0;
  return <span style={{ fontSize: '0.66rem', fontWeight: 700, color: up ? '#3dba62' : '#e05858' }}>{up ? '▲' : '▼'} {up ? '+' : ''}{v}%</span>;
}
function Panel({ title, chip, children }: { title: string; chip?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 10, padding: '16px 18px' }}>
      <h3 style={{ fontSize: '0.82rem', margin: '0 0 13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
        {title}
        {chip && <span style={{ marginLeft: 'auto', fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.1em', color: '#6a8870', border: '1px solid #1a2c1d', borderRadius: 6, padding: '2px 7px' }}>{chip}</span>}
      </h3>
      {children}
    </div>
  );
}
function BarList({ rows, suffix }: { rows: { name: string; value: number; color: string }[]; suffix: string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, fontSize: '0.78rem' }}>
          <span style={{ width: 152, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, lineHeight: 1.2 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />{r.name}
          </span>
          <span style={{ flex: 1, height: 7, background: '#112014', borderRadius: 5, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${(r.value / max) * 100 || 2}%`, background: r.color, borderRadius: 5 }} />
          </span>
          <span style={{ width: 48, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString()}{suffix}</span>
        </div>
      ))}
    </div>
  );
}
function Cell({ v }: { v: number }) {
  return <td style={{ padding: '13px 0', borderTop: '1px solid #1a2c1d', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v || '—'}</td>;
}
function Badge({ live }: { live: boolean }) {
  return (
    <span style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 6, border: `1px solid ${live ? 'rgba(61,186,98,0.4)' : '#1a2c1d'}`, color: live ? '#3dba62' : '#6a8870', background: live ? 'rgba(61,186,98,0.08)' : 'transparent' }}>
      {live ? 'Live' : 'Not used'}
    </span>
  );
}
function Banner({ text }: { text: string }) {
  return <div style={{ background: 'rgba(212,145,42,0.08)', border: '1px solid rgba(212,145,42,0.3)', color: '#d4912a', borderRadius: 8, padding: '11px 14px', fontSize: '0.78rem', marginBottom: 14 }}>{text}</div>;
}
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 6, padding: '8px 12px', fontSize: '0.75rem' }}>
      <p style={{ color: '#6a8870', marginBottom: 4, fontSize: '0.65rem', letterSpacing: '0.1em' }}>{label}</p>
      {payload.map((e: any) => (
        <p key={e.name} style={{ color: e.color, fontWeight: 600 }}>{e.name}: {e.value.toLocaleString()}</p>
      ))}
    </div>
  );
}
