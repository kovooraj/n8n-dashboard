'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, ExternalLink, RefreshCw } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { BenchKPICard } from '@/components/BenchKPICard';
import type { DashboardPeriod } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';
import { TEAM, type Company } from '@/lib/aiToolsTeam';

/**
 * AI Tools — Claude usage per department, sourced from Anthropic workspaces.
 *
 * The Admin API cannot group by user email, so department attribution is
 * driven by workspace naming convention. Name each workspace "<Dept> · <Company>"
 * (e.g. "Marketing · SinaLite", "Dev Team · Both") in the Anthropic console
 * and the page parses it automatically.
 */

type CompanyFilter = 'all' | Company;

interface DeptRow {
  department: string;
  workspaceName: string;
  workspaceId: string;
  companies: Company[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  activeDays: number;
}

interface Payload {
  rows: DeptRow[];
  orgTotals: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    activeDays: number;
    workspacesWithActivity: number;
  };
  workspaces: { id: string; name: string; department: string; companies: Company[] }[];
  source: 'anthropic';
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p className="section-eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</p>
      <h2 style={{ fontSize: '1.75rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>{title}</h2>
    </div>
  );
}

export function AIToolsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('weekly');
  const [company, setCompany] = useState<CompanyFilter>('all');
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [orgTotals, setOrgTotals] = useState<Payload['orgTotals'] | null>(null);
  const [workspaces, setWorkspaces] = useState<Payload['workspaces']>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'anthropic' | 'none'>('none');

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
        setSource('none');
        setRows([]);
        setOrgTotals(null);
        setWorkspaces([]);
        return;
      }
      const data: Payload = await resp.json();
      setRows(data.rows ?? []);
      setOrgTotals(data.orgTotals ?? null);
      setWorkspaces(data.workspaces ?? []);
      setSource(data.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
      setSource('none');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => { fetchUsage(false); }, [fetchUsage]);

  const filteredRows = useMemo(
    () => (company === 'all' ? rows : rows.filter((r) => r.companies.includes(company))),
    [rows, company],
  );

  const totalInput = filteredRows.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = filteredRows.reduce((s, r) => s + r.outputTokens, 0);
  const totalTokens = totalInput + totalOutput;
  const totalCost = filteredRows.reduce((s, r) => s + r.costUsd, 0);
  const activeDays = Math.max(0, ...filteredRows.map((r) => r.activeDays));
  const workspacesWithActivity = filteredRows.filter((r) => r.inputTokens + r.outputTokens > 0).length;

  // Rough conversation proxy so hours saved has a number.
  const conversationsProxy = totalTokens > 0 ? Math.round(totalTokens / 2000) : 0;
  const hoursSaved = (conversationsProxy * 15) / 60;
  const revenueImpact = hoursSaved * 20;

  const maxTokens = Math.max(1, ...filteredRows.map((r) => r.inputTokens + r.outputTokens));

  const isConnected = source === 'anthropic' && !error;
  const hasUnmapped = rows.some((r) => r.department === 'Unmapped' || r.workspaceName.startsWith('Default workspace'));
  const hasWorkspaces = workspaces.length > 0;

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

  const bannerBg = isConnected ? 'rgba(61,186,98,0.08)' : 'rgba(212,145,42,0.08)';
  const bannerBorder = isConnected ? 'rgba(61,186,98,0.3)' : 'rgba(212,145,42,0.35)';
  const bannerAccent = isConnected ? '#3dba62' : '#d4912a';

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

          {/* Connection status banner */}
          <div style={{
            background: bannerBg, border: `1px solid ${bannerBorder}`,
            borderRadius: 8, padding: '12px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Brain size={18} color={bannerAccent} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
                {isConnected
                  ? `Connected — ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} tracked`
                  : 'Connect Claude data source'}
              </p>
              <p style={{ fontSize: '0.72rem', color: '#8aad90', margin: '2px 0 0 0' }}>
                {isConnected
                  ? <>Usage attributed via Anthropic workspaces. Name them <code style={{ color: '#b8d4bd' }}>&quot;&lt;Department&gt; · &lt;Company&gt;&quot;</code> (e.g. &quot;Marketing · SinaLite&quot;, &quot;Dev Team · Both&quot;) for auto-mapping.</>
                  : error
                    ? <>Error: <code style={{ color: '#d4912a' }}>{error}</code></>
                    : <>Add <code style={{ color: '#b8d4bd' }}>ANTHROPIC_ADMIN_KEY</code> to Vercel env vars.</>
                }
              </p>
            </div>
            <a
              href="https://console.anthropic.com/settings/workspaces"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 6,
                background: `${bannerAccent}26`, border: `1px solid ${bannerAccent}66`,
                color: bannerAccent, fontSize: '0.7rem', fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase', textDecoration: 'none', flexShrink: 0,
              }}
            >
              Manage workspaces <ExternalLink size={11} />
            </a>
          </div>

          {/* Setup hint if no workspaces configured */}
          {isConnected && !hasWorkspaces && (
            <div style={{
              background: 'rgba(74,158,202,0.08)', border: '1px solid rgba(74,158,202,0.3)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 20,
              fontSize: '0.8rem', color: '#8aad90', lineHeight: 1.5,
            }}>
              <strong style={{ color: '#4a9eca', fontSize: '0.85rem' }}>Set up workspaces to see department breakdowns</strong>
              <ol style={{ margin: '8px 0 0 18px', padding: 0 }}>
                <li>Go to <a href="https://console.anthropic.com/settings/workspaces" target="_blank" rel="noopener noreferrer" style={{ color: '#4a9eca' }}>console.anthropic.com → Workspaces</a></li>
                <li>Create one workspace per department, named like <code style={{ color: '#b8d4bd' }}>Marketing · SinaLite</code>, <code style={{ color: '#b8d4bd' }}>Dev Team · Both</code>, <code style={{ color: '#b8d4bd' }}>CX · Willowpack</code>. Separators · — - | / all work.</li>
                <li>Invite each team member to their department&apos;s workspace (using their sinalite.com email).</li>
                <li>Click Refresh above — the page auto-maps workspace names to departments.</li>
              </ol>
            </div>
          )}

          <SectionHeader eyebrow="1. AI TOOL USAGE" title="Claude usage across departments" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <BenchKPICard
              label="Active Days"
              value={loading ? '—' : (orgTotals?.activeDays ?? activeDays)}
              showInfo
              tooltip={`Days in the ${period} window with Claude API activity across any workspace.`}
            />
            <BenchKPICard
              label="Active Departments"
              value={loading ? '—' : workspacesWithActivity}
              showInfo
              tooltip={`Departments (workspaces) with non-zero Claude usage in the window. ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} total.`}
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870' }}>
                  {filteredRows.length} mapped
                </span>
              }
            />
            <BenchKPICard
              label="Estimated Hours Saved"
              value={loading ? '—' : formatHours(hoursSaved)}
              showInfo
              tooltip="Total tokens ÷ 2,000 ≈ conversation proxy, × 15 min ÷ 60. Rough heuristic; tunable once we have real volumes."
            />
            <BenchKPICard
              label="Anthropic Spend"
              value={loading ? '—' : formatCurrency(totalCost)}
              showInfo
              tooltip={`Live org-wide spend from /v1/organizations/cost_report in the ${period} window. Est. revenue impact from hours saved: ${formatCurrency(revenueImpact)}.`}
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870' }}>
                  Impact: {formatCurrency(revenueImpact)}
                </span>
              }
            />
          </div>

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: '10px 16px', marginBottom: 24 }}>
            <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
              Tokens · in {loading ? '—' : totalInput.toLocaleString()} · out {loading ? '—' : totalOutput.toLocaleString()} · total {loading ? '—' : totalTokens.toLocaleString()}
            </p>
          </div>

          {hasUnmapped && isConnected && (
            <div style={{
              background: 'rgba(212,145,42,0.08)', border: '1px solid rgba(212,145,42,0.3)',
              borderRadius: 8, padding: '10px 14px', marginBottom: 20,
              fontSize: '0.75rem', color: '#8aad90',
            }}>
              <strong style={{ color: '#d4912a' }}>Heads up:</strong> Some usage is coming from workspaces that don&apos;t follow the naming convention (showing as &quot;Unmapped&quot; or &quot;Default&quot;). Rename them in the Anthropic console to auto-categorise.
            </div>
          )}

          <SectionHeader eyebrow="2. DEPARTMENT BREAKDOWN" title="Usage by department" />

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.7fr 1fr 1.2fr 0.9fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
              {['Department', 'Company', 'Active Days', 'Tokens', 'Share', 'Spend'].map((h) => (
                <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>
                  {h}
                </span>
              ))}
            </div>
            {filteredRows.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>
                  {loading ? 'Loading…' : isConnected ? 'No usage in the selected window.' : 'Connect the Admin API key to see data.'}
                </p>
              </div>
            ) : filteredRows.map((r, i) => {
              const tokens = r.inputTokens + r.outputTokens;
              const pct = (tokens / maxTokens) * 100;
              const companyLabel = r.companies.length === 2
                ? 'Both'
                : r.companies[0] === 'sinalite' ? 'SinaLite' : 'Willowpack';
              const companyColor = r.companies.length === 2
                ? '#9a86c9'
                : r.companies[0] === 'sinalite' ? '#3dba62' : '#4a9eca';
              return (
                <div
                  key={`${r.department}-${r.workspaceId}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.7fr 1fr 1.2fr 0.9fr',
                    padding: '12px 16px', alignItems: 'center',
                    borderBottom: i < filteredRows.length - 1 ? '1px solid #1a2c1d' : 'none',
                    opacity: tokens === 0 ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{r.department}</span>
                    <span style={{ fontSize: '0.65rem', color: '#6a8870', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.workspaceName}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: companyColor, padding: '2px 8px',
                    background: `${companyColor}18`, border: `1px solid ${companyColor}40`,
                    borderRadius: 4, justifySelf: 'start',
                  }}>
                    {companyLabel}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: '#8aad90' }}>{r.activeDays}</span>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 600 }}>{tokens.toLocaleString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: companyColor }} />
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#6a8870', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>
                    {r.costUsd > 0 ? formatCurrency(r.costUsd) : '—'}
                  </span>
                </div>
              );
            })}
          </div>

          <SectionHeader eyebrow="3. SEAT ROSTER" title="Team members by department" />

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1.2fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
              {['Person', 'Email', 'Department', 'Company'].map((h) => (
                <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870' }}>
                  {h}
                </span>
              ))}
            </div>
            {TEAM
              .filter((m) => company === 'all' || m.companies.includes(company))
              .map((m, i, arr) => (
                <div
                  key={m.email}
                  style={{
                    display: 'grid', gridTemplateColumns: '1.4fr 1.2fr 1.2fr 1fr',
                    padding: '12px 16px', alignItems: 'center',
                    borderBottom: i < arr.length - 1 ? '1px solid #1a2c1d' : 'none',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: '0.75rem', color: '#8aad90', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</span>
                  <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>{m.department}</span>
                  <span style={{ fontSize: '0.7rem', color: '#6a8870' }}>
                    {m.companies.map((c) => c === 'sinalite' ? 'SinaLite' : 'Willowpack').join(' · ')}
                  </span>
                </div>
              ))}
          </div>

          <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 16, lineHeight: 1.5 }}>
            Data from Anthropic Admin API · workspaces define departments · cached 25h · refreshed daily via Vercel cron.
          </p>

          <div style={{ height: 24 }} />
        </div>
      </div>
    </div>
  );
}
