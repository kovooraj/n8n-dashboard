'use client';

import { Check } from 'lucide-react';

interface HideCompletedToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  count?: number; // optional — how many completed items are currently hidden
}

/**
 * Small inline "Hide completed" checkbox used at the top of ClickUp project
 * sections on each page. Styled as a pill to match the rest of the dashboard.
 */
export function HideCompletedToggle({ checked, onChange, count }: HideCompletedToggleProps) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: checked ? 'rgba(61,186,98,0.14)' : 'transparent',
        border: `1px solid ${checked ? 'rgba(61,186,98,0.45)' : '#1a2c1d'}`,
        borderRadius: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        color: checked ? '#3dba62' : '#6a8870',
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        transition: 'all 0.15s',
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          border: `1px solid ${checked ? '#3dba62' : '#2a4230'}`,
          background: checked ? '#3dba62' : 'transparent',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {checked && <Check size={9} color="#0d1810" strokeWidth={3} />}
      </span>
      <span>Hide completed</span>
      {count != null && count > 0 && (
        <span
          style={{
            fontSize: '0.6rem',
            color: checked ? '#3dba62' : '#6a8870',
            opacity: 0.8,
            fontWeight: 700,
          }}
        >
          ({count})
        </span>
      )}
    </button>
  );
}
