'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';

function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  return {
    gridStroke: isDark ? '#374151' : '#e5e7eb',
    tickColor: isDark ? '#9ca3af' : '#6b7280',
    tooltipBg: isDark ? '#1f2937' : '#ffffff',
    tooltipBorder: isDark ? '#374151' : '#e5e7eb',
    tooltipText: isDark ? '#e5e7eb' : '#111827',
  };
}

export default function SignupTrendChart({ data }: { data: { date: string; count: number }[] }) {
  const t = useChartTheme();

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="signupGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#5c7cfa" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#5c7cfa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
        <XAxis
          dataKey="date"
          stroke={t.tickColor}
          tick={{ fontSize: 12 }}
          tickFormatter={(v: string) => {
            const d = new Date(v + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis stroke={t.tickColor} tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: t.tooltipBg,
            border: `1px solid ${t.tooltipBorder}`,
            borderRadius: 8,
            color: t.tooltipText,
            fontSize: 13,
          }}
          labelFormatter={(v: string) => {
            const d = new Date(v + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#5c7cfa"
          fill="url(#signupGradient)"
          name="New Users"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
