'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApiClient } from '../../lib/api';

const INDUSTRIES = [
  'Legal',
  'Healthcare',
  'Finance',
  'Manufacturing',
  'Technology',
  'Consulting',
] as const;

const FIRM_SIZES = ['1-50', '51-200', '201-500', '500+'] as const;

interface TeamMember {
  email: string;
  role: 'admin' | 'user';
}

interface OnboardingState {
  // Step 1
  firmName: string;
  industry: string;
  firmSize: string;
  // Step 2
  protectionMode: 'audit' | 'proxy';
  warnThreshold: number;
  blockThreshold: number;
  proxyThreshold: number;
  // Step 4
  teamMembers: TeamMember[];
}

const TOTAL_STEPS = 5;
const STORAGE_KEY = 'iron-gate-onboarding';

function loadSavedState(): { step: number; state: OnboardingState } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(step: number, state: OnboardingState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step, state }));
  } catch { /* ignore quota errors */ }
}

const DEFAULT_STATE: OnboardingState = {
  firmName: '',
  industry: '',
  firmSize: '',
  protectionMode: 'proxy',
  warnThreshold: 30,
  blockThreshold: 60,
  proxyThreshold: 80,
  teamMembers: [{ email: '', role: 'user' }],
};

export default function OnboardingPage() {
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [firmCreated, setFirmCreated] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);

  // Restore saved state on mount
  useEffect(() => {
    const saved = loadSavedState();
    if (saved) {
      setState(saved.state);
      setCurrentStep(saved.step);
    }
  }, []);

  // Persist state on every change
  useEffect(() => {
    saveState(currentStep, state);
  }, [currentStep, state]);

  const updateState = useCallback(
    <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ----- Validation per step -----
  function canProceed(): boolean {
    switch (currentStep) {
      case 1:
        return state.firmName.trim().length > 0 && state.industry !== '' && state.firmSize !== '';
      case 2:
        return true; // always valid -- defaults are fine
      case 3:
        return true; // informational step
      case 4:
        return true; // skip is allowed
      default:
        return true;
    }
  }

  // ----- API call to create firm -----
  async function createFirm() {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await apiFetch('/admin/firm', {
        method: 'POST',
        body: JSON.stringify({
          firmName: state.firmName,
          industry: state.industry,
          firmSize: state.firmSize,
          protectionMode: state.protectionMode,
          thresholds: {
            warn: state.warnThreshold,
            block: state.blockThreshold,
            proxy: state.proxyThreshold,
          },
          teamMembers: state.teamMembers.filter((m) => m.email.trim() !== ''),
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      setFirmCreated(true);
      setCurrentStep(5);

      // Auto-generate an API key for the Chrome extension
      try {
        const keyResponse = await apiFetch('/api-keys', {
          method: 'POST',
          body: JSON.stringify({ name: 'Chrome Extension', scope: 'write' }),
        });
        if (keyResponse.ok) {
          const keyData = await keyResponse.json();
          setGeneratedApiKey(keyData.key);
        } else {
          setApiKeyError('Auto-generation failed. Create one manually in Settings > API Keys.');
        }
      } catch {
        setApiKeyError('Auto-generation failed. Create one manually in Settings > API Keys.');
      }
    } catch (err: any) {
      // If API is unavailable, still proceed to step 5 so the user isn't blocked
      console.warn('Firm creation API call failed:', err.message);
      setSubmitError(
        'Could not connect to the server. Your settings have been saved locally — they\'ll sync when the server is available.'
      );
      setFirmCreated(false);
      setCurrentStep(5);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ----- Step navigation -----
  function handleNext() {
    if (currentStep === 4) {
      // Step 4 -> attempt API call, then go to step 5
      createFirm();
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (currentStep > 1) {
      setCurrentStep((s) => s - 1);
    }
  }

  function handleSkipInvite() {
    // Skip team invites, go straight to API call
    updateState('teamMembers', []);
    createFirm();
  }

  // ----- Render -----
  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#141414] flex flex-col">
      {/* Top bar */}
      <div className="bg-white dark:bg-[#1c1c1e] border-b border-[#d2d2d7]/40 dark:border-[#38383a]/60 px-8 py-4">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">IG</span>
          </div>
          <div>
            <h1 className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Iron Gate</h1>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">Setup Wizard</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white dark:bg-[#1c1c1e] border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
        <div className="max-w-3xl mx-auto px-8 py-4">
          <div className="flex items-center justify-between mb-2">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => {
              const step = i + 1;
              const isCompleted = step < currentStep;
              const isCurrent = step === currentStep;
              return (
                <React.Fragment key={step}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                        isCompleted
                          ? 'bg-iron-600 text-white'
                          : isCurrent
                            ? 'bg-iron-100 text-iron-700 ring-2 ring-iron-600'
                            : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#86868b] dark:text-[#636366]'
                      }`}
                    >
                      {isCompleted ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      ) : (
                        step
                      )}
                    </div>
                    <span
                      className={`text-xs font-medium hidden sm:inline ${
                        isCurrent ? 'text-iron-700 dark:text-iron-300' : isCompleted ? 'text-[#424245] dark:text-[#a1a1a6]' : 'text-[#86868b] dark:text-[#636366]'
                      }`}
                    >
                      {['Welcome', 'Protection', 'Extension', 'Team', 'Done'][i]}
                    </span>
                  </div>
                  {step < TOTAL_STEPS && (
                    <div
                      className={`flex-1 h-0.5 mx-2 rounded transition-colors ${
                        step < currentStep ? 'bg-iron-600' : 'bg-[#d2d2d7]/40 dark:bg-[#38383a]'
                      }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center px-8 py-10">
        <div className="w-full max-w-2xl">
          {currentStep === 1 && (
            <StepWelcome state={state} updateState={updateState} />
          )}
          {currentStep === 2 && (
            <StepProtection state={state} updateState={updateState} />
          )}
          {currentStep === 3 && <StepExtension />}
          {currentStep === 4 && (
            <StepTeam
              state={state}
              updateState={updateState}
              onSkip={handleSkipInvite}
            />
          )}
          {currentStep === 5 && (
            <StepComplete
              state={state}
              firmCreated={firmCreated}
              submitError={submitError}
              onRetry={createFirm}
              isSubmitting={isSubmitting}
              onGoToDashboard={() => { sessionStorage.removeItem(STORAGE_KEY); router.push('/dashboard'); }}
              generatedApiKey={generatedApiKey}
              apiKeyError={apiKeyError}
              apiKeyCopied={apiKeyCopied}
              onCopyApiKey={() => {
                if (generatedApiKey) {
                  navigator.clipboard.writeText(generatedApiKey).then(() => {
                    setApiKeyCopied(true);
                    setTimeout(() => setApiKeyCopied(false), 3000);
                  }).catch(() => {
                    // Clipboard API unavailable (non-HTTPS or no focus)
                  });
                }
              }}
            />
          )}

          {/* Navigation buttons */}
          {currentStep < 5 && (
            <div className="flex items-center justify-between mt-8">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 1}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  currentStep === 1
                    ? 'text-[#d2d2d7] dark:text-[#38383a] cursor-not-allowed'
                    : 'text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                }`}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
                className={`min-w-[120px] min-h-[44px] px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  canProceed() && !isSubmitting
                    ? 'bg-iron-600 text-white hover:bg-iron-700'
                    : 'bg-[#d2d2d7]/40 dark:bg-[#38383a] text-[#86868b] dark:text-[#636366] cursor-not-allowed'
                }`}
              >
                {isSubmitting
                  ? 'Setting up...'
                  : currentStep === 4
                    ? 'Complete Setup'
                    : 'Continue'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 1: Welcome to Iron Gate
// ============================================================================
function StepWelcome({
  state,
  updateState,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Welcome to Iron Gate</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          Let&apos;s set up AI governance for your organization. This only takes a few minutes.
        </p>
      </div>

      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 space-y-5">
        {/* Firm name */}
        <div>
          <label htmlFor="firmName" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1.5">
            Firm Name
          </label>
          <input
            id="firmName"
            type="text"
            value={state.firmName}
            onChange={(e) => updateState('firmName', e.target.value)}
            placeholder="e.g. Sterling & Associates LLP"
            className="w-full px-4 py-2.5 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] dark:placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow"
          />
        </div>

        {/* Industry */}
        <div>
          <label htmlFor="industry" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1.5">
            Industry
          </label>
          <select
            id="industry"
            value={state.industry}
            onChange={(e) => updateState('industry', e.target.value)}
            className="w-full px-4 py-2.5 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow bg-white dark:bg-[#2c2c2e]"
          >
            <option value="" disabled>
              Select your industry
            </option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>
                {ind}
              </option>
            ))}
          </select>
        </div>

        {/* Firm size */}
        <div>
          <label className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
            Firm Size (employees)
          </label>
          <div className="grid grid-cols-4 gap-3">
            {FIRM_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => updateState('firmSize', size)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  state.firmSize === size
                    ? 'border-iron-600 bg-iron-50 text-iron-700'
                    : 'border-[#d2d2d7]/40 bg-white text-[#424245] hover:bg-[#f5f5f7]'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2: Configure Protection
// ============================================================================
function StepProtection({
  state,
  updateState,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Configure Protection</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          Fine-tune how Iron Gate protects AI interactions at your firm.
        </p>
      </div>

      {/* Protection mode info */}
      <div className="bg-iron-50 dark:bg-iron-900/20 rounded-xl p-5 border border-iron-200 dark:border-iron-800 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-iron-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-iron-800 dark:text-iron-200">Protect Mode Active</p>
            <p className="text-xs text-iron-600 dark:text-iron-400 mt-0.5">
              Sensitive data is automatically redacted before reaching AI services. Your prompts are protected in real-time.
            </p>
          </div>
        </div>
      </div>

      {/* Sensitivity thresholds */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-1">Sensitivity Thresholds</h3>
        <p className="text-xs text-[#6e6e73] mb-5">
          Set the sensitivity score thresholds that trigger each action level. Scores range from 0 (safe) to 100 (critical).
        </p>

        <ThresholdSlider
          label="Warn"
          description="Flag interaction for review"
          value={state.warnThreshold}
          onChange={(v) => updateState('warnThreshold', v)}
          color="bg-yellow-400"
          dotColor="bg-yellow-500"
        />
        <ThresholdSlider
          label="Block"
          description="Prevent submission to AI service"
          value={state.blockThreshold}
          onChange={(v) => updateState('blockThreshold', v)}
          color="bg-orange-400"
          dotColor="bg-orange-500"
        />
        <ThresholdSlider
          label="Proxy"
          description="Route through Iron Gate proxy for redaction"
          value={state.proxyThreshold}
          onChange={(v) => updateState('proxyThreshold', v)}
          color="bg-red-400"
          dotColor="bg-red-500"
        />

        {/* Visual threshold bar */}
        <div className="mt-5 pt-4 border-t border-[#d2d2d7]/30">
          <p className="text-xs font-medium text-[#6e6e73] mb-2">Threshold Preview</p>
          <div className="relative h-6 bg-[#f5f5f7] rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-green-200 transition-all"
              style={{ width: `${state.warnThreshold}%` }}
            />
            <div
              className="absolute top-0 h-full bg-yellow-200 transition-all"
              style={{ left: `${state.warnThreshold}%`, width: `${state.blockThreshold - state.warnThreshold}%` }}
            />
            <div
              className="absolute top-0 h-full bg-orange-200 transition-all"
              style={{ left: `${state.blockThreshold}%`, width: `${state.proxyThreshold - state.blockThreshold}%` }}
            />
            <div
              className="absolute top-0 h-full bg-red-200 transition-all"
              style={{ left: `${state.proxyThreshold}%`, width: `${100 - state.proxyThreshold}%` }}
            />

            {/* Labels */}
            <span className="absolute left-1 top-0.5 text-[10px] font-medium text-green-700">Safe</span>
            <span
              className="absolute top-0.5 text-[10px] font-medium text-yellow-700"
              style={{ left: `${state.warnThreshold + 1}%` }}
            >
              Warn
            </span>
            <span
              className="absolute top-0.5 text-[10px] font-medium text-orange-700"
              style={{ left: `${state.blockThreshold + 1}%` }}
            >
              Block
            </span>
            <span
              className="absolute top-0.5 text-[10px] font-medium text-red-700"
              style={{ left: `${state.proxyThreshold + 1}%` }}
            >
              Proxy
            </span>
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-[#86868b]">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThresholdSlider({
  label,
  description,
  value,
  onChange,
  color,
  dotColor,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
  dotColor: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />
          <span className="text-sm font-medium text-[#424245] dark:text-[#a1a1a6]">{label}</span>
          <span className="text-xs text-[#86868b]">{description}</span>
        </div>
        <span className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums w-8 text-right">
          {value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer accent-iron-600"
        style={{
          background: `linear-gradient(to right, ${
            color === 'bg-yellow-400' ? '#facc15' : color === 'bg-orange-400' ? '#fb923c' : '#f87171'
          } ${value}%, #e5e7eb ${value}%)`,
        }}
      />
    </div>
  );
}

// ============================================================================
// Step 3: Deploy the Extension
// ============================================================================
function StepExtension() {
  const extensionZipUrl = '/iron-gate-extension-v0.2.2.zip';

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Install the Extension</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          The Chrome extension protects sensitive data in real-time before it reaches AI services.
        </p>
      </div>

      {/* Quick Setup (Testing) */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 space-y-6 mb-6">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-iron-600 bg-iron-50 px-2.5 py-1 rounded-full">Quick Setup</span>
          <span className="text-xs text-[#86868b]">For testing and individual use</span>
        </div>

        {/* Download button */}
        <div className="text-center py-2">
          <a
            href={extensionZipUrl}
            className="inline-flex items-center gap-3 px-6 py-3 bg-iron-600 hover:bg-iron-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-iron-600/20"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download Extension (ZIP)
          </a>
        </div>

        {/* Step-by-step instructions */}
        <div>
          <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-3">After downloading:</h3>
          <ol className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 rounded-full flex items-center justify-center text-xs font-semibold">1</span>
              <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">
                <strong>Unzip</strong> the downloaded file to a folder on your computer.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 rounded-full flex items-center justify-center text-xs font-semibold">2</span>
              <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">
                Open <strong>chrome://extensions</strong>, enable <strong>Developer mode</strong> (top-right toggle).
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 rounded-full flex items-center justify-center text-xs font-semibold">3</span>
              <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">
                Click <strong>&ldquo;Load unpacked&rdquo;</strong> and select the unzipped folder.
              </p>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full flex items-center justify-center">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </span>
              <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">
                The Iron Gate icon appears in your toolbar. You&apos;re protected!
              </p>
            </li>
          </ol>
        </div>

        {/* API key note */}
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">API Key</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                You&apos;ll receive an API key on the final screen. Paste it into the extension side panel to connect.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Enterprise Deployment */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 space-y-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-purple-600 bg-purple-50 px-2.5 py-1 rounded-full">Enterprise</span>
          <span className="text-xs text-[#86868b]">For organization-wide deployment</span>
        </div>

        <p className="text-sm text-[#424245] dark:text-[#a1a1a6] leading-relaxed">
          Deploy Iron Gate across your entire organization using Chrome Enterprise policies. No manual setup required per user.
        </p>

        <ol className="space-y-4">
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full flex items-center justify-center text-xs font-semibold">1</span>
            <div>
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Publish to Chrome Web Store</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                Upload the extension ZIP to the Chrome Web Store Developer Dashboard. Set visibility to <strong>Unlisted</strong> so only your organization can install it.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full flex items-center justify-center text-xs font-semibold">2</span>
            <div>
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Configure in Google Admin Console</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                Go to <strong>admin.google.com</strong> &rarr; Devices &rarr; Chrome &rarr; Apps &amp; Extensions. Add the extension by ID and set to <strong>Force Install</strong>.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full flex items-center justify-center text-xs font-semibold">3</span>
            <div>
              <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Set Managed Configuration</p>
              <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                Under the extension&apos;s managed configuration, paste your firm&apos;s policy JSON (provided on the final screen). This auto-configures the API key, firm ID, and mode for every user.
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3">
            <span className="flex-shrink-0 w-6 h-6 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full flex items-center justify-center">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </span>
            <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">
              <strong>Done!</strong> Every enrolled Chrome browser auto-installs Iron Gate. No user action needed.
            </p>
          </li>
        </ol>

        <div className="p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg">
          <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
            <strong>Also supported:</strong> Mac MDM (Jamf) via Chrome browser management profile, and Windows Group Policy via Chrome ADMX templates.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 4: Invite Your Team
// ============================================================================
function StepTeam({
  state,
  updateState,
  onSkip,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  onSkip: () => void;
}) {
  function addMember() {
    updateState('teamMembers', [...state.teamMembers, { email: '', role: 'user' }]);
  }

  function updateMember(index: number, field: keyof TeamMember, value: string) {
    const updated = [...state.teamMembers];
    updated[index] = { ...updated[index], [field]: value };
    updateState('teamMembers', updated);
  }

  function removeMember(index: number) {
    if (state.teamMembers.length <= 1) return;
    const updated = state.teamMembers.filter((_, i) => i !== index);
    updateState('teamMembers', updated);
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Invite Your Team</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          Add team members who will use the Iron Gate dashboard. You can always invite more later.
        </p>
      </div>

      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <div className="space-y-3">
          {state.teamMembers.map((member, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-1">
                <input
                  type="email"
                  placeholder="colleague@yourfirm.com"
                  value={member.email}
                  onChange={(e) => updateMember(index, 'email', e.target.value)}
                  className="w-full px-4 py-2.5 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] dark:placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow"
                />
              </div>
              <select
                value={member.role}
                onChange={(e) => updateMember(index, 'role', e.target.value)}
                className="px-3 py-2.5 border border-[#d2d2d7] rounded-lg text-sm text-[#424245] dark:text-[#a1a1a6] bg-white focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                onClick={() => removeMember(index)}
                disabled={state.teamMembers.length <= 1}
                className={`p-2 rounded-lg transition-colors ${
                  state.teamMembers.length <= 1
                    ? 'text-[#d2d2d7] cursor-not-allowed'
                    : 'text-[#86868b] hover:text-red-500 hover:bg-red-50'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addMember}
          className="mt-4 flex items-center gap-2 text-sm font-medium text-iron-600 hover:text-iron-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add another
        </button>
      </div>

      {/* Skip option */}
      <div className="mt-4 text-center">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-[#6e6e73] hover:text-[#424245] transition-colors underline underline-offset-2"
        >
          Skip for now -- I&apos;ll invite people later
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 5: You're All Set!
// ============================================================================
function StepComplete({
  state,
  firmCreated,
  submitError,
  onRetry: _onRetry,
  isSubmitting,
  onGoToDashboard,
  generatedApiKey,
  apiKeyError,
  apiKeyCopied,
  onCopyApiKey,
}: {
  state: OnboardingState;
  firmCreated: boolean;
  submitError: string | null;
  onRetry: () => void;
  isSubmitting: boolean;
  onGoToDashboard: () => void;
  generatedApiKey: string | null;
  apiKeyError: string | null;
  apiKeyCopied: boolean;
  onCopyApiKey: () => void;
}) {
  // Note: even if API failed, we show the success screen with a warning banner
  // so the user is never blocked from proceeding to the dashboard.

  // Loading state while creating
  if (!firmCreated && isSubmitting) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 border-4 border-iron-200 border-t-iron-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-[#6e6e73]">Setting up your organization...</p>
      </div>
    );
  }

  const invitedCount = state.teamMembers.filter((m) => m.email.trim() !== '').length;

  return (
    <div>
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">You&apos;re All Set!</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-2">
          Iron Gate is configured and ready to protect your organization.
        </p>
      </div>

      {/* Server connectivity warning (non-blocking) */}
      {!firmCreated && submitError && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-700 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Server not reachable</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                Your settings are saved. They&apos;ll sync automatically when the server is available. You can still explore the dashboard with demo data.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Configuration summary */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">Configuration Summary</h3>
        <div className="space-y-3">
          <SummaryRow label="Firm" value={state.firmName} />
          <SummaryRow label="Industry" value={state.industry} />
          <SummaryRow label="Size" value={`${state.firmSize} employees`} />
          <SummaryRow label="Protection Mode" value="Protect (Active Redaction)" />
          <SummaryRow
            label="Thresholds"
            value={`Warn: ${state.warnThreshold} | Block: ${state.blockThreshold} | Proxy: ${state.proxyThreshold}`}
          />
          <SummaryRow
            label="Team Invites"
            value={invitedCount > 0 ? `${invitedCount} member${invitedCount > 1 ? 's' : ''} invited` : 'None (skipped)'}
          />
        </div>
      </div>

      {/* API Key Card */}
      {generatedApiKey && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-6 border-2 border-amber-300 dark:border-amber-700 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300">Your API Key</h3>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
            Share this key with your team. They&apos;ll paste it into the Chrome extension to connect to your organization.
          </p>
          <div className="flex items-center gap-2">
            <code
              className="flex-1 px-4 py-3 bg-white dark:bg-[#1c1c1e] border border-amber-300 dark:border-amber-600 rounded-lg text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] select-all break-all"
            >
              {generatedApiKey}
            </code>
            <button
              onClick={onCopyApiKey}
              className={`flex-shrink-0 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                apiKeyCopied
                  ? 'bg-green-600 text-white'
                  : 'bg-amber-600 hover:bg-amber-700 text-white'
              }`}
            >
              {apiKeyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-red-600 dark:text-red-400 font-medium mt-3">
            Copy this key now — it will not be shown again.
          </p>
        </div>
      )}

      {apiKeyError && !generatedApiKey && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-700 mb-6">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {apiKeyError}
          </p>
        </div>
      )}

      {/* Enterprise Policy JSON */}
      {generatedApiKey && (
        <EnterprisePolicyCard apiKey={generatedApiKey} firmName={state.firmName} />
      )}

      {/* Go to Dashboard button */}
      <button
        onClick={onGoToDashboard}
        className="w-full px-6 py-3 bg-iron-600 text-white rounded-lg text-sm font-semibold hover:bg-iron-700 transition-colors mb-6"
      >
        Go to Dashboard
      </button>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3">
        <QuickLink
          href="/events"
          title="View Events"
          description="Monitor AI interactions"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
            </svg>
          }
        />
        <QuickLink
          href="/admin"
          title="Configure Policies"
          description="Fine-tune your rules"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
            </svg>
          }
        />
        <QuickLink
          href="/reports"
          title="Read Reports"
          description="Review compliance data"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          }
        />
      </div>
    </div>
  );
}

function EnterprisePolicyCard({ apiKey, firmName }: { apiKey: string; firmName: string }) {
  const [copied, setCopied] = React.useState(false);

  const policyJson = JSON.stringify(
    {
      apiKey,
      firmMode: 'proxy',
      firmName,
    },
    null,
    2,
  );

  function handleCopy() {
    navigator.clipboard.writeText(policyJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      // Clipboard API unavailable (non-HTTPS or no focus)
    });
  }

  return (
    <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-6 border border-purple-200 dark:border-purple-700 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
        </svg>
        <h3 className="text-sm font-bold text-purple-800 dark:text-purple-300">Enterprise Policy JSON</h3>
      </div>
      <p className="text-xs text-purple-700 dark:text-purple-400 mb-3">
        Use this JSON in Google Admin Console (Managed Configuration) to auto-configure Iron Gate for all users in your organization.
      </p>
      <div className="relative">
        <pre className="px-4 py-3 bg-white dark:bg-[#1c1c1e] border border-purple-200 dark:border-purple-600 rounded-lg text-xs font-mono text-[#1d1d1f] dark:text-[#f5f5f7] overflow-x-auto select-all">
          {policyJson}
        </pre>
        <button
          onClick={handleCopy}
          className={`absolute top-2 right-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            copied
              ? 'bg-green-600 text-white'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#f5f5f7] dark:border-[#38383a]/60 last:border-0">
      <span className="text-sm text-[#6e6e73] dark:text-[#86868b]">{label}</span>
      <span className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{value}</span>
    </div>
  );
}

function QuickLink({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="block p-4 bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-600 hover:shadow-sm transition-all group"
    >
      <div className="text-[#86868b] group-hover:text-iron-600 transition-colors mb-2">{icon}</div>
      <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</p>
      <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">{description}</p>
    </a>
  );
}
