'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface WeightOverride {
  id: string;
  firmId: string;
  entityType: string;
  weightMultiplier: number;
  sampleCount: number;
  falsePositiveRate: number;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Default weights (displayed when no server override exists)
// ---------------------------------------------------------------------------
const DEFAULT_WEIGHTS: Record<string, number> = {
  PERSON: 10,
  ORGANIZATION: 8,
  EMAIL: 12,
  PHONE_NUMBER: 15,
  SSN: 40,
  CREDIT_CARD: 30,
  IP_ADDRESS: 8,
  MONETARY_AMOUNT: 12,
  MATTER_NUMBER: 20,
  CLIENT_MATTER_PAIR: 25,
  PRIVILEGE_MARKER: 30,
  DEAL_CODENAME: 20,
  OPPOSING_COUNSEL: 15,
  API_KEY: 50,
  DATABASE_URI: 50,
  AUTH_TOKEN: 45,
  PRIVATE_KEY: 50,
  AWS_CREDENTIAL: 50,
};

const ENTITY_TYPES = Object.keys(DEFAULT_WEIGHTS);

// Maximum weight used to normalise the coloured bar widths
const MAX_WEIGHT = 50;

// ---------------------------------------------------------------------------
// Categorise entity types for visual grouping
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string[]> = {
  'PII & Identity': ['PERSON', 'ORGANIZATION', 'EMAIL', 'PHONE_NUMBER', 'SSN', 'CREDIT_CARD', 'IP_ADDRESS', 'MONETARY_AMOUNT'],
  'Legal & Matter': ['MATTER_NUMBER', 'CLIENT_MATTER_PAIR', 'PRIVILEGE_MARKER', 'DEAL_CODENAME', 'OPPOSING_COUNSEL'],
  'Secrets & Credentials': ['API_KEY', 'DATABASE_URI', 'AUTH_TOKEN', 'PRIVATE_KEY', 'AWS_CREDENTIAL'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatEntityType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function weightBarColor(weight: number): string {
  if (weight >= 40) return 'bg-red-500';
  if (weight >= 25) return 'bg-orange-500';
  if (weight >= 15) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function fpRateColor(rate: number): string {
  if (rate > 0.2) return 'text-red-600';
  if (rate > 0.1) return 'text-yellow-600';
  return 'text-green-600';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WeightsPage() {
  const { apiFetch } = useApiClient();

  const [overrides, setOverrides] = useState<WeightOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local edits: entityType -> current slider value
  const [localWeights, setLocalWeights] = useState<Record<string, number>>({});
  // Track which rows have unsaved changes
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  // Per-row saving / resetting state
  const [savingType, setSavingType] = useState<string | null>(null);
  const [resettingType, setResettingType] = useState<string | null>(null);
  // Per-row success feedback
  const [savedType, setSavedType] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch overrides
  // ---------------------------------------------------------------------------
  const fetchOverrides = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch('/admin/weight-overrides');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      const list: WeightOverride[] = Array.isArray(data)
        ? data
        : data.overrides ?? [];
      setOverrides(list);

      // Seed local weights from overrides (or defaults)
      const initial: Record<string, number> = {};
      for (const et of ENTITY_TYPES) {
        const match = list.find((o) => o.entityType === et);
        initial[et] = match ? match.weightMultiplier : DEFAULT_WEIGHTS[et];
      }
      setLocalWeights(initial);
      setDirty({});
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to load weight overrides.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers to resolve override data for a given entity type
  // ---------------------------------------------------------------------------
  function getOverride(entityType: string): WeightOverride | undefined {
    return overrides.find((o) => o.entityType === entityType);
  }

  function hasOverride(entityType: string): boolean {
    return overrides.some((o) => o.entityType === entityType);
  }

  // ---------------------------------------------------------------------------
  // Change handler for slider / number input
  // ---------------------------------------------------------------------------
  function handleWeightChange(entityType: string, value: number) {
    const clamped = Math.round(Math.min(3.0, Math.max(0.1, value)) * 10) / 10;
    setLocalWeights((prev) => ({ ...prev, [entityType]: clamped }));

    // Mark dirty if value differs from server state
    const override = getOverride(entityType);
    const serverValue = override ? override.weightMultiplier : DEFAULT_WEIGHTS[entityType];
    setDirty((prev) => ({ ...prev, [entityType]: clamped !== serverValue }));
  }

  // ---------------------------------------------------------------------------
  // Save a single row
  // ---------------------------------------------------------------------------
  async function handleSave(entityType: string) {
    const weight = localWeights[entityType];
    if (weight === undefined) return;

    try {
      setSavingType(entityType);
      setError(null);
      const res = await apiFetch('/admin/weight-overrides', {
        method: 'PUT',
        body: JSON.stringify({ entityType, weight }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setDirty((prev) => ({ ...prev, [entityType]: false }));
      // Re-fetch to pick up sampleCount, falsePositiveRate, lastUpdated, etc.
      await fetchOverrides();
      // Brief success flash
      setSavedType(entityType);
      setTimeout(() => setSavedType(null), 2000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : `Failed to update ${entityType}.`;
      setError(message);
    } finally {
      setSavingType(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Reset (remove override) for a single row
  // ---------------------------------------------------------------------------
  async function handleReset(entityType: string) {
    try {
      setResettingType(entityType);
      setError(null);
      const res = await apiFetch('/admin/weight-overrides', {
        method: 'PUT',
        body: JSON.stringify({ entityType, weight: DEFAULT_WEIGHTS[entityType] }),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      // Reset local value back to default
      setLocalWeights((prev) => ({
        ...prev,
        [entityType]: DEFAULT_WEIGHTS[entityType],
      }));
      setDirty((prev) => ({ ...prev, [entityType]: false }));
      await fetchOverrides();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : `Failed to reset ${entityType}.`;
      setError(message);
    } finally {
      setResettingType(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">
          Entity Weight Configuration
        </h1>
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
            <span className="text-sm text-gray-500">
              Loading weight overrides...
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Entity Weight Configuration
        </h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Weights determine how much each entity type contributes to the overall
          risk score of a scanned document. Higher weights cause the entity to
          have a greater impact on flagging content as sensitive. Adjust the
          multiplier to fine-tune detection sensitivity per entity type.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 p-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {/* Entity categories */}
      {Object.entries(CATEGORY_LABELS).map(([category, types]) => (
        <div key={category} className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {category}
          </h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left bg-gray-50/60">
                    <th className="px-4 py-3 font-medium text-gray-500 w-48">
                      Entity Type
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-24 text-center">
                      Weight
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500">
                      Relative Weight
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-28 text-right">
                      Samples
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-24 text-right">
                      FP Rate
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-32 text-right">
                      Last Updated
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-500 w-48 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {types.map((entityType) => {
                    const override = getOverride(entityType);
                    const isOverridden = hasOverride(entityType);
                    const currentWeight = localWeights[entityType] ?? DEFAULT_WEIGHTS[entityType];
                    const isDirty = dirty[entityType] ?? false;
                    const isSaving = savingType === entityType;
                    const isResetting = resettingType === entityType;
                    const justSaved = savedType === entityType;

                    return (
                      <tr
                        key={entityType}
                        className={`group transition-colors ${
                          isDirty ? 'bg-iron-50/40' : 'hover:bg-gray-50/50'
                        }`}
                      >
                        {/* Entity type name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {formatEntityType(entityType)}
                            </span>
                            {!isOverridden && (
                              <span className="text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                DEFAULT
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[11px] text-gray-400">
                            {entityType}
                          </span>
                        </td>

                        {/* Editable weight */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-center gap-1">
                            <input
                              type="number"
                              min={0.1}
                              max={3.0}
                              step={0.1}
                              value={currentWeight}
                              onChange={(e) =>
                                handleWeightChange(
                                  entityType,
                                  parseFloat(e.target.value) || 0.1,
                                )
                              }
                              className={`w-20 text-center rounded-lg border px-2 py-1.5 text-sm font-medium tabular-nums focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 ${
                                isOverridden
                                  ? 'border-gray-300 text-gray-900'
                                  : 'border-gray-200 text-gray-400'
                              }`}
                            />
                            <input
                              type="range"
                              min={0.1}
                              max={3.0}
                              step={0.1}
                              value={currentWeight}
                              onChange={(e) =>
                                handleWeightChange(
                                  entityType,
                                  parseFloat(e.target.value),
                                )
                              }
                              className="w-20 h-1 accent-iron-600 cursor-pointer"
                            />
                          </div>
                        </td>

                        {/* Visual weight bar */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${weightBarColor(
                                  currentWeight,
                                )}`}
                                style={{
                                  width: `${Math.min(
                                    (currentWeight / MAX_WEIGHT) * 100,
                                    100,
                                  )}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 tabular-nums w-8 text-right">
                              {currentWeight}
                            </span>
                          </div>
                        </td>

                        {/* Sample count */}
                        <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                          {override
                            ? override.sampleCount.toLocaleString()
                            : <span className="text-gray-300">--</span>}
                        </td>

                        {/* False positive rate */}
                        <td className="px-4 py-3 text-right">
                          {override ? (
                            <span
                              className={`text-xs font-medium ${fpRateColor(
                                override.falsePositiveRate,
                              )}`}
                            >
                              {(override.falsePositiveRate * 100).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">--</span>
                          )}
                        </td>

                        {/* Last updated */}
                        <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap text-xs">
                          {override
                            ? new Date(override.lastUpdated).toLocaleDateString()
                            : <span className="text-gray-300">--</span>}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {/* Save button */}
                            <button
                              onClick={() => handleSave(entityType)}
                              disabled={!isDirty || isSaving}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                justSaved
                                  ? 'bg-green-50 text-green-700 border border-green-200'
                                  : isDirty
                                    ? 'bg-iron-600 hover:bg-iron-700 text-white'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              }`}
                            >
                              {isSaving ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                  Saving
                                </span>
                              ) : justSaved ? (
                                'Saved'
                              ) : (
                                'Save'
                              )}
                            </button>

                            {/* Reset button */}
                            <button
                              onClick={() => handleReset(entityType)}
                              disabled={
                                (!isOverridden && !isDirty) || isResetting
                              }
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                isOverridden || isDirty
                                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                                  : 'bg-gray-50 text-gray-300 cursor-not-allowed'
                              }`}
                            >
                              {isResetting ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="w-3 h-3 border-2 border-gray-300/30 border-t-gray-500 rounded-full animate-spin" />
                                  Resetting
                                </span>
                              ) : (
                                'Reset'
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="mt-2 mb-8 bg-gray-50 rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Weight Bar Legend
        </h3>
        <div className="flex flex-wrap gap-4 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-blue-500" />
            <span>Low (&lt; 15)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-yellow-500" />
            <span>Medium (15 - 24)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-orange-500" />
            <span>High (25 - 39)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-red-500" />
            <span>Critical (40+)</span>
          </div>
          <span className="ml-auto text-gray-400">
            Weights range from 0.1 to 3.0. Default values shown when no override exists.
          </span>
        </div>
      </div>
    </div>
  );
}
