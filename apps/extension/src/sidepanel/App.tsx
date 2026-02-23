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

interface PromptInspectorData {
  originalPrompt: string;
  maskedPrompt: string;
  pseudonymMappings: Array<{ original: string; pseudonym: string; type: string }>;
}

export function App() {
  const [status, setStatus] = useState<'idle' | 'monitoring' | 'error'>('idle');
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [lastScore, setLastScore] = useState<SensitivityScore | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<number | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Set<number>>(new Set());

  // Prompt Inspector state
  const [inspectorData, setInspectorData] = useState<PromptInspectorData | null>(null);
  const [inspectorView, setInspectorView] = useState<'original' | 'masked' | 'mappings'>('original');
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [copiedSafe, setCopiedSafe] = useState(false);

  const handleCopySafe = useCallback(async () => {
    if (!inspectorData?.maskedPrompt) return;
    try {
      await navigator.clipboard.writeText(inspectorData.maskedPrompt);
      setCopiedSafe(true);
      setTimeout(() => setCopiedSafe(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = inspectorData.maskedPrompt;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedSafe(true);
      setTimeout(() => setCopiedSafe(false), 2000);
    }
  }, [inspectorData?.maskedPrompt]);

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
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Load saved state on mount (API URL, connection, mode, recent activity, API key)
  useEffect(() => {
    chrome.storage.local.get(['apiBaseUrl', 'connectionState', 'firmMode', 'recentActivity', 'lastScore', 'ironGateApiKey'], (result) => {
      if (result.ironGateApiKey) {
        setApiKeyDraft(result.ironGateApiKey);
        setApiKeySaved(true);
      }
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
      if (result.recentActivity && Array.isArray(result.recentActivity)) {
        setRecentActivity(result.recentActivity);
      }
      if (result.lastScore) {
        setLastScore(result.lastScore);
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
        signal: AbortSignal.timeout(10000),
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
    // Check current tab for AI tool — with retry since content script may not be ready yet
    function checkCurrentTab() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
            // Suppress errors when content script isn't available
            if (chrome.runtime.lastError) return;
            if (response?.active) {
              setStatus('monitoring');
              setCurrentTool(response.aiToolName || response.aiTool || 'AI Tool');
            } else {
              setStatus('idle');
              setCurrentTool(null);
            }
          });
        }
      });
    }

    // Check immediately, then retry a few times (content script may load after sidepanel)
    checkCurrentTab();
    const retryTimers = [
      setTimeout(checkCurrentTab, 1000),
      setTimeout(checkCurrentTab, 3000),
      setTimeout(checkCurrentTab, 5000),
    ];

    // Also re-check when the active tab changes
    const tabListener = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === 'complete') {
        setTimeout(checkCurrentTab, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(tabListener);

    const activatedListener = () => {
      setTimeout(checkCurrentTab, 300);
    };
    chrome.tabs.onActivated.addListener(activatedListener);

    // Listen for detection results from service worker AND content scripts
    const messageListener = (message: any) => {
      if (message.type === 'SENSITIVITY_SCORE') {
        const newScore = message.payload;
        setLastScore(newScore);
        setFeedbackSent(new Set());
        setFeedbackOpen(null);

        const newItem = {
          id: crypto.randomUUID(),
          aiTool: newScore.aiToolId || 'generic',
          score: newScore.score,
          level: newScore.level,
          entityCount: newScore.entities?.length || newScore.pseudonymMappings?.length || 0,
          timestamp: new Date().toISOString(),
        };

        setRecentActivity((prev) => {
          const updated = [newItem, ...prev.slice(0, 49)];
          // Persist to storage so it survives sidepanel reopens
          chrome.storage.local.set({
            recentActivity: updated.slice(0, 20),
            lastScore: newScore,
          });
          return updated;
        });

        // Update Prompt Inspector data if available
        if (newScore.originalPrompt) {
          setInspectorData({
            originalPrompt: newScore.originalPrompt,
            maskedPrompt: newScore.maskedPrompt,
            pseudonymMappings: newScore.pseudonymMappings || [],
          });
          setInspectorOpen(true);
        }
      }

      if (message.type === 'FILE_SCAN_RESULT') {
        const p = message.payload;
        setRecentActivity((prev) => {
          const updated = [
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
          ];
          chrome.storage.local.set({ recentActivity: updated.slice(0, 20) });
          return updated;
        });
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      retryTimers.forEach(clearTimeout);
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.tabs.onUpdated.removeListener(tabListener);
      chrome.tabs.onActivated.removeListener(activatedListener);
    };
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
            placeholder="https://irongate-api.onrender.com/v1"
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

          {/* API Key */}
          <label className="block text-xs font-medium text-gray-500 mb-1">
            API Key
          </label>
          <div className="flex gap-2 mb-3">
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => { setApiKeyDraft(e.target.value); setApiKeySaved(false); }}
              placeholder="ig_xxxxxxxxxxxx..."
              className="flex-1 px-2 py-1.5 text-xs border rounded-md bg-gray-50 focus:outline-none focus:ring-1 focus:ring-iron-500 font-mono"
            />
            <button
              onClick={() => {
                chrome.runtime.sendMessage({
                  type: 'SET_API_KEY',
                  payload: { apiKey: apiKeyDraft },
                }).catch(() => {});
                setApiKeySaved(true);
                setTimeout(() => setApiKeySaved(false), 2000);
              }}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                apiKeySaved
                  ? 'text-green-700 bg-green-50 border border-green-200'
                  : 'text-iron-700 bg-iron-50 border border-iron-200 hover:bg-iron-100'
              }`}
            >
              {apiKeySaved ? 'Saved' : 'Save'}
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mb-3">
            Get your API key from the <a href="https://irongate-dashboard.vercel.app/admin" target="_blank" rel="noopener" className="text-iron-600 underline">admin dashboard</a>.
          </p>

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
          <button
            onClick={handleModeToggle}
            className={`ml-auto inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
              mode === 'audit'
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
            }`}
            title={`Click to switch to ${mode === 'audit' ? 'PROXY' : 'AUDIT'} mode`}
          >
            {mode.toUpperCase()}
          </button>
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

      {/* Prompt Inspector */}
      {inspectorData && (
        <div className="bg-white rounded-lg mb-4 shadow-sm border">
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className="w-full px-4 py-3 flex items-center justify-between border-b hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-iron-600" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
              <h2 className="text-sm font-medium text-gray-700">Prompt Inspector</h2>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-gray-400 transition-transform ${inspectorOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Copy Safe Version — prominent button */}
          {inspectorData?.maskedPrompt && (
            <div className="px-3 py-2 border-t bg-green-50">
              <button
                onClick={handleCopySafe}
                className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all ${
                  copiedSafe
                    ? 'bg-green-600 text-white'
                    : 'bg-green-700 text-white hover:bg-green-800 active:scale-[0.98]'
                }`}
              >
                {copiedSafe ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Copied to Clipboard!
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                    </svg>
                    Copy Safe Version to Share
                  </>
                )}
              </button>
              <p className="text-[10px] text-green-600 text-center mt-1">
                All sensitive data replaced with pseudonyms — safe for external sharing
              </p>
            </div>
          )}

          {inspectorOpen && (
            <div>
              {/* Tab bar */}
              <div className="flex border-b">
                <button
                  onClick={() => setInspectorView('original')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    inspectorView === 'original'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  What You Sent
                </button>
                <button
                  onClick={() => setInspectorView('masked')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    inspectorView === 'masked'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  What LLM Receives
                </button>
                <button
                  onClick={() => setInspectorView('mappings')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    inspectorView === 'mappings'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Mappings
                </button>
              </div>

              {/* Content */}
              <div className="p-3 max-h-64 overflow-y-auto">
                {inspectorView === 'original' && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Original prompt (with sensitive data)</p>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words bg-red-50 border border-red-100 rounded-md p-2.5 leading-relaxed font-mono">
                      {inspectorData.originalPrompt}
                    </pre>
                  </div>
                )}

                {inspectorView === 'masked' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">Pseudonymized version (safe for LLM)</p>
                      <button
                        onClick={handleCopySafe}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          copiedSafe
                            ? 'bg-green-600 text-white'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                        title="Copy safe version to clipboard"
                      >
                        {copiedSafe ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words bg-green-50 border border-green-100 rounded-md p-2.5 leading-relaxed font-mono">
                      {inspectorData.maskedPrompt}
                    </pre>
                  </div>
                )}

                {inspectorView === 'mappings' && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Entity pseudonym mappings</p>
                    {inspectorData.pseudonymMappings.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No entities detected to pseudonymize.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {inspectorData.pseudonymMappings.map((m, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded-md px-2.5 py-1.5 border">
                            <span className="font-mono text-red-600 line-through">{m.original}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                            <span className="font-mono text-green-700 font-medium">{m.pseudonym}</span>
                            <span className="ml-auto text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{m.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
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
