import React, { useState, useCallback, useEffect } from 'react';
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

type Industry = 'legal' | 'finance' | 'tech' | 'healthcare';

const INDUSTRIES: { id: Industry; label: string; icon: string; desc: string }[] = [
  { id: 'legal', label: 'Legal', icon: '\u2696\uFE0F', desc: 'Law firms, legal departments' },
  { id: 'finance', label: 'Finance', icon: '\uD83C\uDFE6', desc: 'Banks, investment, accounting' },
  { id: 'tech', label: 'Technology', icon: '\uD83D\uDCBB', desc: 'Software, IT, startups' },
  { id: 'healthcare', label: 'Healthcare', icon: '\uD83C\uDFE5', desc: 'Hospitals, clinics, pharma' },
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
      const res = await fetch(`${DEFAULT_API_URL}/auth/validate-firm-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmCode: firmCode.trim() }),
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

  // Register
  const handleRegister = useCallback(async () => {
    if (!isValidEmail(email)) {
      setRegisterError('Please enter a valid email address.');
      return;
    }
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
      } catch {}

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
      } catch {}

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
        {[1, 2, 3, 4, 5].map((s) => (
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

      {/* Step 5: Confirmation */}
      {step === 5 && (
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
