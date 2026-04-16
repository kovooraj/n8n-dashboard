'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { ChartPoint } from '@/lib/types';

interface SuccessChartProps {
  data: ChartPoint[];
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

export function SuccessChart({ data }: SuccessChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: data.length > 7 ? 20 : 4 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#1a2c1d"
          vertical={false}
        />
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
        <Line
          type="monotone"
          dataKey="success"
          name="Success"
          stroke="#3dba62"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#3dba62' }}
        />
        <Line
          type="monotone"
          dataKey="error"
          name="Errors"
          stroke="#e05858"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#e05858' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
