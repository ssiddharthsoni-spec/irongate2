import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SensitivityScore, DetectedEntity, AIToolId } from '@iron-gate/types';
import { loadApiKey, saveApiKey } from '../api-key-store';
import { OnboardingOverlay } from './OnboardingOverlay';
import { TrialBanner } from './TrialBanner';
import { UpgradePrompt } from './UpgradePrompt';
import { TrustPage } from './TrustPage';
import { GhostDetection } from './GhostDetection';
import {
  ONBOARDING_COMPLETED,
  SELECTED_INDUSTRIES,
  USER_EMAIL,
  DEVICE_ID,
  FIRM_ID,
  FIRM_CODE,
  FIRM_NAME,
  SUBSCRIPTION_TIER,
  SUBSCRIPTION_CACHED_AT,
  TRIAL_START_DATE,
  TRIAL_ENDS_AT,
  WEEKLY_SCAN_COUNT,
  TOTAL_ENTITIES_DETECTED,
  LAST_NOTIFICATION_DAY,
} from '../shared/storage-keys';

interface ActivityItem {
  id: string;
  aiTool: AIToolId;
  score: number;
  level: string;
  entityCount: number;
  timestamp: string;
  isDocument?: boolean;
  fileName?: string;
  ghostLabel?: 'SENSITIVE' | 'CRITICAL';
  ghostConfidence?: number;
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

interface DocumentScanData {
  fileName: string;
  fileType: string;
  fileSize: number;
  textLength: number;
  score: number;
  level: string;
  entitiesFound: number;
  explanation: string;
  entities: Array<{
    type: string;
    start: number;
    end: number;
    confidence: number;
    source: string;
    length: number;
  }>;
  breakdown: Record<string, number>;
  originalText: string;
  redactedText: string;
  entitiesRedacted: number;
}

interface PromptInspectorData {
  maskedPrompt: string;
  pseudonymMappings: Array<{ pseudonym: string; type: string; length: number }>;
}

export function App() {
  // Onboarding state — show new 5-screen overlay if not completed
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);

  useEffect(() => {
    async function check() {
      const result = await chrome.storage.local.get([ONBOARDING_COMPLETED]);
      if (result[ONBOARDING_COMPLETED] === true) {
        setOnboardingCompleted(true);
        return;
      }
      // Legacy users who already have an API key — skip onboarding
      const key = await loadApiKey();
      if (key) {
        await chrome.storage.local.set({ [ONBOARDING_COMPLETED]: true });
        setOnboardingCompleted(true);
        return;
      }
      setOnboardingCompleted(false);
    }
    check();
  }, []);

  // Sign out: clear all user data and return to onboarding
  // NOTE: this hook MUST be above the early return to avoid Rules of Hooks violation
  const handleSignOut = useCallback(async () => {
    // Clear API key (encrypted store)
    await saveApiKey('');

    // Clear all extension storage keys
    await chrome.storage.local.remove([
      ONBOARDING_COMPLETED,
      SELECTED_INDUSTRIES,
      USER_EMAIL,
      DEVICE_ID,
      FIRM_ID,
      FIRM_CODE,
      FIRM_NAME,
      SUBSCRIPTION_TIER,
      SUBSCRIPTION_CACHED_AT,
      TRIAL_START_DATE,
      TRIAL_ENDS_AT,
      WEEKLY_SCAN_COUNT,
      TOTAL_ENTITIES_DETECTED,
      LAST_NOTIFICATION_DAY,
      'connectionState',
      'apiBaseUrl',
      'firmMode',
      'ironGateApiKey',
      'ironGateApiKey_enc',
    ]);

    setOnboardingCompleted(false);
  }, []);

  // Show loading while checking onboarding status
  if (onboardingCompleted === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center animate-pulse">
          <span className="text-white font-bold text-sm">IG</span>
        </div>
      </div>
    );
  }

  // Show onboarding if not completed
  if (!onboardingCompleted) {
    return <OnboardingOverlay onComplete={() => setOnboardingCompleted(true)} />;
  }

  return <AppMain onSignOut={handleSignOut} />;
}

function AppMain({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [trustPageOpen, setTrustPageOpen] = useState(false);
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

  // Document Inspector state
  const [docScanData, setDocScanData] = useState<DocumentScanData | null>(null);
  const [docInspectorOpen, setDocInspectorOpen] = useState(true);
  const [docInspectorView, setDocInspectorView] = useState<'overview' | 'entities' | 'original' | 'redacted'>('overview');

  const [copiedSafe, setCopiedSafe] = useState(false);
  const [copiedDocSafe, setCopiedDocSafe] = useState(false);

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

  const handleCopyDocSafe = useCallback(async () => {
    if (!docScanData?.redactedText) return;
    try {
      await navigator.clipboard.writeText(docScanData.redactedText);
      setCopiedDocSafe(true);
      setTimeout(() => setCopiedDocSafe(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = docScanData.redactedText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedDocSafe(true);
      setTimeout(() => setCopiedDocSafe(false), 2000);
    }
  }, [docScanData?.redactedText]);

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
  const [mode, setMode] = useState<'audit' | 'proxy'>('proxy');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [protectionHealthy, setProtectionHealthy] = useState<boolean | null>(null);

  // Enterprise managed mode state
  const [isManaged, setIsManaged] = useState(false);
  const [managedFirmName, setManagedFirmName] = useState<string | null>(null);

  // Active tab tracking for multi-tab awareness
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const activeTabIdRef = useRef<number | null>(null);
  // Keep ref in sync with state (ref is readable inside closures without re-rendering)
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);

  // Load saved state on mount — check enterprise managed storage first
  useEffect(() => {
    async function loadConfig() {
      // Check for enterprise managed mode
      try {
        const managed = await chrome.storage.managed.get([
          'apiKey', 'apiUrl', 'firmMode', 'firmId', 'firmName',
        ]);
        if (managed?.apiKey) {
          setIsManaged(true);
          setManagedFirmName(managed.firmName || null);
          if (managed.apiUrl) { setApiUrl(managed.apiUrl); setApiUrlDraft(managed.apiUrl); }
          if (managed.firmMode === 'audit' || managed.firmMode === 'proxy') setMode(managed.firmMode);
          setConnection({ connected: true, firmId: managed.firmId || null, firmName: managed.firmName || null });
          setApiKeySaved(true);
          // Still load recent activity from local storage
          chrome.storage.local.get(['recentActivity'], (result) => {
            if (result.recentActivity && Array.isArray(result.recentActivity)) setRecentActivity(result.recentActivity);
          });
          chrome.storage.local.remove('lastScore');
          return; // Skip individual mode setup
        }
      } catch {
        // No managed storage — continue with individual mode
      }

      // Individual mode: load from local storage
      // API key is encrypted — use loadApiKey() instead of direct chrome.storage.local read
      loadApiKey().then(key => {
        if (key) {
          setApiKeyDraft(key);
          setApiKeySaved(true);
          // If API key exists, user already completed setup — mark as connected
          // This prevents the setup wizard from reappearing on every extension reload
          setConnection(prev => prev.connected ? prev : { connected: true, firmId: prev.firmId, firmName: prev.firmName });
          chrome.storage.local.set({ connectionState: { connected: true, firmId: null, firmName: null } });
        }
      }).catch(() => {});
      chrome.storage.local.get(['apiBaseUrl', 'connectionState', 'firmMode', 'recentActivity', 'lastScore'], (result) => {
        if (result.apiBaseUrl) { setApiUrl(result.apiBaseUrl); setApiUrlDraft(result.apiBaseUrl); }
        if (result.connectionState) setConnection(result.connectionState);
        if (result.firmMode) setMode(result.firmMode);
        if (result.recentActivity && Array.isArray(result.recentActivity)) setRecentActivity(result.recentActivity);
        chrome.storage.local.remove('lastScore');
      });
    }
    loadConfig();
  }, []);

  // Listen for managed storage changes (admin pushes new policy at runtime)
  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'managed') return;
      chrome.storage.managed.get(['apiKey', 'apiUrl', 'firmMode', 'firmId', 'firmName'])
        .then((managed) => {
          if (managed?.apiKey) {
            setIsManaged(true);
            setManagedFirmName(managed.firmName || null);
            if (managed.firmMode === 'audit' || managed.firmMode === 'proxy') setMode(managed.firmMode);
            setConnection({ connected: true, firmId: managed.firmId || null, firmName: managed.firmName || null });
            setApiKeySaved(true);
            setSettingsOpen(false);
          } else {
            setIsManaged(false);
            setManagedFirmName(null);
          }
        })
        .catch(() => {});
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
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

  // Sign out — clears all state and returns to onboarding
  const handleSignOut = useCallback(async () => {
    await onSignOut();
  }, [onSignOut]);

  // Toggle mode and notify service worker
  const handleModeToggle = useCallback(async () => {
    if (isManaged) return; // Locked in enterprise managed mode
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
  }, [mode, isManaged]);

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
    // Track which tool was last active so we can clear stale detections on tool change
    let previousToolId: string | null = null;

    // Known AI tool hosts — used as URL-based fallback when content script hasn't responded yet
    const AI_TOOL_HOSTS: Record<string, string> = {
      'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
      'claude.ai': 'Claude', 'gemini.google.com': 'Gemini',
      'copilot.microsoft.com': 'Copilot', 'chat.deepseek.com': 'DeepSeek',
      'poe.com': 'Poe', 'perplexity.ai': 'Perplexity', 'www.perplexity.ai': 'Perplexity',
      'you.com': 'You.com', 'huggingface.co': 'HuggingFace', 'groq.com': 'Groq',
    };

    function getToolNameFromUrl(url: string | undefined): string | null {
      if (!url) return null;
      try {
        const host = new URL(url).hostname;
        return AI_TOOL_HOSTS[host] || null;
      } catch { return null; }
    }

    // Check current tab for AI tool — with retry since content script may not be ready yet
    function checkCurrentTab() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) return;

        const tabId = tab.id;
        setActiveTabId(tabId);
        activeTabIdRef.current = tabId;

        // Query the content script for tool status
        chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' }, (response) => {
          // If content script didn't respond, use URL-based fallback
          if (chrome.runtime.lastError) {
            const urlTool = getToolNameFromUrl(tab.url);
            if (urlTool) {
              // We're on an AI tool page but content script isn't ready yet
              setStatus('monitoring');
              setCurrentTool(urlTool);
              if (!previousToolId || previousToolId === urlTool) {
                previousToolId = urlTool;
              }
            } else {
              // Not on an AI tool page — clear stale monitoring state
              setStatus('idle');
              setCurrentTool(null);
              if (previousToolId) {
                setLastScore(null);
                setInspectorData(null);
                chrome.storage.local.remove('lastScore');
                previousToolId = null;
              }
            }
            return;
          }
          if (response?.active) {
            const toolId = response.aiTool || response.aiToolName || 'AI Tool';
            setStatus('monitoring');
            setCurrentTool(response.aiToolName || response.aiTool || 'AI Tool');

            // Clear stale detection data when switching to a different AI tool
            if (previousToolId && previousToolId !== toolId) {
              setLastScore(null);
              setInspectorData(null);
              chrome.storage.local.remove('lastScore');
            }
            previousToolId = toolId;
          } else {
            setStatus('idle');
            setCurrentTool(null);
            // Clear stale detection when navigating away from AI tools
            if (previousToolId) {
              setLastScore(null);
              setInspectorData(null);
              chrome.storage.local.remove('lastScore');
              previousToolId = null;
            }
          }
        });

        // Fetch per-tab detection state from service worker
        chrome.runtime.sendMessage(
          { type: 'GET_TAB_STATE', payload: { tabId } },
          (response) => {
            if (chrome.runtime.lastError) return;
            if (response?.ok && response.state) {
              const s = response.state;
              if (s.lastScore !== null) {
                setLastScore({
                  score: s.lastScore,
                  level: s.lastLevel || 'low',
                  explanation: s.lastExplanation || '',
                  entities: s.lastEntities || [],
                  aiToolId: s.aiToolId,
                } as any);
              }
              if (s.lastMaskedPrompt) {
                setInspectorData({
                  maskedPrompt: s.lastMaskedPrompt || '',
                  pseudonymMappings: s.lastPseudonymMappings || [],
                });
              }
            }
          }
        );
      });
    }

    // Check immediately, then retry a few times (content script may load after sidepanel)
    checkCurrentTab();
    const retryTimers = [
      setTimeout(checkCurrentTab, 1000),
      setTimeout(checkCurrentTab, 3000),
      setTimeout(checkCurrentTab, 5000),
    ];

    // Periodic re-check every 8s — catches cases where content script loads late
    // (e.g., heavy SPAs like Perplexity) or after extension reload
    const periodicCheck = setInterval(checkCurrentTab, 8000);

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
        const scoreTabId = newScore.tabId;

        // Always add to recent activity regardless of which tab
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
          chrome.storage.local.set({ recentActivity: updated.slice(0, 20) });
          return updated;
        });

        // Only update the main display if this score is for the ACTIVE tab.
        // Accept the score if: no tab context on the score (legacy), OR
        // we don't know the active tab yet (null), OR tab IDs match.
        const currentActiveTab = activeTabIdRef.current;
        if (scoreTabId == null || currentActiveTab == null || scoreTabId === currentActiveTab) {
          setLastScore(newScore);
          setFeedbackSent(new Set());
          setFeedbackOpen(null);

          // Persist lastScore for this tab
          chrome.storage.local.set({ lastScore: newScore });

          // Update Prompt Inspector data if available
          if (newScore.maskedPrompt) {
            setInspectorData({
              maskedPrompt: newScore.maskedPrompt,
              pseudonymMappings: newScore.pseudonymMappings || [],
            });
            setInspectorOpen(true);
          }
        }
      }

      if (message.type === 'GHOST_DETECTION') {
        const { label, confidence } = message.payload;
        setRecentActivity((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          updated[0] = { ...updated[0], ghostLabel: label, ghostConfidence: confidence };
          return updated;
        });
      }

      if (message.type === 'PROTECTION_STATUS') {
        setProtectionHealthy(message.payload?.healthy ?? null);
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

        // Populate Document Inspector
        setDocScanData({
          fileName: p.fileName,
          fileType: p.fileType || '',
          fileSize: p.fileSize || 0,
          textLength: p.textLength || 0,
          score: p.score,
          level: p.level,
          entitiesFound: p.entitiesFound || 0,
          explanation: p.explanation || '',
          entities: p.entities || [],
          breakdown: p.breakdown || {},
          originalText: p.originalText || '',
          redactedText: p.redactedText || '',
          entitiesRedacted: p.entitiesRedacted || 0,
        });
        setDocInspectorOpen(true);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      retryTimers.forEach(clearTimeout);
      clearInterval(periodicCheck);
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.tabs.onUpdated.removeListener(tabListener);
      chrome.tabs.onActivated.removeListener(activatedListener);
    };
  }, []);

  // -- First-run setup wizard state --
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [setupKeyDraft, setSetupKeyDraft] = useState('');
  const [setupKeyError, setSetupKeyError] = useState<string | null>(null);
  const [setupConnecting, setSetupConnecting] = useState(false);
  const [setupMode, setSetupMode] = useState<'audit' | 'proxy'>('proxy');

  const handleSetupConnect = useCallback(async () => {
    const key = setupKeyDraft.trim();
    if (!key.startsWith('ig_') || key.length < 20) {
      setSetupKeyError('Invalid key format. Keys start with "ig_" and are at least 20 characters.');
      return;
    }
    setSetupConnecting(true);
    setSetupKeyError(null);

    try {
      // Save API key encrypted + tell service worker
      await saveApiKey(key);
      try {
        await chrome.runtime.sendMessage({ type: 'SET_API_KEY', payload: { apiKey: key } });
      } catch {}

      // Test connection to API
      const url = apiUrlDraft.replace(/\/+$/, '');
      const baseUrl = url.replace(/\/v1\/?$/, '');
      const res = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const newConnection: ConnectionState = { connected: true, firmId: null, firmName: null };
      await chrome.storage.local.set({ apiBaseUrl: url, connectionState: newConnection });
      setApiUrl(url);
      setConnection(newConnection);
      setApiKeyDraft(key);
      setApiKeySaved(true);
      setSetupStep(3);
    } catch (err) {
      // Connection failed but key is saved — still move to step 3
      // The key is valid, API might just be slow to respond
      setApiKeyDraft(key);
      setApiKeySaved(true);
      const newConnection: ConnectionState = { connected: true, firmId: null, firmName: null };
      await chrome.storage.local.set({ connectionState: newConnection });
      setConnection(newConnection);
      setSetupStep(3);
    } finally {
      setSetupConnecting(false);
    }
  }, [setupKeyDraft, apiUrlDraft]);

  // -- Not connected: show first-run setup wizard --
  if (!connection.connected) {
    return (
      <div className="min-h-screen bg-gray-50 p-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">IG</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Iron Gate</h1>
            <p className="text-xs text-gray-500">AI Data Protection</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <React.Fragment key={s}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                s < setupStep ? 'bg-iron-600 text-white' :
                s === setupStep ? 'bg-iron-100 text-iron-700 ring-2 ring-iron-500' :
                'bg-gray-200 text-gray-400'
              }`}>
                {s < setupStep ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : s}
              </div>
              {s < 3 && <div className={`flex-1 h-0.5 rounded ${s < setupStep ? 'bg-iron-600' : 'bg-gray-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Welcome */}
        {setupStep === 1 && (
          <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-iron-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-iron-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome to Iron Gate</h2>
              <p className="text-sm text-gray-500 leading-relaxed">
                Iron Gate protects your organization by detecting and redacting sensitive data before it reaches AI tools like ChatGPT, Claude, and Gemini.
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border space-y-3 mb-6">
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-xs text-gray-600">Real-time PII scanning on every prompt</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-xs text-gray-600">Automatic pseudonymization of names, emails, SSNs, and more</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-xs text-gray-600">Compliance monitoring with full audit trail</p>
              </div>
            </div>

            <button
              onClick={() => setSetupStep(2)}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 transition-colors mt-auto"
            >
              Get Started
            </button>
          </div>
        )}

        {/* Step 2: Paste API Key */}
        {setupStep === 2 && (
          <div className="flex-1 flex flex-col">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Connect to Your Organization</h2>
              <p className="text-xs text-gray-500">
                Paste the API key your admin provided. It starts with <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">ig_</code> and was shown during organization setup.
              </p>
            </div>

            <div className="bg-white rounded-lg p-4 border mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">API Key</label>
              <input
                type="text"
                value={setupKeyDraft}
                onChange={(e) => { setSetupKeyDraft(e.target.value); setSetupKeyError(null); }}
                placeholder="ig_xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2.5 text-sm border rounded-lg bg-gray-50 font-mono focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                autoFocus
              />
              {setupKeyError && (
                <p className="text-xs text-red-600 mt-1.5">{setupKeyError}</p>
              )}
            </div>

            <details className="mb-4">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                Advanced: Custom API URL
              </summary>
              <div className="mt-2 bg-white rounded-lg p-3 border">
                <label className="block text-xs font-medium text-gray-500 mb-1">API URL</label>
                <input
                  type="url"
                  value={apiUrlDraft}
                  onChange={(e) => setApiUrlDraft(e.target.value)}
                  placeholder="https://irongate-api.onrender.com/v1"
                  className="w-full px-3 py-2 text-xs border rounded-md bg-gray-50 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                />
              </div>
            </details>

            <div className="flex gap-2 mt-auto">
              <button
                onClick={() => setSetupStep(1)}
                className="px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSetupConnect}
                disabled={setupConnecting || !setupKeyDraft.trim()}
                className="flex-1 py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {setupConnecting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Connected! */}
        {setupStep === 3 && (
          <div className="flex-1 flex flex-col">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">You&apos;re Connected!</h2>
              <p className="text-sm text-gray-500">
                Iron Gate is now protecting your AI interactions.
              </p>
            </div>

            {/* Protection mode info */}
            <div className="bg-iron-50 rounded-lg p-4 border border-iron-200 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-iron-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                <p className="text-xs font-semibold text-iron-800">Protect Mode</p>
              </div>
              <p className="text-[10px] text-iron-600">Sensitive data is automatically redacted before reaching AI services.</p>
            </div>

            <button
              onClick={() => {
                // Save mode and dismiss wizard
                chrome.storage.local.set({ firmMode: 'proxy' });
                try {
                  chrome.runtime.sendMessage({ type: 'MODE_CHANGED', payload: { mode: 'proxy' } });
                } catch {}
              }}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 transition-colors mt-auto"
            >
              Start Protection
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-400">
            Iron Gate v{chrome.runtime.getManifest().version}
          </p>
        </div>
      </div>
    );
  }

  // -- Trust page overlay --
  if (trustPageOpen) {
    return <TrustPage onClose={() => setTrustPageOpen(false)} />;
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
        {!isManaged && <UpgradePrompt />}
        {!isManaged && (
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {/* Enterprise managed mode banner */}
      {isManaged && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
          </svg>
          <div className="flex-1">
            <p className="text-xs font-medium text-blue-800">
              Managed by {managedFirmName || 'your organization'}
            </p>
            <p className="text-[10px] text-blue-600 mt-0.5">
              Settings are configured by your IT administrator
            </p>
          </div>
        </div>
      )}

      {/* Trial Banner */}
      {!isManaged && <TrialBanner />}

      {/* Collapsible Settings Panel */}
      {settingsOpen && !isManaged && (
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

          {/* Mode info — Protect */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-gray-700">Mode: Protect</span>
              <span className="text-[10px] text-gray-400 mt-0.5">
                Sensitive data redacted before sending
              </span>
            </div>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">
              ACTIVE
            </span>
          </div>

          {/* Trust & Transparency */}
          <button
            onClick={() => { setTrustPageOpen(true); setSettingsOpen(false); }}
            className="w-full mt-1 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-md hover:bg-gray-100 transition-colors mb-2"
          >
            Trust & Transparency
          </button>

          {/* Sign Out — hidden in enterprise managed mode */}
          {!isManaged && (
            <button
              onClick={handleSignOut}
              className="w-full py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 transition-colors"
            >
              Sign Out
            </button>
          )}
        </div>
      )}

      {/* Status */}
      <div className="bg-white rounded-lg p-3 mb-4 shadow-sm border">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              protectionHealthy === false
                ? 'bg-red-500'
                : status === 'monitoring'
                ? 'bg-green-500 animate-pulse'
                : status === 'error'
                ? 'bg-red-500'
                : 'bg-gray-300'
            }`}
          />
          <span className="text-sm font-medium text-gray-700">
            {protectionHealthy === false
              ? 'Protection Degraded'
              : status === 'monitoring'
              ? `Monitoring ${currentTool}`
              : status === 'error'
              ? 'Error'
              : 'Not on an AI tool page'}
          </span>
          <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-600">
            PROTECT
          </span>
        </div>
        {protectionHealthy === false && (
          <p className="text-xs text-red-600 mt-2">
            Fetch interception failed on this page. Prompts may not be scanned or pseudonymized. Try refreshing the page.
          </p>
        )}
      </div>

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

          {/* Copy Safe Version — prominent button (only in proxy mode where data is actually protected) */}
          {inspectorData?.maskedPrompt && mode === 'proxy' && (
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

          {/* Audit mode warning — data was NOT protected */}
          {inspectorData?.maskedPrompt && mode === 'audit' && (
            <div className="px-3 py-2 border-t bg-amber-50">
              <div className="flex items-center gap-2 justify-center py-1.5">
                <svg className="h-4 w-4 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="text-[10px] text-amber-700 font-medium">
                  Audit mode — original data was sent to the AI unmodified
                </p>
              </div>
              <button
                onClick={handleCopySafe}
                className={`w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  copiedSafe
                    ? 'bg-amber-600 text-white'
                    : 'bg-amber-100 text-amber-800 hover:bg-amber-200 active:scale-[0.98]'
                }`}
              >
                {copiedSafe ? 'Copied!' : 'Copy Pseudonymized Version'}
              </button>
              <p className="text-[10px] text-amber-600 text-center mt-1">
                Switch to Protect mode to block sensitive data before it reaches the AI
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
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Original prompt</p>
                    <div className="text-xs text-gray-500 italic bg-red-50 border border-red-100 rounded-md p-2.5 leading-relaxed">
                      Original text is not stored for privacy. The pseudonymized version below shows what was sent to the AI.
                    </div>
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
                            <span className="font-mono text-red-400">{m.length} chars</span>
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

      {/* Last Detection */}
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

      {/* Document Inspector */}
      {docScanData && (
        <div className="bg-white rounded-lg mb-4 shadow-sm border">
          <button
            onClick={() => setDocInspectorOpen(!docInspectorOpen)}
            className="w-full px-4 py-3 flex items-center justify-between border-b hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-iron-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
              </svg>
              <h2 className="text-sm font-medium text-gray-700">Document Inspector</h2>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-700 uppercase">
                {docScanData.fileType}
              </span>
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-gray-400 transition-transform ${docInspectorOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>

          {docInspectorOpen && (
            <div>
              {/* Score header */}
              <div className="px-4 py-3 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-2xl font-bold ${
                        docScanData.level === 'critical'
                          ? 'text-risk-critical'
                          : docScanData.level === 'high'
                          ? 'text-risk-high'
                          : docScanData.level === 'medium'
                          ? 'text-risk-medium'
                          : docScanData.level === 'error'
                          ? 'text-red-500'
                          : 'text-risk-low'
                      }`}
                    >
                      {docScanData.level === 'error' ? '!' : docScanData.score}
                    </span>
                    <div>
                      <div className="text-xs font-medium capitalize">
                        {docScanData.level === 'error' ? 'Scan Failed' : `${docScanData.level} Risk`}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        {docScanData.level === 'error' ? docScanData.explanation : `${docScanData.entitiesFound} entities found`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-600 font-medium truncate max-w-[140px]" title={docScanData.fileName}>
                      {docScanData.fileName}
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {docScanData.fileSize > 0 ? `${(docScanData.fileSize / 1024).toFixed(1)} KB` : ''}
                      {docScanData.textLength > 0 ? ` / ${docScanData.textLength.toLocaleString()} chars` : ''}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tab bar */}
              <div className="flex border-b">
                <button
                  onClick={() => setDocInspectorView('overview')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    docInspectorView === 'overview'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setDocInspectorView('entities')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    docInspectorView === 'entities'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Entities ({docScanData.entitiesFound})
                </button>
                <button
                  onClick={() => setDocInspectorView('original')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    docInspectorView === 'original'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Original
                </button>
                <button
                  onClick={() => setDocInspectorView('redacted')}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    docInspectorView === 'redacted'
                      ? 'text-iron-700 border-b-2 border-iron-600 bg-iron-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Safe Version
                </button>
              </div>

              {/* Content */}
              <div className="p-3 max-h-64 overflow-y-auto">
                {docInspectorView === 'overview' && (
                  <div className="space-y-3">
                    {/* Entity type breakdown */}
                    {docScanData.entities.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Sensitive Data Types Found</p>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(
                            docScanData.entities.reduce<Record<string, number>>((acc, e) => {
                              acc[e.type] = (acc[e.type] || 0) + 1;
                              return acc;
                            }, {})
                          )
                            .sort(([, a], [, b]) => b - a)
                            .map(([type, count]) => (
                              <span
                                key={type}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-iron-100 text-iron-700"
                              >
                                {type}
                                <span className="text-[10px] text-iron-500">x{count}</span>
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Score breakdown */}
                    {Object.keys(docScanData.breakdown).length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">Score Breakdown</p>
                        <div className="space-y-1">
                          {Object.entries(docScanData.breakdown)
                            .sort(([, a], [, b]) => b - a)
                            .map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 capitalize">{key.replace(/_/g, ' ')}</span>
                                <span className="font-mono text-gray-700 font-medium">+{value}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Explanation */}
                    {docScanData.explanation && (
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Analysis</p>
                        <p className="text-xs text-gray-600">{docScanData.explanation}</p>
                      </div>
                    )}

                    {/* Metadata */}
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Document Info</p>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <span className="text-gray-500">Type</span>
                        <span className="text-gray-700 uppercase">{docScanData.fileType}</span>
                        <span className="text-gray-500">Size</span>
                        <span className="text-gray-700">{(docScanData.fileSize / 1024).toFixed(1)} KB</span>
                        <span className="text-gray-500">Text Length</span>
                        <span className="text-gray-700">{docScanData.textLength.toLocaleString()} chars</span>
                        <span className="text-gray-500">Entities Redacted</span>
                        <span className="text-gray-700">{docScanData.entitiesRedacted}</span>
                      </div>
                    </div>
                  </div>
                )}

                {docInspectorView === 'entities' && (
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5">
                      Detected entities (positions only — no raw PII)
                    </p>
                    {docScanData.entities.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No entities detected.</p>
                    ) : (
                      <div className="space-y-1">
                        {docScanData.entities.map((entity, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs bg-gray-50 rounded-md px-2.5 py-1.5 border"
                          >
                            <span className="font-medium text-iron-700 min-w-[100px]">{entity.type}</span>
                            <span className="text-gray-400 font-mono text-[10px]">
                              {entity.start}-{entity.end}
                            </span>
                            <span className="text-gray-500 text-[10px]">
                              {entity.length} chars
                            </span>
                            <span className="ml-auto text-[10px] text-gray-400">
                              {(entity.confidence * 100).toFixed(0)}%
                            </span>
                            <span className="text-[10px] text-gray-300 bg-gray-100 rounded px-1 py-0.5">
                              {entity.source}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {docInspectorView === 'original' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                        Original extracted text — contains real PII
                      </p>
                      <span className="text-[10px] text-red-500 bg-red-50 rounded px-1.5 py-0.5 font-medium">
                        Sensitive
                      </span>
                    </div>
                    {docScanData.originalText ? (
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words bg-red-50 border border-red-100 rounded-md p-2.5 leading-relaxed font-mono max-h-48 overflow-y-auto">
                        {docScanData.originalText}
                      </pre>
                    ) : (
                      <p className="text-xs text-gray-400 italic">Original text not available.</p>
                    )}
                    <p className="text-[10px] text-gray-400 text-center mt-1.5">
                      Compare with the Safe Version tab to see what was pseudonymized
                    </p>
                  </div>
                )}

                {docInspectorView === 'redacted' && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-gray-400 uppercase tracking-wide">
                        Safe to share — all PII replaced with pseudonyms
                      </p>
                    </div>
                    {docScanData.redactedText ? (
                      <>
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words bg-green-50 border border-green-100 rounded-md p-2.5 leading-relaxed font-mono max-h-48 overflow-y-auto">
                          {docScanData.redactedText}
                        </pre>
                        <button
                          onClick={handleCopyDocSafe}
                          className={`mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                            copiedDocSafe
                              ? 'bg-green-500 text-white'
                              : 'bg-iron-600 text-white hover:bg-iron-700 active:scale-[0.98]'
                          }`}
                        >
                          {copiedDocSafe ? (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                              Copied to Clipboard
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                              Copy Safe Version
                            </>
                          )}
                        </button>
                        <p className="text-[10px] text-gray-400 text-center mt-1.5">
                          Names, SSNs, emails, and other PII replaced with realistic pseudonyms
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No safe version available.</p>
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
              <React.Fragment key={item.id}>
                <div className="px-4 py-2 flex items-center justify-between">
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
                {item.ghostLabel && (
                  <GhostDetection
                    entityType={`${item.ghostLabel} content`}
                    confidence={item.ghostConfidence ?? 0}
                  />
                )}
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 text-center">
        <p className="text-xs text-gray-400">
          Iron Gate v{chrome.runtime.getManifest().version}
        </p>
      </div>
    </div>
  );
}
