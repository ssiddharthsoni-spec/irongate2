'use client';

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

export function SensitivityDistributionChart({ data }: { data: DistributionItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis />
        <Tooltip />
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
        >
          {data.map((_, index) => (
            <Cell key={index} fill={TOOL_COLORS[index % TOOL_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DailyTrendChart({ data }: { data: TrendItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" />
        <YAxis yAxisId="right" orientation="right" />
        <Tooltip />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="count" stroke="#4c6ef5" name="Interactions" strokeWidth={2} />
        <Line yAxisId="right" type="monotone" dataKey="avgScore" stroke="#ff6b6b" name="Avg Score" strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export { RISK_COLORS };
