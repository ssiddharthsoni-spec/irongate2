'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useApiClient } from '../../lib/api';

interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: string;
}

interface ScanResult {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  entities: DetectedEntity[];
  entitiesFound: number;
  score: number;
  level: string;
  breakdown: {
    entityScore: number;
    volumeScore: number;
    contextScore: number;
    legalBoost: number;
  };
  explanation: string;
  redactedText: string;
  entitiesRedacted: number;
  eventId: string;
}

const levelColors: Record<string, string> = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const levelBorderColors: Record<string, string> = {
  low: 'border-green-200 dark:border-green-800',
  medium: 'border-yellow-200 dark:border-yellow-800',
  high: 'border-orange-200 dark:border-orange-800',
  critical: 'border-red-200 dark:border-red-800',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ScanPage() {
  const { apiFetchRaw } = useApiClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleScan = useCallback(async (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['pdf', 'docx', 'xlsx'].includes(extension)) {
      setError(`Unsupported file type ".${extension}". Supported: PDF, DOCX, XLSX.`);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(`File too large (${formatFileSize(file.size)}). Maximum: 10 MB.`);
      return;
    }

    try {
      setScanning(true);
      setError(null);
      setResult(null);

      const formData = new FormData();
      formData.append('file', file);

      const response = await apiFetchRaw('/documents/scan', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server responded with ${response.status}`);
      }

      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to scan document.');
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [apiFetchRaw]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleScan(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleScan(file);
  }

  function handleDownloadRedacted() {
    if (!result) return;
    const blob = new Blob([result.redactedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.fileName.replace(/\.[^/.]+$/, '')}_redacted.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Group entities by type for the summary
  const entityGroups = result
    ? result.entities.reduce<Record<string, number>>((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Document Scanner</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload a document to scan for sensitive information. Supports PDF, Word, and Excel files.
        </p>
      </div>

      {/* Upload Zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragOver
            ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
        } ${scanning ? 'opacity-60 pointer-events-none' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx"
          onChange={handleFileChange}
          aria-label="Select a document to scan"
          className="hidden"
        />

        {scanning ? (
          <div className="flex flex-col items-center gap-3">
            <svg className="animate-spin h-8 w-8 text-iron-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-sm text-gray-600 dark:text-gray-400">Scanning document for sensitive information...</p>
          </div>
        ) : (
          <>
            <svg className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9.75m3 0v3.375m0-3.375h3.375M6.75 15.75h.008v.008H6.75v-.008Zm0 3h.008v.008H6.75v-.008ZM6.75 12h.008v.008H6.75V12Zm0-3h.008v.008H6.75V9Zm12-3.75V5.625c0-1.036-.84-1.875-1.875-1.875h-3.75A1.875 1.875 0 0 0 11.25 5.625V7.5m8.25 3.75v4.5a1.875 1.875 0 0 1-1.875 1.875H6.375A1.875 1.875 0 0 1 4.5 15.75v-4.5" />
            </svg>
            <p className="text-gray-600 dark:text-gray-400 mb-2">Drag and drop a file here, or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-iron-600 text-white rounded-lg text-sm font-medium hover:bg-iron-700 transition-colors"
            >
              Browse Files
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">PDF, DOCX, or XLSX up to 10 MB</p>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center justify-between gap-3">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline flex-shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-6 space-y-6">
          {/* Summary Card */}
          <div className={`bg-white dark:bg-gray-800 border rounded-xl p-6 ${levelBorderColors[result.level] || 'border-gray-200 dark:border-gray-700'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{result.fileName}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {result.fileType.toUpperCase()} &middot; {formatFileSize(result.fileSize)} &middot; {result.textLength.toLocaleString()} characters extracted
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${levelColors[result.level] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                  {result.level.toUpperCase()}
                </span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{result.score}</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">/100</span>
              </div>
            </div>
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">{result.explanation}</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Entities Found</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{result.entitiesFound}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Entities Redacted</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{result.entitiesRedacted}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Entity Score</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{result.breakdown.entityScore}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">Legal Boost</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{result.breakdown.legalBoost}</p>
            </div>
          </div>

          {/* Score Breakdown */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Score Breakdown</h3>
            <div className="space-y-3">
              {[
                { label: 'Entity Detection', value: result.breakdown.entityScore, max: 70, color: 'bg-blue-500' },
                { label: 'Document Volume', value: result.breakdown.volumeScore, max: 20, color: 'bg-purple-500' },
                { label: 'Context Keywords', value: result.breakdown.contextScore, max: 25, color: 'bg-amber-500' },
                { label: 'Legal Boost', value: result.breakdown.legalBoost, max: 25, color: 'bg-red-500' },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span>{item.label}</span>
                    <span>{item.value} / {item.max}</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.color} rounded-full transition-all`}
                      style={{ width: `${Math.min(100, (item.value / item.max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Entity Groups */}
          {Object.keys(entityGroups).length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Detected Entity Types</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(entityGroups)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <span key={type} className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">
                      {type.replace(/_/g, ' ')} ({count})
                    </span>
                  ))}
              </div>
            </div>
          )}

          {/* Entity Table */}
          {result.entities.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Detected Entities</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Matched Text</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {result.entities.slice(0, 50).map((entity, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2">
                          <span className="px-2 py-0.5 bg-iron-50 text-iron-700 dark:bg-iron-900/30 dark:text-iron-300 rounded text-xs font-medium">
                            {entity.type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-gray-700 dark:text-gray-300 font-mono text-xs max-w-xs truncate" title={entity.text}>
                          {entity.text.length > 60 ? entity.text.slice(0, 60) + '...' : entity.text}
                        </td>
                        <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                          {(entity.confidence * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.entities.length > 50 && (
                  <p className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                    Showing first 50 of {result.entities.length} entities
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Redacted Text Preview + Download */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Redacted Document</h3>
              <button
                onClick={handleDownloadRedacted}
                className="px-3 py-1.5 bg-iron-600 text-white rounded-lg text-xs font-medium hover:bg-iron-700 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download Redacted
              </button>
            </div>
            <pre className="p-4 text-xs text-gray-700 dark:text-gray-300 font-mono whitespace-pre-wrap max-h-96 overflow-y-auto bg-gray-50 dark:bg-gray-900">
              {result.redactedText.length > 5000
                ? result.redactedText.slice(0, 5000) + '\n\n--- Preview truncated (download for full version) ---'
                : result.redactedText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
