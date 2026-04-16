import React, { useState, useCallback, useEffect, useRef } from 'react';
import { saveApiKey } from '../api-key-store';
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
} from '../shared/storage-keys';

const DEFAULT_API_URL = 'https://irongate-api.onrender.com/v1';

interface OnboardingOverlayProps {
  onComplete: () => void;
}

type Industry = 'legal' | 'finance' | 'tech' | 'healthcare' | 'consulting' | 'government' | 'education' | 'other';

const INDUSTRIES: { id: Industry; label: string; icon: string; desc: string }[] = [
  { id: 'legal', label: 'Legal', icon: '\u2696\uFE0F', desc: 'Law firms, legal departments' },
  { id: 'finance', label: 'Finance', icon: '\uD83C\uDFE6', desc: 'Banks, investment, accounting' },
  { id: 'tech', label: 'Technology', icon: '\uD83D\uDCBB', desc: 'Software, IT, startups' },
  { id: 'healthcare', label: 'Healthcare', icon: '\uD83C\uDFE5', desc: 'Hospitals, clinics, pharma' },
  { id: 'consulting', label: 'Consulting', icon: '\uD83D\uDCCA', desc: 'Advisory, management consulting' },
  { id: 'government', label: 'Government', icon: '\uD83C\uDFDB\uFE0F', desc: 'Public sector, agencies' },
  { id: 'education', label: 'Education', icon: '\uD83C\uDF93', desc: 'Universities, schools, research' },
  { id: 'other', label: 'Other', icon: '\uD83C\uDFE2', desc: 'Insurance, real estate, non-profit' },
];

const DEMO_TEXT = `Please review the merger documents for Meridian Health (client #MH-2024-0891).
The lead partner is Sarah Chen (sarah.chen@lawfirm.com, SSN 412-68-9031).
Deal size is approximately $2.4B with closing expected Q3 2025.`;

const DEMO_ENTITIES = [
  { text: 'Meridian Health', type: 'ORGANIZATION', color: 'bg-blue-100 text-blue-700' },
  { text: 'MH-2024-0891', type: 'MATTER_NUMBER', color: 'bg-purple-100 text-purple-700' },
  { text: 'Sarah Chen', type: 'PERSON', color: 'bg-yellow-100 text-yellow-700' },
  { text: 'sarah.chen@lawfirm.com', type: 'EMAIL', color: 'bg-red-100 text-red-700' },
  { text: '412-68-9031', type: 'SSN', color: 'bg-red-100 text-red-700' },
  { text: '$2.4B', type: 'MONETARY', color: 'bg-green-100 text-green-700' },
];

export function OnboardingOverlay({ onComplete }: OnboardingOverlayProps) {
  // ── Managed mode skip ────────────────────────────────────────────────────
  // Check if we're in managed mode with valid credentials — skip onboarding entirely
  const [managedSkip, setManagedSkip] = useState(false);
  const [managedFirmName, setManagedFirmName] = useState('');
  const [managedContact, setManagedContact] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const managed = await new Promise<Record<string, any>>((resolve) => {
          if (chrome?.storage?.managed) {
            chrome.storage.managed.get(null, (items) => {
              if (chrome.runtime.lastError) resolve({});
              else resolve(items || {});
            });
          } else resolve({});
        });

        if (managed.deploymentMode || managed.enrollmentCode) {
          // Check if we have valid credentials (API key + firm)
          const local = await new Promise<Record<string, any>>((resolve) => {
            chrome.storage.local.get(['ironGateApiKey_enc', 'firm_id', 'firm_name'], (items) => resolve(items || {}));
          });
          if (local.ironGateApiKey_enc && local.firm_id) {
            setManagedFirmName(local.firm_name || managed.firmId || 'your organization');
            setManagedContact(managed.supportContact || '');
            setManagedSkip(true);
          }
        }
      } catch { /* non-fatal — fall through to normal onboarding */ }
    })();
  }, []);

  // ── Normal onboarding state ──────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [selectedIndustries, setSelectedIndustries] = useState<Industry[]>([]);
  const [selectedMode, setSelectedMode] = useState<'audit' | 'proxy'>('audit');
  const [email, setEmail] = useState('');
  const [firmCode, setFirmCode] = useState('');
  const [firmCodeValid, setFirmCodeValid] = useState<boolean | null>(null);
  const [firmCodeName, setFirmCodeName] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registrationData, setRegistrationData] = useState<{
    tier: string;
    trialEndsAt: string | null;
    firmName: string;
  } | null>(null);

  // Demo animation
  const [demoHighlightIndex, setDemoHighlightIndex] = useState(-1);

  // Tier 2 / Ollama state
  type OllamaStatus = 'idle' | 'testing' | 'success' | 'error';
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('idle');
  const [ollamaMessage, setOllamaMessage] = useState<string>('');
  const [osHint, setOsHint] = useState<'mac' | 'windows' | 'linux'>('mac');
  const [openOsPanel, setOpenOsPanel] = useState<'mac' | 'windows' | 'linux' | null>('mac');

  useEffect(() => {
    // Detect user's OS for install instructions
    try {
      const ua = (navigator.userAgent || '').toLowerCase();
      const platform = (navigator.platform || '').toLowerCase();
      let detected: 'mac' | 'windows' | 'linux' = 'mac';
      if (/win/.test(platform) || /windows/.test(ua)) detected = 'windows';
      else if (/linux/.test(platform) || /linux/.test(ua)) detected = 'linux';
      else if (/mac/.test(platform) || /mac os/.test(ua)) detected = 'mac';
      setOsHint(detected);
      setOpenOsPanel(detected);
    } catch { /* non-fatal */ }
  }, []);

  // Ref tracks whether this component is still mounted. If the user
  // navigates to another step (or the sidepanel closes) while the Ollama
  // probe is in flight, we must NOT call setState — React warns, and on
  // subsequent navigations the stale callback can overwrite fresh UI.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleTestOllama = useCallback(async () => {
    if (!isMountedRef.current) return;
    setOllamaStatus('testing');
    setOllamaMessage('');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!isMountedRef.current) return;
      if (!res.ok) {
        setOllamaStatus('error');
        setOllamaMessage('Ollama not reachable. Make sure it\u2019s running and try again.');
        return;
      }
      // Persist tier2 config
      try {
        // Write to BOTH key sets so every consumer finds the config:
        //   tier2*          → read by managed-config.ts (Tier 2 adapter)
        //   localLLM*       → read by content/index.ts (main-world RPC)
        //   localEndpoint   → read by worker initLocalLlmDeployment
        await chrome.storage.local.set({
          tier2Enabled: true,
          tier2Endpoint: 'http://localhost:11434/api/generate',
          tier2Model: 'gemma4:e2b',
          localLLMEndpoint: 'http://localhost:11434/api/generate',
          localLLMModel: 'gemma4:e2b',
          localLLMEnabled: true,
        });
      } catch { /* non-fatal */ }
      if (!isMountedRef.current) return;
      setOllamaStatus('success');
      setOllamaMessage('Ollama detected \u2014 enhanced detection active');
    } catch {
      if (!isMountedRef.current) return;
      setOllamaStatus('error');
      setOllamaMessage('Ollama not reachable. Make sure it\u2019s running and try again.');
    }
  }, []);

  useEffect(() => {
    if (step !== 2) return;
    let i = 0;
    const interval = setInterval(() => {
      setDemoHighlightIndex(i);
      i++;
      if (i >= DEMO_ENTITIES.length) {
        clearInterval(interval);
        setTimeout(() => setDemoHighlightIndex(DEMO_ENTITIES.length), 800);
      }
    }, 600);
    return () => clearInterval(interval);
  }, [step]);

  // Generate or retrieve device ID
  const [deviceId, setDeviceId] = useState('');
  useEffect(() => {
    chrome.storage.local.get([DEVICE_ID], (result) => {
      if (result[DEVICE_ID]) {
        setDeviceId(result[DEVICE_ID]);
      } else {
        const id = crypto.randomUUID();
        chrome.storage.local.set({ [DEVICE_ID]: id });
        setDeviceId(id);
      }
    });
  }, []);

  // Validate firm code on blur
  const handleValidateFirmCode = useCallback(async () => {
    if (!firmCode.trim()) {
      setFirmCodeValid(null);
      setFirmCodeName(null);
      return;
    }
    try {
      // AbortSignal.timeout prevents a hung API from stalling the wizard.
      // Without it, a Render cold-start can leave the firm-code field
      // "validating…" indefinitely and the user can't proceed.
      const res = await fetch(`${DEFAULT_API_URL}/auth/validate-firm-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmCode: firmCode.trim() }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        setFirmCodeValid(false);
        setFirmCodeName(null);
        return;
      }
      const data = await res.json();
      setFirmCodeValid(data.valid);
      setFirmCodeName(data.firmName);
    } catch {
      setFirmCodeValid(false);
      setFirmCodeName(null);
    }
  }, [firmCode]);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  // Synchronous in-flight guard — React's state batching means
  // `setRegistering(true)` doesn't prevent a second click landing in the
  // same tick. A ref reads/writes synchronously inside the handler, so
  // the second call sees `inFlight=true` immediately and bails.
  const registerInFlight = useRef(false);

  // Register
  const handleRegister = useCallback(async () => {
    if (registerInFlight.current) return;
    if (!isValidEmail(email)) {
      setRegisterError('Please enter a valid email address.');
      return;
    }
    registerInFlight.current = true;
    setRegistering(true);
    setRegisterError(null);

    try {
      const res = await fetch(`${DEFAULT_API_URL}/auth/register-extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          deviceId,
          industry: selectedIndustries[0] || undefined,
          firmCode: firmCode.trim() || undefined,
        }),
        // Surface slow network as a timeout error instead of hanging the
        // button forever. 30s covers Render cold starts.
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Registration failed' }));
        throw new Error(err.error || 'Registration failed');
      }

      const data = await res.json();

      // Store API key encrypted
      await saveApiKey(data.apiKey);
      try {
        await chrome.runtime.sendMessage({ type: 'SET_API_KEY', payload: { apiKey: data.apiKey } });
      } catch (err) {
        console.warn('[Iron Gate] SET_API_KEY message failed:', err instanceof Error ? err.message : String(err));
      }

      // Store registration data
      const now = new Date().toISOString();
      await chrome.storage.local.set({
        [USER_EMAIL]: email.trim(),
        [FIRM_ID]: data.firmId,
        [FIRM_CODE]: firmCode.trim() || '',
        [FIRM_NAME]: data.firmName,
        [SUBSCRIPTION_TIER]: data.tier === 'business' ? 'team' : (data.tier === 'free' ? 'basic' : data.tier),
        [SUBSCRIPTION_CACHED_AT]: Date.now(),
        [TRIAL_START_DATE]: now,
        [TRIAL_ENDS_AT]: data.trialEndsAt || null,
        [SELECTED_INDUSTRIES]: selectedIndustries,
        firmMode: selectedMode,
        connectionState: { connected: true, firmId: data.firmId, firmName: data.firmName },
        apiBaseUrl: DEFAULT_API_URL,
      });

      // Notify service worker of mode change
      try {
        await chrome.runtime.sendMessage({ type: 'MODE_CHANGED', payload: { mode: selectedMode } });
      } catch (err) {
        console.warn('[Iron Gate] MODE_CHANGED message failed:', err instanceof Error ? err.message : String(err));
      }

      setRegistrationData({
        tier: data.tier,
        trialEndsAt: data.trialEndsAt,
        firmName: data.firmName,
      });
      setStep(5);
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setRegistering(false);
      registerInFlight.current = false;
    }
  }, [email, deviceId, firmCode, selectedIndustries, selectedMode]);

  // Complete onboarding
  const handleFinish = useCallback(async () => {
    await chrome.storage.local.set({ [ONBOARDING_COMPLETED]: true });
    onComplete();
  }, [onComplete]);

  const canAdvance = () => {
    switch (step) {
      case 1: return selectedIndustries.length > 0;
      case 2: return true;
      case 3: return true;
      case 4:
        return isValidEmail(email)
          && deviceId !== ''
          && (firmCode.trim() === '' || firmCodeValid === true);
      default: return true;
    }
  };

  // ── Managed mode: show simplified confirmation instead of full wizard ────
  if (managedSkip) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛡️</div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px', color: '#1a1a2e' }}>
          Protected by IronGate
        </h2>
        <p style={{ fontSize: '14px', color: '#666', marginBottom: '24px' }}>
          Managed by {managedFirmName}
        </p>
        {managedContact && (
          <p style={{ fontSize: '13px', color: '#888' }}>
            IT Support: {managedContact}
          </p>
        )}
        <button
          onClick={async () => {
            await chrome.storage.local.set({ [ONBOARDING_COMPLETED]: true });
            onComplete();
          }}
          style={{
            marginTop: '24px',
            padding: '10px 24px',
            background: '#4f46e5',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          Get Started
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 bg-iron-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">IG</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Iron Gate</h1>
          <p className="text-xs text-gray-500">AI Data Protection</p>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex items-center gap-1.5 mb-6">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <div
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              s <= step ? 'bg-iron-600 flex-[2]' : 'bg-gray-200 flex-1'
            }`}
          />
        ))}
      </div>

      {/* Step 1: Industry */}
      {step === 1 && (
        <div className="flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-1">What's your industry?</h2>
          <p className="text-xs text-gray-500 mb-4">This helps us configure the right detection rules for your data.</p>

          <div className="grid grid-cols-2 gap-2 mb-4">
            {INDUSTRIES.map((ind) => (
              <button
                key={ind.id}
                type="button"
                onClick={() => {
                  setSelectedIndustries(prev =>
                    prev.includes(ind.id) ? prev.filter(i => i !== ind.id) : [...prev, ind.id]
                  );
                }}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedIndustries.includes(ind.id)
                    ? 'border-iron-500 bg-iron-50 ring-2 ring-iron-200'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="text-xl mb-1">{ind.icon}</div>
                <div className="text-sm font-semibold text-gray-900">{ind.label}</div>
                <div className="text-[10px] text-gray-500">{ind.desc}</div>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setStep(2)}
            disabled={!canAdvance()}
            className="w-full py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 disabled:opacity-50 transition-colors mt-auto"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: Live Demo */}
      {step === 2 && (
        <div className="flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-1">See it in action</h2>
          <p className="text-xs text-gray-500 mb-4">Watch Iron Gate detect sensitive data in real-time.</p>

          <div className="bg-white rounded-lg border p-3 mb-3">
            <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Sample Prompt</div>
            <p className="text-xs text-gray-700 leading-relaxed font-mono">
              {DEMO_TEXT.split(new RegExp(`(${DEMO_ENTITIES.map(e => e.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')).map((part, i) => {
                const entity = DEMO_ENTITIES.find(e => e.text === part);
                if (entity) {
                  const entityIdx = DEMO_ENTITIES.indexOf(entity);
                  const isHighlighted = demoHighlightIndex >= entityIdx;
                  return (
                    <span
                      key={i}
                      className={`px-0.5 rounded transition-all duration-300 ${
                        isHighlighted ? entity.color : ''
                      }`}
                    >
                      {part}
                    </span>
                  );
                }
                return <span key={i}>{part}</span>;
              })}
            </p>
          </div>

          {/* Detection cards */}
          <div className="space-y-1.5 mb-4 max-h-40 overflow-y-auto">
            {DEMO_ENTITIES.map((entity, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 bg-white rounded-lg border p-2 transition-all duration-300 ${
                  demoHighlightIndex >= i ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                }`}
              >
                <div className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${entity.color}`}>
                  {entity.type}
                </div>
                <span className="text-xs text-gray-700 font-mono truncate">{entity.text}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-auto">
            <button type="button" onClick={() => setStep(1)} className="px-4 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
            <button type="button" onClick={() => setStep(3)} className="flex-1 py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700">Continue</button>
          </div>
        </div>
      )}

      {/* Step 3: Mode Selection */}
      {step === 3 && (
        <div className="flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Choose your protection mode</h2>
          <p className="text-xs text-gray-500 mb-4">You can change this anytime in settings.</p>

          <div className="space-y-3 mb-4">
            <button
              type="button"
              onClick={() => setSelectedMode('audit')}
              className={`w-full p-4 rounded-lg border text-left transition-all ${
                selectedMode === 'audit'
                  ? 'border-iron-500 bg-iron-50 ring-2 ring-iron-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
                <span className="text-sm font-semibold text-gray-900">Audit Mode</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">Recommended</span>
              </div>
              <p className="text-xs text-gray-500 ml-7">Monitor and alert on sensitive data without blocking. Great for getting started.</p>
            </button>

            <button
              type="button"
              onClick={() => setSelectedMode('proxy')}
              className={`w-full p-4 rounded-lg border text-left transition-all ${
                selectedMode === 'proxy'
                  ? 'border-iron-500 bg-iron-50 ring-2 ring-iron-200'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
                <span className="text-sm font-semibold text-gray-900">Proxy Mode</span>
                <span className="ml-auto text-[10px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">Pro</span>
              </div>
              <p className="text-xs text-gray-500 ml-7">Automatically replace sensitive data with realistic fakes before it reaches the AI.</p>
            </button>
          </div>

          <div className="flex gap-2 mt-auto">
            <button type="button" onClick={() => setStep(2)} className="px-4 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
            <button type="button" onClick={() => setStep(4)} className="flex-1 py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700">Continue</button>
          </div>
        </div>
      )}

      {/* Step 4: Email Registration */}
      {step === 4 && (
        <div className="flex-1 flex flex-col">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Start your free trial</h2>
          <p className="text-xs text-gray-500 mb-4">15 days of Pro features, no credit card required.</p>

          <div className="space-y-3 mb-4">
            <div className="bg-white rounded-lg p-3 border">
              <label className="block text-xs font-medium text-gray-600 mb-1">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setRegisterError(null); }}
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 text-sm border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
                autoFocus
              />
            </div>

            <div className="bg-white rounded-lg p-3 border">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Organization code <span className="text-gray-400">(optional)</span>
              </label>
              <input
                type="text"
                value={firmCode}
                onChange={(e) => { setFirmCode(e.target.value); setFirmCodeValid(null); }}
                onBlur={handleValidateFirmCode}
                placeholder="e.g. ACME-2024"
                className="w-full px-3 py-2.5 text-sm border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              />
              {firmCodeValid === true && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Joining {firmCodeName}
                </p>
              )}
              {firmCodeValid === false && (
                <p role="alert" className="text-xs text-red-600 mt-1">Invalid organization code</p>
              )}
            </div>
          </div>

          {registerError && (
            <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
              <p className="text-xs text-red-700">{registerError}</p>
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 mb-4">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-iron-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              <div>
                <p className="text-[10px] text-gray-600">
                  Your data stays on your device. We only store hashed entity fingerprints, never raw text.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-auto">
            <button type="button" onClick={() => setStep(3)} className="px-4 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
            <button
              type="button"
              onClick={handleRegister}
              disabled={registering || !canAdvance()}
              className="flex-1 py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 disabled:opacity-50 transition-colors"
            >
              {registering ? 'Setting up...' : 'Start Free Trial'}
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Enhanced Detection (Optional Ollama setup) */}
      {step === 5 && (
        <div className="flex-1 flex flex-col overflow-y-auto">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Enhanced Detection (Optional)</h2>
          <p className="text-xs text-gray-500 mb-3">
            Iron Gate works out of the box with pattern-based detection. For even better accuracy on ambiguous content,
            install Ollama &mdash; a local AI service that runs entirely on your machine.
          </p>

          {/* Selling points */}
          <div className="bg-white rounded-lg border p-3 mb-3">
            <ul className="space-y-2">
              {[
                '100% local \u2014 nothing leaves your device',
                'Free and open source',
                'Adds ~10% accuracy on edge cases',
                'Takes 2 minutes to set up',
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-2">
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  <span className="text-xs text-gray-700">{text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Step-by-step */}
          <div className="bg-white rounded-lg border p-3 mb-3">
            <h3 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Setup steps</h3>
            <ol className="space-y-3 text-xs text-gray-700">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
                <div>
                  Download Ollama from{' '}
                  <a
                    href="https://ollama.com/download"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-iron-600 hover:text-iron-700 underline"
                  >
                    ollama.com/download
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
                <div className="flex-1">
                  <div className="mb-1">Install it:</div>
                  <div className="space-y-1">
                    {(['mac', 'windows', 'linux'] as const).map((os) => {
                      const label = os === 'mac' ? 'Mac' : os === 'windows' ? 'Windows' : 'Linux';
                      const detail =
                        os === 'mac'
                          ? 'Drag Ollama.app to your Applications folder and launch it.'
                          : os === 'windows'
                            ? 'Run the downloaded installer (OllamaSetup.exe) and follow the prompts.'
                            : 'Run: curl -fsSL https://ollama.com/install.sh | sh';
                      const isYourOs = os === osHint;
                      const isOpen = openOsPanel === os;
                      return (
                        <div key={os} className="border border-gray-100 rounded">
                          <button
                            type="button"
                            onClick={() => setOpenOsPanel(isOpen ? null : os)}
                            className="w-full flex items-center justify-between px-2 py-1.5 text-left hover:bg-gray-50"
                          >
                            <span className="text-xs font-medium text-gray-800">
                              {label}
                              {isYourOs && (
                                <span className="ml-2 text-[9px] uppercase tracking-wider text-iron-600 font-semibold">
                                  Your OS
                                </span>
                              )}
                            </span>
                            <svg
                              className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                            </svg>
                          </button>
                          {isOpen && (
                            <div className="px-2 pb-2 pt-0 text-[11px] text-gray-600 leading-relaxed">
                              {os === 'linux' ? (
                                <code className="block bg-gray-50 border border-gray-100 rounded px-2 py-1 font-mono text-[10px] whitespace-pre-wrap break-all">
                                  curl -fsSL https://ollama.com/install.sh | sh
                                </code>
                              ) : (
                                detail
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
                <div className="flex-1">
                  <div className="mb-1">Open Terminal (or Command Prompt) and run:</div>
                  <code className="block bg-gray-50 border border-gray-100 rounded px-2 py-1 font-mono text-[10px]">
                    ollama pull gemma4:e2b
                  </code>
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span>
                <div>
                  Keep Ollama running in the background (it&rsquo;s a menu bar icon on Mac, system tray on Windows).
                </div>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0">5</span>
                <div>Click &ldquo;Test Connection&rdquo; below.</div>
              </li>
            </ol>
          </div>

          {/* Test Connection */}
          <button
            type="button"
            onClick={handleTestOllama}
            disabled={ollamaStatus === 'testing'}
            className="w-full py-2.5 px-4 text-sm font-medium border border-iron-600 text-iron-700 bg-white rounded-lg hover:bg-iron-50 disabled:opacity-60 transition-colors mb-3"
          >
            {ollamaStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>

          {ollamaStatus === 'success' && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 mb-3 flex items-start gap-2">
              <svg className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <p className="text-xs text-green-800">{ollamaMessage}</p>
            </div>
          )}

          {ollamaStatus === 'error' && (
            <div role="alert" className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-3 flex items-start gap-2">
              <svg className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <p className="text-xs text-yellow-800">{ollamaMessage}</p>
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex gap-2 mt-auto pt-3">
            <button
              type="button"
              onClick={() => setStep(6)}
              className="flex-1 px-4 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200"
            >
              Skip for now
            </button>
            <button
              type="button"
              onClick={() => setStep(6)}
              disabled={ollamaStatus !== 'success'}
              className="flex-1 py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Confirmation */}
      {step === 6 && (
        <div className="flex-1 flex flex-col">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-1">You're all set!</h2>
            {registrationData?.trialEndsAt && (
              <p className="text-sm text-iron-600 font-medium">
                Pro trial active &mdash; {Math.ceil((new Date(registrationData.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days remaining
              </p>
            )}
          </div>

          <div className="bg-white rounded-lg border p-4 mb-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Quick start</h3>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-iron-100 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-iron-700">1</div>
              <p className="text-xs text-gray-600">Open any supported AI tool (ChatGPT, Claude, Gemini)</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-iron-100 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-iron-700">2</div>
              <p className="text-xs text-gray-600">Start typing a prompt &mdash; Iron Gate scans automatically</p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 bg-iron-100 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-iron-700">3</div>
              <p className="text-xs text-gray-600">Check this side panel for real-time detection results</p>
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => { chrome.tabs.create({ url: 'https://chatgpt.com' }); }}
              className="flex-1 py-2.5 px-3 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Open ChatGPT
            </button>
            <button
              type="button"
              onClick={() => { chrome.tabs.create({ url: 'https://claude.ai' }); }}
              className="flex-1 py-2.5 px-3 text-xs font-medium bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Open Claude
            </button>
          </div>

          <button
            type="button"
            onClick={handleFinish}
            className="w-full py-3 px-4 text-sm font-semibold text-white bg-iron-600 rounded-lg hover:bg-iron-700 transition-colors mt-auto"
          >
            Start Monitoring
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
