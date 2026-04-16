'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { VolumePoint } from '@/lib/types';

interface VolumeChartProps {
  data: VolumePoint[];
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#0d1810',
        border: '1px solid #1a2c1d',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: '0.75rem',
      }}
    >
      <p style={{ color: '#6a8870', marginBottom: 4, fontSize: '0.65rem', letterSpacing: '0.1em' }}>
        {label}
      </p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color, fontWeight: 600 }}>
          {entry.name}: {entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: VolumeChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: data.length > 7 ? 20 : 4 }}>
        <defs>
          <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgba(14,24,16,0.8)" stopOpacity={0.8} />
            <stop offset="95%" stopColor="rgba(14,24,16,0)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="resolvedGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgba(61,186,98,0.25)" stopOpacity={0.8} />
            <stop offset="95%" stopColor="rgba(61,186,98,0)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2c1d" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: '#6a8870', fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: '#1a2c1d' }}
          angle={data.length > 7 ? -35 : 0}
          textAnchor={data.length > 7 ? 'end' : 'middle'}
          interval={data.length > 10 ? 1 : 0}
        />
        <YAxis
          tick={{ fill: '#6a8870', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: '0.65rem', paddingTop: 8 }}
          formatter={(value) => (
            <span style={{ color: '#6a8870', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {value}
            </span>
          )}
        />
        <Area
          type="monotone"
          dataKey="total"
          name="Overall Volume"
          stroke="#1a2c1d"
          strokeWidth={2}
          fill="url(#totalGrad)"
        />
        <Area
          type="monotone"
          dataKey="resolved"
          name="Volume Resolved"
          stroke="#3dba62"
          strokeWidth={2}
          fill="url(#resolvedGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
