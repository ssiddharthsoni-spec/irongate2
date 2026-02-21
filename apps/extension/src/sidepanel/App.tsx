import React, { useState, useEffect, useCallback } from 'react';
import type { SensitivityScore, DetectedEntity, AIToolId } from '@iron-gate/types';

interface ActivityItem {
  id: string;
  aiTool: AIToolId;
  score: number;
  level: string;
  entityCount: number;
  timestamp: string;
  isDocument?: boolean;
  fileName?: string;
}

interface EntityFeedback {
  entityIndex: number;
  feedbackType: 'correct' | 'not_pii' | 'wrong_type' | 'partial_match';
  correctedType?: string;
}

interface ConnectionState {
  connected: boolean;
  firmId: string | null;
  firmName: string | null;
}

const ENTITY_TYPES = [
  'PERSON', 'ORGANIZATION', 'EMAIL', 'PHONE_NUMBER', 'SSN', 'CREDIT_CARD',
  'IP_ADDRESS', 'MONETARY_AMOUNT', 'MATTER_NUMBER', 'PRIVILEGE_MARKER',
  'API_KEY', 'DATABASE_URI', 'AUTH_TOKEN', 'PRIVATE_KEY', 'AWS_CREDENTIAL',
];

const DEFAULT_API_URL = 'https://irongate-api.onrender.com/v1';

export function App() {
  const [status, setStatus] = useState<'idle' | 'monitoring' | 'error'>('idle');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [lastScore, setLastScore] = useState<SensitivityScore | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<number | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Set<number>>(new Set());

  // Connection / settings state
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiUrlDraft, setApiUrlDraft] = useState(DEFAULT_API_URL);
  const [connection, setConnection] = useState<ConnectionState>({
    connected: false,
    firmId: null,
    firmName: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<'audit' | 'proxy'>('audit');

  // Load saved API URL and connection state on mount
  useEffect(() => {
    chrome.storage.local.get(['apiBaseUrl', 'connectionState', 'firmMode'], (result) => {
      if (result.apiBaseUrl) {
        setApiUrl(result.apiBaseUrl);
        setApiUrlDraft(result.apiBaseUrl);
      }
      if (result.connectionState) {
        setConnection(result.connectionState);
      }
      if (result.firmMode) {
        setMode(result.firmMode);
      }
    });
  }, []);

  // Attempt to connect to the Iron Gate API
  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);

    const url = apiUrlDraft.replace(/\/+$/, '');

    try {
      // Health endpoint is at the root, not under /v1
      const baseUrl = url.replace(/\/v1\/?$/, '');
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        throw new Error(`Server responded with ${res.status}`);
      }

      const data = await res.json();

      const newConnection: ConnectionState = {
        connected: true,
        firmId: data.firmId || null,
        firmName: data.firmName || null,
      };

      // Persist to chrome.storage
      await chrome.storage.local.set({
        apiBaseUrl: url,
        connectionState: newConnection,
      });

      setApiUrl(url);
      setConnection(newConnection);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connection failed';
      setConnectError(message);
      setConnection({ connected: false, firmId: null, firmName: null });
      await chrome.storage.local.set({
        apiBaseUrl: url,
        connectionState: { connected: false, firmId: null, firmName: null },
      });
      setApiUrl(url);
    } finally {
      setConnecting(false);
    }
  }, [apiUrlDraft]);

  // Disconnect
  const handleDisconnect = useCallback(async () => {
    const cleared: ConnectionState = { connected: false, firmId: null, firmName: null };
    setConnection(cleared);
    await chrome.storage.local.set({ connectionState: cleared });
  }, []);

  // Toggle mode and notify service worker
  const handleModeToggle = useCallback(async () => {
    const newMode = mode === 'audit' ? 'proxy' : 'audit';
    setMode(newMode);
    await chrome.storage.local.set({ firmMode: newMode });

    try {
      await chrome.runtime.sendMessage({
        type: 'MODE_CHANGED',
        payload: { mode: newMode },
      });
    } catch (err) {
      console.warn('[Iron Gate] Failed to send MODE_CHANGED:', err);
    }
  }, [mode]);

  const sendEntityFeedback = useCallback(async (
    entityIndex: number,
    feedbackType: EntityFeedback['feedbackType'],
    correctedType?: string,
  ) => {
    if (!lastScore) return;
    const entity = lastScore.entities[entityIndex];
    if (!entity) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'ENTITY_FEEDBACK',
        payload: {
          entityType: entity.type,
          entityText: entity.text,
          isCorrect: feedbackType === 'correct',
          feedbackType,
          correctedType,
        },
      });

      setFeedbackSent((prev) => new Set(prev).add(entityIndex));
      setFeedbackOpen(null);
    } catch (err) {
      console.warn('[Iron Gate] Failed to send feedback:', err);
    }
  }, [lastScore]);

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

      if (message.type === 'FILE_SCAN_RESULT') {
        const p = message.payload;
        setRecentActivity((prev) => [
          {
            id: crypto.randomUUID(),
            aiTool: p.aiToolId || 'document',
            score: p.score,
            level: p.level,
            entityCount: p.entitiesFound || 0,
            timestamp: new Date().toISOString(),
            isDocument: true,
            fileName: p.fileName,
          },
          ...prev.slice(0, 49),
        ]);
      }
    });
  }, []);

  // -- Not connected: show Connect form --
  if (!connection.connected) {
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

        {/* Connect form */}
        <div className="bg-white rounded-lg p-4 shadow-sm border">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            Connect to your Iron Gate instance
          </h2>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            API URL
          </label>
          <input
            type="url"
            value={apiUrlDraft}
            onChange={(e) => setApiUrlDraft(e.target.value)}
            placeholder="http://localhost:3001"
            className="w-full px-3 py-2 text-sm border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 mb-3"
          />
          {connectError && (
            <p className="text-xs text-red-600 mb-2">{connectError}</p>
          )}
          <button
            onClick={handleConnect}
            disabled={connecting || !apiUrlDraft.trim()}
            className="w-full py-2 px-4 text-sm font-medium text-white bg-iron-600 rounded-md hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-400">
            Iron Gate v0.1.0 -- Phase 1: Shadow AI Auditor
          </p>
        </div>
      </div>
    );
  }

  // -- Connected: show main UI with settings panel --
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">IG</span>
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">Iron Gate</h1>
          <p className="text-xs text-gray-500">AI Governance Monitor</p>
        </div>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Collapsible Settings Panel */}
      {settingsOpen && (
        <div className="bg-white rounded-lg p-3 mb-4 shadow-sm border">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Settings
          </h2>

          {/* API URL */}
          <label className="block text-xs font-medium text-gray-500 mb-1">
            API URL
          </label>
          <div className="flex gap-2 mb-3">
            <input
              type="url"
              value={apiUrlDraft}
              onChange={(e) => setApiUrlDraft(e.target.value)}
              className="flex-1 px-2 py-1.5 text-xs border rounded-md bg-gray-50 focus:outline-none focus:ring-1 focus:ring-iron-500"
            />
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="px-2.5 py-1.5 text-xs font-medium text-iron-700 bg-iron-50 border border-iron-200 rounded-md hover:bg-iron-100 disabled:opacity-50 transition-colors"
            >
              {connecting ? '...' : 'Save'}
            </button>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-600">Connected</span>
            {connection.firmId && (
              <span className="text-xs text-gray-400 ml-auto font-mono truncate max-w-[120px]" title={connection.firmId}>
                {connection.firmId.slice(0, 8)}...
              </span>
            )}
          </div>
          {connection.firmName && (
            <div className="text-xs text-gray-500 mb-3">
              Firm: <span className="font-medium text-gray-700">{connection.firmName}</span>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">Mode</span>
            <button
              onClick={handleModeToggle}
              className={`relative inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                mode === 'audit'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {mode === 'audit' ? 'Audit' : 'Proxy'}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mb-2">
            {mode === 'audit'
              ? 'Passively monitors prompts without modification.'
              : 'Intercepts and redacts sensitive data before it reaches AI tools.'}
          </p>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="w-full mt-1 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}

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
          <span className={`ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
            mode === 'audit' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {mode.toUpperCase()}
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
          {/* Entity pills with feedback */}
          <div className="flex flex-wrap gap-1 mt-3">
            {lastScore.entities.map((entity, i) => (
              <div key={i} className="relative">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                    feedbackSent.has(i)
                      ? 'bg-green-100 text-green-700'
                      : 'bg-iron-100 text-iron-700'
                  }`}
                >
                  {entity.type}
                  {!feedbackSent.has(i) && (
                    <>
                      <button
                        onClick={() => sendEntityFeedback(i, 'correct')}
                        className="ml-0.5 hover:text-green-600"
                        title="Correct detection"
                      >
                        +
                      </button>
                      <button
                        onClick={() => setFeedbackOpen(feedbackOpen === i ? null : i)}
                        className="hover:text-red-600"
                        title="Incorrect detection"
                      >
                        -
                      </button>
                    </>
                  )}
                  {feedbackSent.has(i) && (
                    <span title="Feedback sent">&#10003;</span>
                  )}
                </span>
                {/* Feedback dropdown */}
                {feedbackOpen === i && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border z-10 py-1">
                    <button
                      onClick={() => sendEntityFeedback(i, 'not_pii')}
                      className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Not PII
                    </button>
                    <button
                      onClick={() => sendEntityFeedback(i, 'partial_match')}
                      className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Partial match
                    </button>
                    <div className="border-t my-1" />
                    <p className="px-3 py-1 text-xs text-gray-400">Wrong type -- correct to:</p>
                    {ENTITY_TYPES.filter((t) => t !== entity.type).slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => sendEntityFeedback(i, 'wrong_type', type)}
                        className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {item.isDocument && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700">
                        DOC
                      </span>
                    )}
                    <span className="text-xs font-medium text-gray-600 truncate">
                      {item.isDocument && item.fileName ? item.fileName : item.aiTool}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {item.entityCount} entities
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
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
          Iron Gate v0.1.0 -- Phase 1: Shadow AI Auditor
        </p>
      </div>
    </div>
  );
}
