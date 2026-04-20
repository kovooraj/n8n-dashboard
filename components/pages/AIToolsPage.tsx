'use client';

import { useState } from 'react';
import { Brain, Link2, Users } from 'lucide-react';
import { PeriodTabs } from '@/components/PeriodTabs';
import { BenchKPICard } from '@/components/BenchKPICard';
import type { DashboardPeriod } from '@/lib/types';
import { formatCurrency, formatHours } from '@/lib/chartUtils';

/**
 * AI Tools — tracks LLM usage (Claude) per department across SinaLite + Willowpack.
 *
 * Phase 1 (this file): UI scaffold with mock data + "Connect Claude data source" banner.
 * Phase 2 (next): wire Anthropic Admin API (/v1/organizations/usage_report/messages
 *                 + /v1/organizations/cost_report) and replace mock data.
 *
 * Hours-saved model (tunable once we have real data):
 *   hoursSaved   = conversations × 15 min / 60
 *   revenueImpact = hoursSaved × $20/hr
 */

type Company = 'all' | 'sinalite' | 'willowpack';

interface DeptRow {
  department: string;
  company: 'sinalite' | 'willowpack';
  users: number;
  conversations: number;
  tokensIn: number;
  tokensOut: number;
  topUser: string;
}

// --- MOCK DATA (replace with Anthropic Admin API in Phase 2) ---
const MOCK_ROWS: DeptRow[] = [
  { department: 'Customer Success', company: 'sinalite', users: 6, conversations: 412, tokensIn: 1_840_000, tokensOut: 610_000, topUser: 'Alex K.' },
  { department: 'Engineering',      company: 'sinalite', users: 9, conversations: 1_284, tokensIn: 5_920_000, tokensOut: 2_110_000, topUser: 'Priya S.' },
  { department: 'Marketing',        company: 'sinalite', users: 4, conversations: 298, tokensIn: 980_000, tokensOut: 420_000, topUser: 'Jordan M.' },
  { department: 'Operations',       company: 'sinalite', users: 3, conversations: 164, tokensIn: 520_000, tokensOut: 180_000, topUser: 'Sam T.' },
  { department: 'Design',           company: 'willowpack', users: 2, conversations: 112, tokensIn: 360_000, tokensOut: 140_000, topUser: 'Riley P.' },
  { department: 'Engineering',      company: 'willowpack', users: 5, conversations: 642, tokensIn: 2_480_000, tokensOut: 910_000, topUser: 'Morgan L.' },
  { department: 'Sales',            company: 'willowpack', users: 3, conversations: 208, tokensIn: 720_000, tokensOut: 280_000, topUser: 'Casey R.' },
];

function filterRows(rows: DeptRow[], company: Company): DeptRow[] {
  if (company === 'all') return rows;
  return rows.filter((r) => r.company === company);
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
  const [company, setCompany] = useState<Company>('all');

  const rows = filterRows(MOCK_ROWS, company);
  const totalConversations = rows.reduce((s, r) => s + r.conversations, 0);
  const totalUsers = rows.reduce((s, r) => s + r.users, 0);
  const totalTokens = rows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
  const hoursSaved = (totalConversations * 15) / 60;
  const revenueImpact = hoursSaved * 20;

  // Sort by conversations desc for the breakdown table
  const sortedRows = [...rows].sort((a, b) => b.conversations - a.conversations);
  const maxConv = sortedRows[0]?.conversations ?? 1;

  const companyPill = (key: Company, label: string) => {
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

        {/* Top bar */}
        <div style={{ padding: '0 24px', flexShrink: 0, paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <PeriodTabs active={period} onChange={setPeriod} />
          <div style={{ display: 'flex', gap: 6 }}>
            {companyPill('all', 'All')}
            {companyPill('sinalite', 'SinaLite')}
            {companyPill('willowpack', 'Willowpack')}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }} className="custom-scroll">

          {/* Connect banner */}
          <div style={{
            background: 'rgba(61,186,98,0.08)', border: '1px solid rgba(61,186,98,0.3)',
            borderRadius: 8, padding: '12px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Brain size={18} color="#3dba62" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e4ede6', margin: 0 }}>
                Connect Claude data source
              </p>
              <p style={{ fontSize: '0.72rem', color: '#8aad90', margin: '2px 0 0 0' }}>
                Showing mock data. Add an Anthropic Admin API key (<code style={{ color: '#b8d4bd' }}>ANTHROPIC_ADMIN_KEY</code>) to pull live usage from your org.
              </p>
            </div>
            <button
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 6,
                background: 'rgba(61,186,98,0.15)', border: '1px solid rgba(61,186,98,0.4)',
                color: '#3dba62', fontSize: '0.7rem', fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <Link2 size={11} /> Connect
            </button>
          </div>

          <SectionHeader eyebrow="1. AI TOOL USAGE" title="Claude usage across departments" />

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            <BenchKPICard
              label="Total Conversations"
              value={totalConversations.toLocaleString()}
              showInfo
              tooltip={`Sum of Claude conversations across selected ${company === 'all' ? 'companies' : company} in the ${period} window. Sourced from Claude analytics (mock data until Admin API is wired).`}
            />
            <BenchKPICard
              label="Active Users"
              value={totalUsers}
              showInfo
              tooltip="Distinct seat-holders who ran at least one Claude conversation in the window."
              subBadge={
                <span style={{ fontSize: '0.65rem', color: '#6a8870', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Users size={10} /> across {rows.length} department{rows.length === 1 ? '' : 's'}
                </span>
              }
            />
            <BenchKPICard
              label="Estimated Hours Saved"
              value={formatHours(hoursSaved)}
              showInfo
              tooltip="Conversations × 15 min ÷ 60. Flat model — will be tuned per department once we have live Admin API data."
            />
            <BenchKPICard
              label="Estimated Revenue Impact"
              value={formatCurrency(revenueImpact)}
              showInfo
              tooltip="Hours saved × $20/hr, matching the ElevenLabs / FIN pages."
            />
          </div>

          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, padding: '10px 16px', marginBottom: 24 }}>
            <p style={{ fontSize: '0.65rem', color: '#6a8870', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0 }}>
              Total tokens processed · {totalTokens.toLocaleString()}
            </p>
          </div>

          <SectionHeader eyebrow="2. DEPARTMENT BREAKDOWN" title="Usage by department" />

          {/* Breakdown table */}
          <div style={{ background: '#0d1810', border: '1px solid #1a2c1d', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.6fr 1fr 1.2fr 0.9fr', padding: '10px 16px', borderBottom: '1px solid #1a2c1d' }}>
              {['Department', 'Company', 'Users', 'Conversations', 'Share', 'Top User'].map((h, i) => (
                <span key={h} style={{ fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6a8870', textAlign: i === 2 ? 'right' : 'left' }}>
                  {h}
                </span>
              ))}
            </div>
            {sortedRows.map((r, i) => {
              const pct = (r.conversations / maxConv) * 100;
              const companyColor = r.company === 'sinalite' ? '#3dba62' : '#4a9eca';
              const companyLabel = r.company === 'sinalite' ? 'SinaLite' : 'Willowpack';
              return (
                <div
                  key={`${r.company}-${r.department}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '1.2fr 0.9fr 0.6fr 1fr 1.2fr 0.9fr',
                    padding: '12px 16px', alignItems: 'center',
                    borderBottom: i < sortedRows.length - 1 ? '1px solid #1a2c1d' : 'none',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 500 }}>{r.department}</span>
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: companyColor, padding: '2px 8px',
                    background: `${companyColor}18`, border: `1px solid ${companyColor}40`,
                    borderRadius: 4, justifySelf: 'start',
                  }}>
                    {companyLabel}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: '#8aad90', textAlign: 'right', paddingRight: 12 }}>{r.users}</span>
                  <span style={{ fontSize: '0.85rem', color: '#e4ede6', fontWeight: 600 }}>{r.conversations.toLocaleString()}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, background: '#112014', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: companyColor }} />
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#6a8870', width: 36, textAlign: 'right' }}>{Math.round(pct)}%</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#8aad90' }}>{r.topUser}</span>
                </div>
              );
            })}
            {sortedRows.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center' }}>
                <p style={{ fontSize: '0.8rem', color: '#6a8870' }}>No departments match the selected filter.</p>
              </div>
            )}
          </div>

          <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 16 }}>
            Mock data · replace with live Anthropic Admin API data in Phase 2.
          </p>

          <div style={{ height: 24 }} />
        </div>
      </div>
    </div>
  );
}
