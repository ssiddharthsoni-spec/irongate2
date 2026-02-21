'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';

const RISK_COLORS = {
  low: '#51cf66',
  medium: '#fcc419',
  high: '#ff922b',
  critical: '#ff6b6b',
};

const TOOL_COLORS = ['#4c6ef5', '#7950f2', '#e64980', '#20c997', '#fab005', '#fd7e14'];

interface DistributionItem {
  name: string;
  value: number;
  color: string;
}

interface ToolItem {
  toolId: string;
  toolName: string;
  count: number;
  percentage: number;
}

interface TrendItem {
  date: string;
  count: number;
  avgScore: number;
}

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
    labelColor: isDark ? '#d1d5db' : '#374151',
  };
}

export function SensitivityDistributionChart({ data }: { data: DistributionItem[] }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: t.tickColor }} />
        <YAxis tick={{ fill: t.tickColor }} />
        <Tooltip
          contentStyle={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, color: t.tooltipText, borderRadius: 8 }}
          labelStyle={{ color: t.tooltipText }}
        />
        <Bar dataKey="value" name="Events">
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ToolBreakdownChart({ data }: { data: ToolItem[] }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="toolName"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={({ toolName, percentage }: any) => `${toolName} (${percentage}%)`}
          labelLine={{ stroke: t.tickColor }}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={TOOL_COLORS[index % TOOL_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, color: t.tooltipText, borderRadius: 8 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DailyTrendChart({ data }: { data: TrendItem[] }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
        <XAxis dataKey="date" tick={{ fontSize: 12, fill: t.tickColor }} />
        <YAxis yAxisId="left" tick={{ fill: t.tickColor }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fill: t.tickColor }} />
        <Tooltip
          contentStyle={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, color: t.tooltipText, borderRadius: 8 }}
          labelStyle={{ color: t.tooltipText }}
        />
        <Legend wrapperStyle={{ color: t.labelColor }} />
        <Line yAxisId="left" type="monotone" dataKey="count" stroke="#4c6ef5" name="Interactions" strokeWidth={2} />
        <Line yAxisId="right" type="monotone" dataKey="avgScore" stroke="#ff6b6b" name="Avg Score" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export { RISK_COLORS };
