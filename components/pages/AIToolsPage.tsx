'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Link2, RefreshCw, Users } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { BenchKPICard } from '@/components/BenchKPICard';
import type { DashboardPeriod } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';
import { TEAM, type Company } from '@/lib/aiToolsTeam';

/**
 * AI Tools — Claude usage per department across SinaLite + Willowpack.
 * Live data comes from /api/anthropic/usage (Anthropic Admin API).
 * If ANTHROPIC_ADMIN_KEY is missing the page falls back to zero rows and
 * shows the "Connect Claude data source" banner in the warning state.
 *
 * Hours-saved / revenue model (tunable once we have real volumes):
 *   hoursSaved   = conversations × 15 min / 60
 *   revenueImpact = hoursSaved × $20/hr
 */

type CompanyFilter = 'all' | Company;

interface TeamRow {
  email: string;
  name: string;
  department: string;
  companies: Company[];
  conversations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsagePayload {
  rows: TeamRow[];
  orgTotals?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    activeDays: number;
  };
  totals: {
    conversations: number;
    users: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  source: 'anthropic';
  limitations?: { perUser: boolean; note: string };
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

// Seed rows (zeroed) so the table shows every team member pre-data-load.
const SEED_ROWS: TeamRow[] = TEAM.map((m) => ({
  email: m.email,
  name: m.name,
  department: m.department,
  companies: m.companies,
  conversations: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
}));

interface DeptAgg {
  department: string;
  companies: Set<Company>;
  users: number;
  conversations: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  topUser: string;
  topConversations: number;
}

function aggregateByDept(rows: TeamRow[], company: CompanyFilter): DeptAgg[] {
  const filtered = company === 'all' ? rows : rows.filter((r) => r.companies.includes(company));
  const byDept = new Map<string, DeptAgg>();

  for (const r of filtered) {
    const cur = byDept.get(r.department) ?? {
      department: r.department,
      companies: new Set<Company>(),
      users: 0,
      conversations: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      topUser: '—',
      topConversations: -1,
    };
    cur.users += 1;
    cur.conversations += r.conversations;
    cur.tokensIn += r.inputTokens;
    cur.tokensOut += r.outputTokens;
    cur.costUsd += r.costUsd;
    for (const c of r.companies) cur.companies.add(c);
    if (r.conversations > cur.topConversations) {
      cur.topConversations = r.conversations;
      cur.topUser = r.name;
    }
    byDept.set(r.department, cur);
  }
  return Array.from(byDept.values()).sort((a, b) => b.conversations - a.conversations);
}

export function AIToolsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [company, setCompany] = useState<CompanyFilter>('all');
  const [rows, setRows] = useState<TeamRow[]>(SEED_ROWS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'anthropic' | 'none'>('none');
  const [orgTotals, setOrgTotals] = useState<UsagePayload['orgTotals']>(undefined);
  const [limitations, setLimitations] = useState<UsagePayload['limitations']>(undefined);

  const fetchUsage = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const force = isRefresh ? '&refresh=1' : '';
      const resp = await fetch(`/api/anthropic/usage?period=${period}&_t=${Date.now()}${force}`, { cache: 'no-store' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error ?? `HTTP ${resp.status}`);
        setRows(SEED_ROWS);
        setSource('none');
        return;
      }
      const data: UsagePayload = await resp.json();
      const byEmail = new Map(data.rows.map((r) => [r.email.toLowerCase(), r]));
      const merged = SEED_ROWS.map((s) => byEmail.get(s.email.toLowerCase()) ?? s);
      setRows(merged);
      setSource(data.source);
      setOrgTotals(data.orgTotals);
      setLimitations(data.limitations);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
      setRows(SEED_ROWS);
      setSource('none');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => { fetchUsage(false); }, [fetchUsage]);

  const deptRows = useMemo(() => aggregateByDept(rows, company), [rows, company]);
  const filteredRows = useMemo(
    () => (company === 'all' ? rows : rows.filter((r) => r.companies.includes(company))),
    [rows, company],
  );

  // Per-user data isn't exposed by the Anthropic Admin API, so for now we
  // display org-wide totals (API-only) and keep the roster for the mapping
  // view. Totals below fall back to per-row aggregation only if the server
  // ever starts returning real per-user numbers.
  const perRowConv = filteredRows.reduce((s, r) => s + r.conversations, 0);
  const perRowTokens = filteredRows.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const perRowCost = filteredRows.reduce((s, r) => s + r.costUsd, 0);

  const totalTokens = (orgTotals?.inputTokens ?? 0) + (orgTotals?.outputTokens ?? 0) || perRowTokens;
  const totalCost = orgTotals?.costUsd ?? perRowCost;
  const activeDays = orgTotals?.activeDays ?? 0;
  const activeUsers = filteredRows.filter((r) => r.conversations > 0).length;
  // Rough "conversations" proxy: tokens / 2000 (a chat-sized message).
  const conversationsProxy = totalTokens > 0 ? Math.round(totalTokens / 2000) : perRowConv;
  const hoursSaved = (conversationsProxy * 15) / 60;
  const revenueImpact = hoursSaved * 20;
  const maxConv = Math.max(1, ...deptRows.map((d) => d.conversations));

  const isConnected = source === 'anthropic' && !error;
  const bannerBg = isConnected ? 'rgba(61,186,98,0.08)' : 'rgba(212,145,42,0.08)';
  const bannerBorder = isConnected ? 'rgba(61,186,98,0.3)' : 'rgba(212,145,42,0.35)';
  const bannerAccent = isConnected ? '#3dba62' : '#d4912a';

  const companyPill = (key: CompanyFilter, label: string) => {
    const active = company === key;
    return (
      <button
        key={key}
        onClick={() => setCompany(key)}
        style={{
          padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
          background: active ? '#3dba62' : 'transparent',
          color: active ? '#050d07' : '#8aad90',
          border: `1px solid ${active ? '#3dba62' : '#1a2c1d'}`,
          fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <PeriodTabs active={period} onChange={setPeriod} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {companyPill('all', 'All')}
              {companyPill('sinalite', 'SinaLite')}
              {companyPill('willowpack', 'Willowpack')}
            </div>
            <button
              onClick={() => fetchUsage(true)}
              disabled={refreshing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px solid #1a2c1d',
                borderRadius: 6, padding: '5px 10px',
                cursor: refreshing ? 'not-allowed' : 'pointer',
                color: '#6a8870', fontSize: '0.65rem', fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                opacity: refreshing ? 0.5 : 1,
              }}
            >
              <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

          {/* Connect / status banner */}
          <div style={{
            background: bannerBg, border: `1px solid ${bannerBorder}`,
            borderRadius: 8, padding: '12px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Brain size={18} color={bannerAccent} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
                {isConnected
                  ? 'Connected to Claude (Anthropic Admin API)'
                  : 'Connect Claude data source'}
              </p>
              <p style={{ fontSize: '0.72rem', color: '#8aad90', margin: '2px 0 0 0' }}>
                {isConnected
                  ? `Live usage for ${TEAM.length} mapped team members. Cached 25h; daily cron keeps it warm.`
                  : error
                    ? <>Error: <code style={{ color: '#d4912a' }}>{error}</code>. Add <code style={{ color: '#b8d4bd' }}>ANTHROPIC_ADMIN_KEY</code> to Vercel env vars.</>
                    : <>Add <code style={{ color: '#b8d4bd' }}>ANTHROPIC_ADMIN_KEY</code> (Anthropic Admin API key, <code>sk-ant-admin01-…</code>) to Vercel env vars to load live data.</>
                }
              </p>
            </div>
            {!isConnected && (
              <a
                href="https://console.anthropic.com/settings/admin-keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 12px', borderRadius: 6,
                  background: 'rgba(212,145,42,0.15)', border: '1px solid rgba(212,145,42,0.4)',
                  color: bannerAccent, fontSize: '0.7rem', fontWeight: 700,
                  letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none', flexShrink: 0,
                }}
              >
                <Link2 size={11} /> Get key
              </a>
            )}
          </div>

          <SectionHeader eyebrow="1. AI TOOL USAGE" title="Claude usage across departments" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <BenchKPICard
              label="Active Days"
              value={loading ? '—' : activeDays}
              showInfo
              tooltip={`Days within the ${period} window that had any Claude API activity across the org. Pulled from Anthropic's Admin Usage Report.`}
            />
            <BenchKPICard
              label="Seats on Roster"
              value={loading ? '—' : filteredRows.length}
              showInfo
              tooltip="Team members mapped to departments in lib/aiToolsTeam.ts. Per-user attribution for Claude.ai isn't exposed by the Admin API yet — this is the seat list only."
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={10} /> {filteredRows.length} mapped
                </span>
              }
            />
            <BenchKPICard
              label="Estimated Hours Saved"
              value={loading ? '—' : formatHours(hoursSaved)}
              showInfo
              tooltip="Tokens ÷ 2,000 ≈ conversation proxy, × 15 min ÷ 60. Rough heuristic because Claude.ai doesn't report per-conversation counts."
            />
            <BenchKPICard
              label="Anthropic Spend"
              value={loading ? '—' : formatCurrency(totalCost)}
              showInfo
              tooltip={`Live org-wide spend from /v1/organizations/cost_report in the ${period} window. Estimated revenue impact from hours saved: ${formatCurrency(revenueImpact)}.`}
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870' }}>
                  Impact: {formatCurrency(revenueImpact)}
                </span>
              }
            />
          </div>

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: '10px 16px', marginBottom: 24 }}>
            <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
              Total tokens processed · {loading ? '—' : totalTokens.toLocaleString()}
            </p>
          </div>

          {limitations && !limitations.perUser && (
            <div style={{
              background: 'rgba(74,158,202,0.08)', border: '1px solid rgba(74,158,202,0.3)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20,
              fontSize: '0.75rem', color: '#8aad90',
            }}>
              <strong style={{ color: '#b8d4bd' }}>Note:</strong> Anthropic&apos;s Admin API only exposes org-wide totals — per-user and per-department breakdowns aren&apos;t available via API yet. To see who&apos;s using what, export the CSV from <a href="https://console.anthropic.com/settings/usage" target="_blank" rel="noopener noreferrer" style={{ color: '#4a9eca' }}>console.anthropic.com → Usage</a>.
            </div>
          )}

          <SectionHeader eyebrow="2. DEPARTMENT BREAKDOWN" title="Department mapping" />

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 1fr 1.2fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
              {['Department', 'Users', 'Active Days', 'Share', 'Top User'].map((h) => (
                <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>
                  {h}
                </span>
              ))}
            </div>
            {deptRows.map((d, i) => {
              const pct = (d.conversations / maxConv) * 100;
              return (
                <div
                  key={d.department}
                  style={{
                    display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 1fr 1.2fr 1fr',
                    padding: '12px 16px', alignItems: 'center',
                    borderBottom: i < deptRows.length - 1 ? '1px solid #1a2c1d' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{d.department}</span>
                    <span style={{ fontSize: '0.65rem', color: '#6a8870' }}>
                      {Array.from(d.companies).map((c) => c === 'sinalite' ? 'SinaLite' : 'Willowpack').join(' · ')}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.85rem', color: '#8aad90' }}>{d.users}</span>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 600 }}>{d.conversations.toLocaleString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#3dba62' }} />
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#6a8870', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>{d.topUser}</span>
                </div>
              );
            })}
            {deptRows.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>No departments match the selected filter.</p>
              </div>
            )}
          </div>

          <SectionHeader eyebrow="3. SEAT ROSTER" title="Mapped team members" />

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
              {['Person', 'Department', 'Company', 'Active Days', 'Tokens'].map((h) => (
                <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>
                  {h}
                </span>
              ))}
            </div>
            {[...filteredRows].sort((a, b) => b.conversations - a.conversations).map((r, i, arr) => (
              <div
                key={r.email}
                style={{
                  display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.8fr 1fr',
                  padding: '12px 16px', alignItems: 'center',
                  borderBottom: i < arr.length - 1 ? '1px solid #1a2c1d' : 'none',
                  opacity: r.conversations === 0 ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{r.name}</span>
                  <span style={{ fontSize: '0.65rem', color: '#6a8870', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.email}</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>{r.department}</span>
                <span style={{ fontSize: '0.7rem', color: '#6a8870' }}>
                  {r.companies.map((c) => c === 'sinalite' ? 'SinaLite' : 'Willowpack').join(' · ')}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 600 }}>{r.conversations.toLocaleString()}</span>
                <span style={{ fontSize: '0.75rem', color: '#8aad90' }}>
                  {(r.inputTokens + r.outputTokens).toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 24 }} />
        </div>
      </div>
    </div>
  );
}
