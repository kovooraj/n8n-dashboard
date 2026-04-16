'use client';

import { useState } from 'react';
import { Search, BarChart2, LayoutDashboard } from 'lucide-react';
import type { SidebarWorkflow } from '@/lib/types';

const HEALTH_COLOR: Record<string, string> = {
  healthy: '#3dba62',
  degraded: '#d4912a',
  failing: '#e05858',
  unknown: '#6a8870',
};

interface AutomationWorkflowSidebarProps {
  workflows: SidebarWorkflow[];
  selectedId: string | null; // null = overview selected
  onSelect: (id: string | null) => void;
}

export function AutomationWorkflowSidebar({
  workflows,
  selectedId,
  onSelect,
}: AutomationWorkflowSidebarProps) {
  const [query, setQuery] = useState('');

  const filtered = workflows.filter((w) =>
    w.name.toLowerCase().includes(query.toLowerCase())
  );

  const isOverview = selectedId === null;

  return (
    <div
      style={{
        width: 250,
        flexShrink: 0,
        background: '#050d07',
        borderLeft: '1px solid #1a2c1d',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid #1a2c1d',
          flexShrink: 0,
        }}
      >
        <p
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: '#6a8870',
            marginBottom: 8,
          }}
        >
          Automations
        </p>

        {/* Overview tab */}
        <button
          onClick={() => onSelect(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: '100%',
            padding: '7px 8px',
            marginBottom: 8,
            background: isOverview ? '#0f2014' : 'transparent',
            border: 'none',
            borderRadius: 6,
            borderLeft: isOverview ? '2px solid #3dba62' : '2px solid transparent',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={(e) => { if (!isOverview) (e.currentTarget as HTMLButtonElement).style.background = '#0a1a0d'; }}
          onMouseLeave={(e) => { if (!isOverview) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
        >
          <LayoutDashboard size={12} color={isOverview ? '#3dba62' : '#6a8870'} />
          <span style={{
            fontSize: '0.65rem',
            fontWeight: isOverview ? 700 : 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: isOverview ? '#e4ede6' : '#6a8870',
          }}>
            Overview
          </span>
        </button>

        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#0d1810',
            border: '1px solid #1a2c1d',
            borderRadius: 6,
            padding: '5px 8px',
          }}
        >
          <Search size={11} color="#6a8870" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SEARCH AUTOMATION"
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#e4ede6',
              fontSize: '0.6rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          />
        </div>
      </div>

      {/* Workflow list */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}
        className="custom-scroll"
      >
        {filtered.length === 0 ? (
          <p
            style={{
              padding: '16px 12px',
              fontSize: '0.7rem',
              color: '#6a8870',
              textAlign: 'center',
            }}
          >
            No workflows found
          </p>
        ) : (
          filtered.map((wf) => {
            const isSelected = selectedId === wf.id;
            const dotColor = HEALTH_COLOR[wf.health] ?? '#6a8870';
            return (
              <button
                key={wf.id}
                onClick={() => onSelect(wf.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '7px 12px',
                  background: isSelected ? '#0f2014' : 'transparent',
                  borderLeft: isSelected ? '2px solid #3dba62' : '2px solid transparent',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLButtonElement).style.background = '#0a1a0d';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected)
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {/* Health dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />

                {/* Name */}
                <span
                  style={{
                    flex: 1,
                    fontSize: '0.7rem',
                    color: isSelected ? '#e4ede6' : '#a0b8a4',
                    fontWeight: isSelected ? 600 : 400,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {wf.name}
                </span>

                {/* Bar chart icon */}
                <BarChart2 size={12} color={isSelected ? '#3dba62' : '#6a8870'} style={{ flexShrink: 0 }} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
