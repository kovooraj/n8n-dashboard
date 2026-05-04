'use client';

import type { CSSProperties } from 'react';

interface SkeletonBlockProps {
  height?: number | string;
  width?: number | string;
  borderRadius?: number | string;
  style?: CSSProperties;
}

/** A single shimmer block — use for text lines, badges, etc. */
export function SkeletonBlock({ height = 16, width = '100%', borderRadius = 6, style }: SkeletonBlockProps) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius, flexShrink: 0, ...style }}
    />
  );
}

/** Full chart-area skeleton — mimics the chart container height. */
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      style={{
        height,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 6,
        padding: '0 4px',
      }}
    >
      {/* Fake bar columns — give a chart-like silhouette */}
      {[55, 75, 45, 90, 60, 80, 50, 70, 40, 65, 85, 55].map((h, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            flex: 1,
            height: `${h}%`,
            borderRadius: '4px 4px 0 0',
            animationDelay: `${i * 60}ms`,
          }}
        />
      ))}
      {/* Overlay gradient so it blends into surrounding card */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, transparent 60%, #0d1810 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** Four-column KPI card skeleton row. */
export function KPIGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: '#0d1810',
            border: '1px solid #1a2c1d',
            borderRadius: 8,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <SkeletonBlock height={10} width="60%" />
          <SkeletonBlock height={28} width="70%" style={{ animationDelay: '80ms' }} />
          <SkeletonBlock height={9} width="45%" style={{ animationDelay: '160ms' }} />
        </div>
      ))}
    </div>
  );
}

/** A simple full-width loading bar — use inside existing card padding. */
export function InlineSkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} height={12} width={`${85 - i * 12}%`} style={{ animationDelay: `${i * 100}ms` }} />
      ))}
    </div>
  );
}
