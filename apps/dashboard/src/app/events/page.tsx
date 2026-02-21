'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '../../lib/api';

export default function EventsPage() {
  const { apiFetch } = useApiClient();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    minScore: '',
    aiToolId: '',
    limit: 50,
    offset: 0,
  });

  useEffect(() => {
    fetchEvents();
  }, [filters]);

  async function fetchEvents() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.minScore) params.set('minScore', filters.minScore);
      if (filters.aiToolId) params.set('aiToolId', filters.aiToolId);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));

      const response = await apiFetch(`/events?${params}`);

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    } finally {
      setLoading(false);
    }
  }

  function getScoreColor(score: number): string {
    if (score > 85) return 'text-risk-critical bg-red-50 dark:bg-red-900/20';
    if (score > 60) return 'text-risk-high bg-orange-50 dark:bg-orange-900/20';
    if (score > 25) return 'text-risk-medium bg-yellow-50 dark:bg-yellow-900/20';
    return 'text-risk-low bg-green-50 dark:bg-green-900/20';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
        <div className="flex gap-3">
          <select
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-gray-300"
            value={filters.aiToolId}
            onChange={(e) => setFilters({ ...filters, aiToolId: e.target.value, offset: 0 })}
          >
            <option value="">All Tools</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="copilot">Copilot</option>
            <option value="deepseek">DeepSeek</option>
          </select>
          <select
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-gray-300"
            value={filters.minScore}
            onChange={(e) => setFilters({ ...filters, minScore: e.target.value, offset: 0 })}
          >
            <option value="">All Scores</option>
            <option value="25">Score &gt; 25</option>
            <option value="60">Score &gt; 60</option>
            <option value="85">Score &gt; 85</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800/50 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <th className="px-6 py-3">Time</th>
              <th className="px-6 py-3">AI Tool</th>
              <th className="px-6 py-3">Score</th>
              <th className="px-6 py-3">Level</th>
              <th className="px-6 py-3">Entities</th>
              <th className="px-6 py-3">Action</th>
              <th className="px-6 py-3">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">Loading...</td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400 dark:text-gray-500">No events found</td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-900 dark:text-white">{event.aiToolId}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-sm font-bold ${getScoreColor(event.sensitivityScore)}`}>
                      {event.sensitivityScore}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.sensitivityLevel}</td>
                  <td className="px-6 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {Array.isArray(event.entities) ? event.entities.length : 0}
                  </td>
                  <td className="px-6 py-3 text-sm capitalize">{event.action}</td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400">{event.captureMethod}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <button
            onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - filters.limit) })}
            disabled={filters.offset === 0}
            className="px-3 py-1.5 text-sm rounded border dark:border-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Showing {filters.offset + 1} - {filters.offset + events.length}
          </span>
          <button
            onClick={() => setFilters({ ...filters, offset: filters.offset + filters.limit })}
            disabled={events.length < filters.limit}
            className="px-3 py-1.5 text-sm rounded border dark:border-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
