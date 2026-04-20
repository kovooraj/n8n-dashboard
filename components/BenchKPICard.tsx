'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';

interface BenchKPICardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  showInfo?: boolean;
  /** Tooltip shown on hover of the info icon — explains how the metric is computed. */
  tooltip?: string;
  subBadge?: React.ReactNode;
  className?: string;
}

export function BenchKPICard({
  label,
  value,
  subLabel,
  showInfo = false,
  tooltip,
  subBadge,
  className = '',
}: BenchKPICardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-lg p-4 ${className}`}
      style={{
        background: '#0d1810',
        border: '1px solid #1a2c1d',
        minWidth: 0,
      }}
    >
      {showInfo && (
        <div
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            className="opacity-40 hover:opacity-90 transition-opacity"
            aria-label={tooltip ? `How this is calculated: ${tooltip}` : 'More information'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: tooltip ? 'help' : 'default', padding: 2 }}
          >
            <Info size={13} color={hovered && tooltip ? '#3dba62' : '#6a8870'} />
          </button>
          {tooltip && hovered && (
            <div
              role="tooltip"
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                width: 260,
                padding: '10px 12px',
                background: '#0a130c',
                border: '1px solid #1f3523',
                borderRadius: 6,
                boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
                fontSize: '0.72rem',
                lineHeight: 1.5,
                color: '#c6d6c9',
                letterSpacing: '0.01em',
                zIndex: 40,
                pointerEvents: 'none',
              }}
            >
              <p style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3dba62', marginBottom: 4 }}>
                How this is calculated
              </p>
              {tooltip}
            </div>
          )}
        </div>
      )}

      <p
        style={{
          fontSize: '0.6rem',
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#6a8870',
          lineHeight: 1.4,
        }}
      >
        {label}
      </p>

      <p
        style={{
          fontSize: '2.25rem',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          color: '#e4ede6',
          fontFamily: 'var(--font-space), ui-sans-serif, sans-serif',
        }}
      >
        {value}
      </p>

      {subLabel && (
        <p style={{ fontSize: '0.7rem', color: '#6a8870', marginTop: 2 }}>{subLabel}</p>
      )}

      {subBadge && <div style={{ marginTop: 4 }}>{subBadge}</div>}
    </div>
  );
}
