import React, { useState, useEffect } from 'react';
import type { SensitivityScore, DetectedEntity, AIToolId } from '@iron-gate/types';

interface ActivityItem {
  id: string;
  aiTool: AIToolId;
  score: number;
  level: string;
  entityCount: number;
  timestamp: string;
}

export function App() {
  const [status, setStatus] = useState<'idle' | 'monitoring' | 'error'>('idle');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [lastScore, setLastScore] = useState<SensitivityScore | null>(null);

  useEffect(() => {
    // Check current tab for AI tool
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
          if (response?.active) {
            setStatus('monitoring');
            setCurrentTool(response.aiToolName);
          }
        });
      }
    });

    // Listen for detection results from service worker
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SENSITIVITY_SCORE') {
        setLastScore(message.payload);
        setRecentActivity((prev) => [
          {
            id: crypto.randomUUID(),
            aiTool: message.payload.aiToolId || 'generic',
            score: message.payload.score,
            level: message.payload.level,
            entityCount: message.payload.entities?.length || 0,
            timestamp: new Date().toISOString(),
          },
          ...prev.slice(0, 49),
        ]);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">IG</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Iron Gate</h1>
          <p className="text-xs text-gray-500">AI Governance Monitor</p>
        </div>
      </div>

      {/* Status */}
      <div className="bg-white rounded-lg p-3 mb-4 shadow-sm border">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              status === 'monitoring'
                ? 'bg-green-500 animate-pulse'
                : status === 'error'
                ? 'bg-red-500'
                : 'bg-gray-300'
            }`}
          />
          <span className="text-sm font-medium text-gray-700">
            {status === 'monitoring'
              ? `Monitoring ${currentTool}`
              : status === 'error'
              ? 'Error'
              : 'Not on an AI tool page'}
          </span>
        </div>
      </div>

      {/* Current Score */}
      {lastScore && (
        <div className="bg-white rounded-lg p-4 mb-4 shadow-sm border">
          <h2 className="text-sm font-medium text-gray-500 mb-2">Last Detection</h2>
          <div className="flex items-center gap-3">
            <div
              className={`text-3xl font-bold ${
                lastScore.level === 'critical'
                  ? 'text-risk-critical'
                  : lastScore.level === 'high'
                  ? 'text-risk-high'
                  : lastScore.level === 'medium'
                  ? 'text-risk-medium'
                  : 'text-risk-low'
              }`}
            >
              {lastScore.score}
            </div>
            <div>
              <div className="text-sm font-medium capitalize">{lastScore.level} Risk</div>
              <div className="text-xs text-gray-500">
                {lastScore.entities.length} entities detected
              </div>
            </div>
          </div>
          {lastScore.explanation && (
            <p className="text-xs text-gray-600 mt-2">{lastScore.explanation}</p>
          )}
          {/* Entity pills */}
          <div className="flex flex-wrap gap-1 mt-3">
            {lastScore.entities.map((entity, i) => (
              <span
                key={i}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-iron-100 text-iron-700"
              >
                {entity.type}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-sm border">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-medium text-gray-700">Recent Activity</h2>
        </div>
        <div className="divide-y max-h-96 overflow-y-auto">
          {recentActivity.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-400">
              No activity yet. Start using an AI tool to see detections.
            </div>
          ) : (
            recentActivity.map((item) => (
              <div key={item.id} className="px-4 py-2 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-gray-600">{item.aiTool}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {item.entityCount} entities
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      item.level === 'critical'
                        ? 'text-risk-critical'
                        : item.level === 'high'
                        ? 'text-risk-high'
                        : item.level === 'medium'
                        ? 'text-risk-medium'
                        : 'text-risk-low'
                    }`}
                  >
                    {item.score}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 text-center">
        <p className="text-xs text-gray-400">
          Iron Gate v0.1.0 — Phase 1: Shadow AI Auditor
        </p>
      </div>
    </div>
  );
}
