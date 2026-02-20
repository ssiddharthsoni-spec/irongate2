'use client';

import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/v1';

const RISK_COLORS = { low: '#51cf66', medium: '#fcc419', high: '#ff922b', critical: '#ff6b6b' };

export default function ReportsPage() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetchReport();
  }, [days]);

  async function fetchReport() {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/reports/exposure?days=${days}`, {
        headers: { 'Authorization': 'Bearer dev-token', 'X-Firm-ID': 'dev-firm-id' },
      });
      if (response.ok) {
        setReport(await response.json());
      } else {
        // Demo data
        setReport(getDemoReport());
      }
    } catch {
      setReport(getDemoReport());
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-96"><p className="text-gray-500">Generating report...</p></div>;
  if (!report) return <div className="text-red-500">Failed to load report</div>;

  const distData = [
    { name: 'Low', value: report.scoreDistribution.low, color: RISK_COLORS.low },
    { name: 'Medium', value: report.scoreDistribution.medium, color: RISK_COLORS.medium },
    { name: 'High', value: report.scoreDistribution.high, color: RISK_COLORS.high },
    { name: 'Critical', value: report.scoreDistribution.critical, color: RISK_COLORS.critical },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shadow AI Exposure Report</h1>
          <p className="text-sm text-gray-500">Generated {new Date().toLocaleDateString()} — Last {days} days</p>
        </div>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-iron-600 text-white rounded-lg text-sm hover:bg-iron-700"
        >
          Export PDF
        </button>
      </div>

      {/* Executive Summary */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Executive Summary</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-gray-500">Total AI Interactions</p>
            <p className="text-3xl font-bold text-gray-900">{report.executiveSummary.totalInteractions.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Unique Users</p>
            <p className="text-3xl font-bold text-gray-900">{report.executiveSummary.uniqueUsers}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">High Risk Interactions</p>
            <p className="text-3xl font-bold text-risk-critical">{report.executiveSummary.highRiskInteractions}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-6 mt-4">
          <div>
            <p className="text-sm text-gray-500">Avg Sensitivity Score</p>
            <p className="text-2xl font-bold">{report.executiveSummary.avgSensitivityScore}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Critical Events</p>
            <p className="text-2xl font-bold text-risk-critical">{report.executiveSummary.criticalInteractions}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Max Score Observed</p>
            <p className="text-2xl font-bold text-risk-high">{report.executiveSummary.maxSensitivityScore}</p>
          </div>
        </div>
      </div>

      {/* Score Distribution */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Sensitivity Score Distribution</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={distData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="value">
              {distData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tool Breakdown */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Tool Breakdown</h2>
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs font-medium text-gray-500 uppercase">
              <th className="pb-3">Tool</th>
              <th className="pb-3">Interactions</th>
              <th className="pb-3">Avg Score</th>
              <th className="pb-3">High Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.toolBreakdown.map((tool: any) => (
              <tr key={tool.toolId}>
                <td className="py-2 text-sm font-medium">{tool.toolId}</td>
                <td className="py-2 text-sm">{tool.count}</td>
                <td className="py-2 text-sm">{tool.avgScore}</td>
                <td className="py-2 text-sm text-risk-high">{tool.highRiskCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Trend */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Trend</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={report.dailyTrend}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="count" stroke="#4c6ef5" name="Interactions" />
            <Line type="monotone" dataKey="avgScore" stroke="#ff6b6b" name="Avg Score" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recommendations */}
      <div className="bg-white rounded-xl p-6 shadow-sm border mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recommendations</h2>
        <ul className="space-y-3">
          {report.recommendations.map((rec: string, i: number) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-sm font-medium">
                {i + 1}
              </span>
              <span className="text-sm text-gray-700">{rec}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function getDemoReport() {
  return {
    reportDate: new Date().toISOString(),
    periodDays: 30,
    executiveSummary: {
      totalInteractions: 12847,
      uniqueUsers: 156,
      avgSensitivityScore: 34.2,
      highRiskInteractions: 1568,
      criticalInteractions: 334,
      maxSensitivityScore: 97,
    },
    toolBreakdown: [
      { toolId: 'ChatGPT', count: 6421, avgScore: 32.5, highRiskCount: 789 },
      { toolId: 'Claude', count: 3212, avgScore: 38.1, highRiskCount: 456 },
      { toolId: 'Gemini', count: 1927, avgScore: 30.8, highRiskCount: 234 },
      { toolId: 'Copilot', count: 1287, avgScore: 28.4, highRiskCount: 89 },
    ],
    scoreDistribution: { low: 7823, medium: 3456, high: 1234, critical: 334 },
    dailyTrend: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - (29 - i) * 86400000).toISOString().split('T')[0],
      count: Math.floor(300 + Math.random() * 200),
      avgScore: Math.floor(25 + Math.random() * 25),
    })),
    recommendations: [
      'Deploy Iron Gate Proxy Mode to automatically protect sensitive prompts',
      'Implement user training on AI tool data hygiene practices',
      'Configure custom sensitivity thresholds for your organization',
      'Enable real-time alerts for critical sensitivity events',
    ],
  };
}
