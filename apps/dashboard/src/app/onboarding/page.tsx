'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApiClient } from '../../lib/api';

interface TeamMember {
  email: string;
  role: 'admin' | 'user';
}

interface OnboardingState {
  orgName: string;
  teamMembers: TeamMember[];
}

const TOTAL_STEPS = 4;
const STORAGE_KEY = 'iron-gate-onboarding';
const STEP_LABELS = ['Welcome', 'Demo', 'Extension', 'Done'];

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
  orgName: '',
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
  const [checkingFirm, setCheckingFirm] = useState(true);

  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);

  // If the user already belongs to a firm (invited by admin), skip onboarding
  useEffect(() => {
    let cancelled = false;
    async function checkFirm() {
      try {
        const res = await apiFetch('/admin/firm');
        if (!cancelled && res.ok) {
          router.replace('/');
          return;
        }
      } catch {
        // No firm or API unavailable — continue with onboarding
      }
      if (!cancelled) setCheckingFirm(false);
    }
    checkFirm();
    return () => { cancelled = true; };
  }, [apiFetch, router]);

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

  function canProceed(): boolean {
    switch (currentStep) {
      case 1:
        return state.orgName.trim().length > 0;
      default:
        return true;
    }
  }

  // Create firm + auto-start trial (called after Step 1)
  async function createFirm() {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const response = await apiFetch('/admin/firm', {
        method: 'POST',
        body: JSON.stringify({
          firmName: state.orgName,
          protectionMode: 'proxy',
          teamMembers: [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }

      setFirmCreated(true);
      setCurrentStep(2);

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
      console.warn('Firm creation API call failed:', err.message);
      setSubmitError(
        'Could not connect to the server. Your settings have been saved locally — they\'ll sync when the server is available.'
      );
      setFirmCreated(false);
      setCurrentStep(2); // still advance so user isn't blocked
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleNext() {
    if (currentStep === 1) {
      createFirm();
      return;
    }
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep((s) => s + 1);
    }
  }

  function handleBack() {
    if (currentStep > 1 && currentStep !== 2) {
      // Can't go back to step 1 after firm creation
      setCurrentStep((s) => s - 1);
    }
  }

  if (checkingFirm) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#141414] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
      </div>
    );
  }

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
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">Get started in 2 minutes</p>
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
                      {STEP_LABELS[i]}
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
            <StepWelcome state={state} updateState={updateState} isSubmitting={isSubmitting} />
          )}
          {currentStep === 2 && <StepDemo />}
          {currentStep === 3 && <StepExtension />}
          {currentStep === 4 && (
            <StepComplete
              state={state}
              firmCreated={firmCreated}
              submitError={submitError}
              onGoToDashboard={() => { sessionStorage.removeItem(STORAGE_KEY); router.push('/dashboard'); }}
              generatedApiKey={generatedApiKey}
              apiKeyError={apiKeyError}
              apiKeyCopied={apiKeyCopied}
              onCopyApiKey={() => {
                if (generatedApiKey) {
                  navigator.clipboard.writeText(generatedApiKey).then(() => {
                    setApiKeyCopied(true);
                    setTimeout(() => setApiKeyCopied(false), 3000);
                  }).catch(() => {});
                }
              }}
              teamMembers={state.teamMembers}
              onUpdateTeamMembers={(members) => updateState('teamMembers', members)}
            />
          )}

          {/* Navigation buttons */}
          {currentStep < 4 && (
            <div className="flex items-center justify-between mt-8">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep <= 2}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  currentStep <= 2
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
                  : currentStep === 1
                    ? 'Start Trial'
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
// Step 1: Welcome + Trial
// ============================================================================
function StepWelcome({
  state,
  updateState,
  isSubmitting,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  isSubmitting: boolean;
}) {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Welcome to Iron Gate</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          Your 15-day Pro trial starts now — no credit card required.
        </p>
      </div>

      {/* Trial badge */}
      <div className="bg-iron-50 dark:bg-iron-900/20 rounded-xl p-5 border-2 border-iron-200 dark:border-iron-700 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-iron-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">PRO</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-iron-800 dark:text-iron-200">15-day Pro Trial</p>
            <p className="text-xs text-iron-600 dark:text-iron-400">Full access. Cancel anytime. No card needed.</p>
          </div>
          <div className="flex-shrink-0 px-3 py-1 bg-iron-600 text-white text-xs font-semibold rounded-full">
            FREE
          </div>
        </div>
      </div>

      {/* Org name input */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
        <label htmlFor="orgName" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-1.5">
          Organization Name
        </label>
        <input
          id="orgName"
          type="text"
          value={state.orgName}
          onChange={(e) => updateState('orgName', e.target.value)}
          placeholder="e.g. Sterling & Associates LLP"
          disabled={isSubmitting}
          className="w-full px-4 py-2.5 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] dark:placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow disabled:opacity-50"
        />
      </div>

      {/* What Pro includes */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
        <h3 className="text-sm font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] mb-4">What&apos;s included in Pro</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '10,000 prompts/mo', icon: '~' },
            { label: '27+ entity types', icon: '#' },
            { label: 'Full dashboard analytics', icon: '=' },
            { label: 'Unlimited team members', icon: '+' },
          ].map((feature) => (
            <div key={feature.label} className="flex items-center gap-2.5 py-2">
              <div className="w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <span className="text-sm text-[#424245] dark:text-[#a1a1a6]">{feature.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 2: Interactive Demo
// ============================================================================

const DEMO_PROMPT = 'Draft an NDA between John Smith (SSN: 123-45-6789) and Acme Corp for the Project Falcon acquisition. Contact: john.smith@acme.com, phone 555-867-5309.';

const DEMO_ENTITIES = [
  { type: 'PERSON', text: 'John Smith', start: 26, end: 36, color: 'bg-blue-200 dark:bg-blue-800/50', textColor: 'text-blue-700 dark:text-blue-300' },
  { type: 'SSN', text: '123-45-6789', start: 43, end: 54, color: 'bg-red-200 dark:bg-red-800/50', textColor: 'text-red-700 dark:text-red-300' },
  { type: 'ORG', text: 'Acme Corp', start: 60, end: 69, color: 'bg-purple-200 dark:bg-purple-800/50', textColor: 'text-purple-700 dark:text-purple-300' },
  { type: 'EMAIL', text: 'john.smith@acme.com', start: 115, end: 134, color: 'bg-amber-200 dark:bg-amber-800/50', textColor: 'text-amber-700 dark:text-amber-300' },
  { type: 'PHONE', text: '555-867-5309', start: 142, end: 154, color: 'bg-teal-200 dark:bg-teal-800/50', textColor: 'text-teal-700 dark:text-teal-300' },
];

const DEMO_PSEUDONYMIZED = 'Draft an NDA between Robert Chen (SSN: 987-65-4321) and Vertex Inc for the Project Falcon acquisition. Contact: r.chen@vertex.io, phone 555-123-0042.';

function StepDemo() {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'detected' | 'pseudonymized'>('idle');
  const [scanProgress, setScanProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  function runDemo() {
    setPhase('scanning');
    setScanProgress(0);

    // Simulate scan progress
    let progress = 0;
    timerRef.current = setInterval(() => {
      progress += 8;
      setScanProgress(Math.min(progress, 100));
      if (progress >= 100) {
        clearInterval(timerRef.current);
        setPhase('detected');
        setTimeout(() => setPhase('pseudonymized'), 1500);
      }
    }, 50);
  }

  function resetDemo() {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('idle');
    setScanProgress(0);
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Build highlighted prompt text
  function renderHighlightedPrompt() {
    const parts: React.ReactNode[] = [];
    let cursor = 0;

    for (const entity of DEMO_ENTITIES) {
      if (cursor < entity.start) {
        parts.push(<span key={`t-${cursor}`}>{DEMO_PROMPT.slice(cursor, entity.start)}</span>);
      }
      parts.push(
        <span key={`e-${entity.start}`} className={`${entity.color} rounded px-0.5 py-0.5 font-medium`}>
          {entity.text}
          <span className={`ml-1 text-[10px] font-bold uppercase ${entity.textColor}`}>{entity.type}</span>
        </span>
      );
      cursor = entity.end;
    }
    if (cursor < DEMO_PROMPT.length) {
      parts.push(<span key={`t-${cursor}`}>{DEMO_PROMPT.slice(cursor)}</span>);
    }
    return parts;
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">See Iron Gate in Action</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          Watch how Iron Gate detects and protects sensitive data before it reaches the AI.
        </p>
      </div>

      {/* Demo area */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        {/* Prompt section */}
        <div className="p-6 border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#86868b]">Sample Prompt</span>
            {phase !== 'idle' && (
              <button type="button" onClick={resetDemo} className="text-xs text-iron-600 hover:text-iron-700 underline ml-auto">
                Reset
              </button>
            )}
          </div>
          <div className="text-sm leading-relaxed text-[#1d1d1f] dark:text-[#f5f5f7]">
            {phase === 'detected' || phase === 'pseudonymized'
              ? renderHighlightedPrompt()
              : DEMO_PROMPT
            }
          </div>
        </div>

        {/* Scan button / progress */}
        {phase === 'idle' && (
          <div className="p-6 text-center">
            <button
              type="button"
              onClick={runDemo}
              className="inline-flex items-center gap-2 px-6 py-3 bg-iron-600 text-white font-semibold rounded-xl hover:bg-iron-700 transition-colors shadow-lg shadow-iron-600/20"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Scan for Sensitive Data
            </button>
            <p className="text-xs text-[#86868b] mt-3">Click to see what Iron Gate detects in this prompt</p>
          </div>
        )}

        {phase === 'scanning' && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-5 h-5 border-2 border-iron-200 border-t-iron-600 rounded-full animate-spin flex-shrink-0" />
              <span className="text-sm font-medium text-iron-700 dark:text-iron-300">Scanning for sensitive data...</span>
            </div>
            <div className="h-2 bg-iron-100 dark:bg-iron-900/30 rounded-full overflow-hidden">
              <div
                className="h-full bg-iron-600 rounded-full transition-all duration-100"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Detected entities */}
        {(phase === 'detected' || phase === 'pseudonymized') && (
          <div className="p-6 border-b border-[#d2d2d7]/30 dark:border-[#38383a]/60">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                {DEMO_ENTITIES.length} sensitive entities detected
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {DEMO_ENTITIES.map((entity) => (
                <span
                  key={entity.type}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${entity.color} ${entity.textColor}`}
                >
                  {entity.type}
                  <span className="opacity-60">&#183;</span>
                  <span className="font-normal opacity-80">{entity.text}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Pseudonymized version */}
        {phase === 'pseudonymized' && (
          <div className="p-6 bg-green-50/50 dark:bg-green-900/10">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              <span className="text-sm font-semibold text-green-700 dark:text-green-300">Protected — sent to AI</span>
            </div>
            <p className="text-sm leading-relaxed text-[#424245] dark:text-[#a1a1a6]">
              {DEMO_PSEUDONYMIZED}
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-3 font-medium">
              Real data never leaves your organization. The AI sees only realistic pseudonyms.
            </p>
          </div>
        )}
      </div>

      {/* Explanation */}
      <div className="mt-6 p-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-lg">
        <p className="text-xs text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
          This is what Iron Gate does for every prompt your team sends — automatically, invisibly. The AI response is
          de-pseudonymized before your team sees it, so they get accurate, useful output with zero workflow changes.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: Install Extension
// ============================================================================
function StepExtension() {
  const extensionZipUrl = '/iron-gate-extension-v0.2.2.zip';

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Install the Extension</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-1">
          The Chrome extension protects your team&apos;s prompts in real-time.
        </p>
      </div>

      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 space-y-6">
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
            {[
              { num: '1', text: <><strong>Unzip</strong> the downloaded file to a folder on your computer.</> },
              { num: '2', text: <>Open <strong>chrome://extensions</strong>, enable <strong>Developer mode</strong> (top-right toggle).</> },
              { num: '3', text: <>Click <strong>&ldquo;Load unpacked&rdquo;</strong> and select the unzipped folder.</> },
            ].map((step) => (
              <li key={step.num} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-iron-100 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 rounded-full flex items-center justify-center text-xs font-semibold">{step.num}</span>
                <p className="text-sm text-[#424245] dark:text-[#a1a1a6]">{step.text}</p>
              </li>
            ))}
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

        {/* Note */}
        <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">Works automatically for your team</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-1 leading-relaxed">
                For enterprise-wide deployment via Chrome managed policies, visit <strong>Settings &rarr; Deployment</strong> after setup.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Step 4: You're All Set
// ============================================================================
function StepComplete({
  state,
  firmCreated,
  submitError,
  onGoToDashboard,
  generatedApiKey,
  apiKeyError,
  apiKeyCopied,
  onCopyApiKey,
  teamMembers,
  onUpdateTeamMembers,
}: {
  state: OnboardingState;
  firmCreated: boolean;
  submitError: string | null;
  onGoToDashboard: () => void;
  generatedApiKey: string | null;
  apiKeyError: string | null;
  apiKeyCopied: boolean;
  onCopyApiKey: () => void;
  teamMembers: TeamMember[];
  onUpdateTeamMembers: (members: TeamMember[]) => void;
}) {
  const [showInvite, setShowInvite] = useState(false);

  return (
    <div>
      <div className="mb-8 text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">You&apos;re Protected</h2>
        <p className="text-[#6e6e73] dark:text-[#86868b] mt-2">
          Iron Gate is ready to protect {state.orgName || 'your organization'}.
        </p>
      </div>

      {/* Trial countdown */}
      <div className="bg-iron-50 dark:bg-iron-900/20 rounded-xl p-5 border border-iron-200 dark:border-iron-700 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-iron-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">PRO</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-iron-800 dark:text-iron-200">15 days remaining in your Pro trial</p>
            <p className="text-xs text-iron-600 dark:text-iron-400">10,000 prompts/mo &middot; 27+ entity types &middot; Full analytics</p>
          </div>
        </div>
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
                Settings saved locally. They&apos;ll sync when the server is available.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* API Key */}
      {generatedApiKey && (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-xl p-6 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <h3 className="text-sm font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Your API Key</h3>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm font-mono text-[#1d1d1f] dark:text-[#f5f5f7] select-all break-all">
              {generatedApiKey}
            </code>
            <button
              type="button"
              onClick={onCopyApiKey}
              className={`flex-shrink-0 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                apiKeyCopied
                  ? 'bg-green-600 text-white'
                  : 'bg-iron-600 hover:bg-iron-700 text-white'
              }`}
            >
              {apiKeyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-[#6e6e73] dark:text-[#86868b] mt-2">
            Also available in Settings &rarr; API Keys.
          </p>
        </div>
      )}

      {apiKeyError && !generatedApiKey && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-700 mb-6">
          <p className="text-sm text-amber-700 dark:text-amber-400">{apiKeyError}</p>
        </div>
      )}

      {/* Go to Dashboard button */}
      <button
        type="button"
        onClick={onGoToDashboard}
        className="w-full px-6 py-3 bg-iron-600 text-white rounded-xl text-sm font-semibold hover:bg-iron-700 transition-colors mb-6"
      >
        Go to Dashboard
      </button>

      {/* Collapsible team invite */}
      <div className="bg-white dark:bg-[#1c1c1e] rounded-xl shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowInvite(!showInvite)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-[#424245] dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
        >
          <span>Invite team members (optional)</span>
          <svg
            className={`w-4 h-4 transition-transform ${showInvite ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {showInvite && (
          <div className="px-4 pb-4 space-y-3">
            {teamMembers.map((member, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="colleague@yourfirm.com"
                  value={member.email}
                  onChange={(e) => {
                    const updated = [...teamMembers];
                    updated[index] = { ...updated[index], email: e.target.value };
                    onUpdateTeamMembers(updated);
                  }}
                  className="flex-1 px-3 py-2 border border-[#d2d2d7] dark:border-[#38383a] rounded-lg text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] focus:outline-none focus:ring-2 focus:ring-iron-500 transition-shadow"
                />
                {teamMembers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onUpdateTeamMembers(teamMembers.filter((_, i) => i !== index))}
                    className="p-1.5 text-[#86868b] hover:text-red-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => onUpdateTeamMembers([...teamMembers, { email: '', role: 'user' }])}
              className="text-xs font-medium text-iron-600 hover:text-iron-700 transition-colors"
            >
              + Add another
            </button>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[
          { href: '/dashboard', title: 'Dashboard', description: 'View activity' },
          { href: '/admin', title: 'Settings', description: 'Configure policies' },
          { href: '/events', title: 'Events', description: 'Monitor prompts' },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="block p-4 bg-white dark:bg-[#1c1c1e] rounded-xl border border-[#d2d2d7]/40 dark:border-[#38383a]/60 hover:border-iron-300 dark:hover:border-iron-600 hover:shadow-sm transition-all text-center"
          >
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{link.title}</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">{link.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
