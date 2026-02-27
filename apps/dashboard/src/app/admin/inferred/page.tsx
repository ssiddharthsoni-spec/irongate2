'use client';

import React, { useState, useEffect } from 'react';
import { useApiClient } from '@/lib/api';

interface InferredEntity {
  id: string;
  inferredType: string;
  confidence: number;
  evidenceCount: number;
  status: 'pending' | 'confirmed' | 'rejected';
  firstSeenAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800',
  confirmed: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800',
  rejected: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800',
};

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-green-500',
  rejected: 'bg-red-500',
};

export default function InferredEntitiesPage() {
  const { apiFetch } = useApiClient();

  const [entities, setEntities] = useState<InferredEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action state
  const [actionId, setActionId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMessage, setAnalyzeMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch inferred entities
  // ---------------------------------------------------------------------------
  async function fetchEntities() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/inferred-entities');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setEntities(Array.isArray(data) ? data : data.entities ?? []);
    } catch (err: any) {
      setError(err.message || 'Failed to load inferred entities.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEntities();
  }, []);

  // ---------------------------------------------------------------------------
  // Run analysis
  // ---------------------------------------------------------------------------
  async function handleRunAnalysis() {
    try {
      setAnalyzing(true);
      setAnalyzeMessage(null);
      const res = await apiFetch('/admin/inferred-entities/analyze', {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setAnalyzeMessage({
        type: 'success',
        text: 'Pattern analysis triggered successfully. New proposals may appear shortly.',
      });
      await fetchEntities();
    } catch (err: any) {
      setAnalyzeMessage({
        type: 'error',
        text: err.message || 'Failed to trigger analysis.',
      });
    } finally {
      setAnalyzing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Approve / reject
  // ---------------------------------------------------------------------------
  async function handleAction(id: string, action: 'approve' | 'reject') {
    try {
      setActionId(id);
      const res = await apiFetch(`/admin/inferred-entities/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setEntities((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, status: action === 'approve' ? 'confirmed' : 'rejected' }
            : e,
        ),
      );
    } catch (err: any) {
      setError(err.message || `Failed to ${action} entity.`);
    } finally {
      setActionId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function formatConfidence(confidence: number): string {
    return `${(confidence * 100).toFixed(1)}%`;
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-8">Inferred Entities</h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">Loading inferred entities...</span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Inferred Entities</h1>
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mt-1">
            Review entity proposals discovered by pattern analysis.
          </p>
        </div>
        <button
          onClick={handleRunAnalysis}
          disabled={analyzing}
          className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
            analyzing
              ? 'bg-iron-400 cursor-not-allowed'
              : 'bg-iron-600 hover:bg-iron-700'
          }`}
        >
          {analyzing ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Analyzing...
            </span>
          ) : (
            'Run Analysis'
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {/* Analysis feedback */}
      {analyzeMessage && (
        <div
          className={`mb-6 p-3 rounded-lg text-sm font-medium ${
            analyzeMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
          }`}
        >
          {analyzeMessage.text}
        </div>
      )}

      {/* Entities table */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        {entities.length === 0 ? (
          <p className="text-sm text-[#6e6e73] dark:text-[#86868b] text-center py-8">
            No inferred entities found. Click &quot;Run Analysis&quot; to discover patterns.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-left">
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Inferred Type</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Confidence</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Evidence</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">Status</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b]">First Seen</th>
                  <th className="pb-3 font-medium text-[#6e6e73] dark:text-[#86868b] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#38383a]/60">
                {entities.map((entity) => (
                  <tr key={entity.id} className="bg-[#f5f5f7] dark:bg-[#2c2c2e]/50">
                    <td className="py-3 pr-4">
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{entity.inferredType}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-[#d2d2d7]/40 dark:bg-[#38383a] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              entity.confidence >= 0.8
                                ? 'bg-green-500'
                                : entity.confidence >= 0.5
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${entity.confidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                          {formatConfidence(entity.confidence)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                      {entity.evidenceCount}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${
                          STATUS_STYLES[entity.status] ?? ''
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            STATUS_DOT[entity.status] ?? 'bg-[#86868b]'
                          }`}
                        />
                        {entity.status.charAt(0).toUpperCase() + entity.status.slice(1)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                      {new Date(entity.firstSeenAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      {entity.status === 'pending' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleAction(entity.id, 'approve')}
                            disabled={actionId === entity.id}
                            className="bg-green-600 hover:bg-green-700 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionId === entity.id ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleAction(entity.id, 'reject')}
                            disabled={actionId === entity.id}
                            className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionId === entity.id ? '...' : 'Reject'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-[#86868b] dark:text-[#636366]">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
