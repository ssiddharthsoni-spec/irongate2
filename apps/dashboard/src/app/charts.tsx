'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
  AreaChart, Area,
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
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
          label={({ name, value }) => `${name}: ${value}`}
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, color: t.tooltipText, borderRadius: 8 }}
        />
        <Legend />
      </PieChart>
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
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#5c7cfa" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#5c7cfa" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ff922b" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#ff922b" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={t.gridStroke} />
        <XAxis dataKey="date" stroke={t.tickColor} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" stroke={t.tickColor} tick={{ fontSize: 12 }} />
        <YAxis yAxisId="right" orientation="right" stroke={t.tickColor} tick={{ fontSize: 12 }} />
        <Tooltip
          contentStyle={{ backgroundColor: t.tooltipBg, border: 'none', borderRadius: 8, color: t.tooltipText }}
        />
        <Legend />
        <Area yAxisId="left" type="monotone" dataKey="count" stroke="#5c7cfa" fill="url(#colorCount)" name="Events" />
        <Area yAxisId="right" type="monotone" dataKey="avgScore" stroke="#ff922b" fill="url(#colorScore)" name="Avg Score" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export { RISK_COLORS };
