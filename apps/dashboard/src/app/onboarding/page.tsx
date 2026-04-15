'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useApiClient } from '../../lib/api';

/** Derive a human-readable org name from an email domain.
 *  e.g. "john@sterling-law.com" → "Sterling Law"
 *  Skips common free-mail domains. */
function orgNameFromEmail(email: string | undefined): string {
  if (!email) return '';
  const domain = email.split('@')[1];
  if (!domain) return '';
  const base = domain.split('.')[0];
  const freemail = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'aol', 'protonmail', 'zoho', 'mail', 'live', 'msn', 'yandex'];
  if (freemail.includes(base.toLowerCase())) return '';
  return base
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface TeamMember {
  email: string;
  role: 'admin' | 'user';
}

interface OnboardingState {
  orgName: string;
  teamMembers: TeamMember[];
}

const TOTAL_STEPS = 3;
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
  orgName: '',
  teamMembers: [
    { email: '', role: 'user' },
    { email: '', role: 'user' },
    { email: '', role: 'user' },
  ],
};

export default function OnboardingPage() {
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [firmCreated, setFirmCreated] = useState(false);
  const [checkingFirm, setCheckingFirm] = useState(true);

  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);

  // Auto-detect org name from email domain
  useEffect(() => {
    if (!isUserLoaded || !user) return;
    // Only auto-fill if user hasn't typed anything yet
    if (state.orgName) return;
    const email = user.primaryEmailAddress?.emailAddress;
    const suggested = orgNameFromEmail(email);
    if (suggested) {
      setState((prev) => ({ ...prev, orgName: suggested }));
    }
  }, [isUserLoaded, user]); // intentionally excluding state.orgName to only run on mount

  // If the user already belongs to a firm (invited by admin), skip onboarding
  useEffect(() => {
    let cancelled = false;
    async function checkFirm() {
      try {
        const res = await apiFetch('/admin/firm');
        if (!cancelled && res.ok) {
          const firm = await res.json();
          // Only skip onboarding if user already has their own firm (not the default placeholder)
          if (!firm.isDefaultFirm) {
            router.replace('/');
            return;
          }
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
        // Surface the ACTUAL problem instead of a generic "check your connection".
        // Users spent real time typing an org name; telling them "network" when
        // it's actually "your session expired" sends them to the wrong fix.
        let serverMsg = '';
        try {
          const body = await response.json();
          serverMsg = body?.error || body?.message || '';
        } catch { /* non-JSON body */ }

        if (response.status === 401 || response.status === 403) {
          throw new Error('auth');
        }
        if (response.status >= 500) {
          throw new Error(`server:${response.status}`);
        }
        throw new Error(`http:${response.status}:${serverMsg}`);
      }

      setFirmCreated(true);
      setCurrentStep(2);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'auth' || msg.includes('Session expired') || msg.includes('Authentication failed')) {
        setSubmitError(
          'Your sign-in session expired. Sign out and sign back in, then retry.'
        );
      } else if (msg.startsWith('server:')) {
        setSubmitError(
          'The IronGate API is currently unreachable (server error). If this persists for more than a minute, check status or contact support.'
        );
      } else if (msg.startsWith('http:')) {
        const status = msg.split(':')[1];
        const detail = msg.split(':').slice(2).join(':').trim();
        setSubmitError(
          `Server rejected the request (${status})${detail ? `: ${detail}` : ''}. Retry in a moment.`
        );
      } else if (msg.includes('aborted') || msg.includes('timeout') || msg.includes('Failed to fetch')) {
        setSubmitError(
          'Could not reach the IronGate API. This usually means the server is waking up from idle (can take ~30s) or your network is blocking it. Retry in 30 seconds.'
        );
      } else {
        setSubmitError(
          `Could not create your organization: ${msg}. Please retry.`
        );
      }
      setFirmCreated(false);
      // Stay on step 1 so user can retry — advancing without a firm causes
      // downstream failures (invite calls, missing firm context, etc.)
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
      setCurrentStep((s) => s - 1);
    }
  }

  function handleFinish() {
    sessionStorage.removeItem(STORAGE_KEY);
    router.push('/dashboard');
  }

  if (checkingFirm) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#141414] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-iron-200 border-t-iron-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#141414] flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="mb-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-iron-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-sm">IG</span>
          </div>
          <span className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">Iron Gate</span>
        </div>
      </div>

      {/* Card */}
      <div className="w-full max-w-md">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const step = i + 1;
            return (
              <div
                key={step}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step === currentStep
                    ? 'w-8 bg-iron-600'
                    : step < currentStep
                      ? 'w-4 bg-iron-400'
                      : 'w-4 bg-[#d2d2d7] dark:bg-[#38383a]'
                }`}
              />
            );
          })}
        </div>

        {currentStep === 1 && (
          <StepName
            state={state}
            updateState={updateState}
            isSubmitting={isSubmitting}
            onNext={handleNext}
            canProceed={canProceed()}
            submitError={submitError}
          />
        )}
        {currentStep === 2 && (
          <StepInvite
            state={state}
            updateState={updateState}
            onNext={handleNext}
            onBack={handleBack}
            firmCreated={firmCreated}
            submitError={submitError}
          />
        )}
        {currentStep === 3 && (
          <StepComplete
            orgName={state.orgName}
            onFinish={handleFinish}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Step 1: Name your organization (Wispr Flow / Figma style)
// ============================================================================
function StepName({
  state,
  updateState,
  isSubmitting,
  onNext,
  canProceed,
  submitError,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  isSubmitting: boolean;
  onNext: () => void;
  canProceed: boolean;
  submitError: string | null;
}) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
      <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
        Let&apos;s name your organization
      </h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        This is how your workspace will appear to your team.
      </p>

      <div className="mb-8">
        <label htmlFor="orgName" className="block text-sm font-medium text-[#424245] dark:text-[#a1a1a6] mb-2">
          Organization name
        </label>
        <input
          id="orgName"
          type="text"
          value={state.orgName}
          onChange={(e) => updateState('orgName', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canProceed && !isSubmitting) onNext(); }}
          placeholder="e.g. Sterling & Associates LLP"
          disabled={isSubmitting}
          autoFocus
          className="w-full px-4 py-3 border border-[#d2d2d7] dark:border-[#38383a] rounded-xl text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] dark:placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow disabled:opacity-50"
        />
      </div>

      {/* Error message */}
      {submitError && (
        <div className="mb-6 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700">
          <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
        </div>
      )}

      {/* Trial badge */}
      <div className="flex items-center gap-3 mb-8 p-3 bg-iron-50 dark:bg-iron-900/20 rounded-xl border border-iron-100 dark:border-iron-800">
        <div className="w-8 h-8 rounded-lg bg-iron-600 flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">PRO</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-iron-800 dark:text-iron-200">15-day Pro trial included</p>
          <p className="text-xs text-iron-600 dark:text-iron-400">No credit card required</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!canProceed || isSubmitting}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-colors ${
          canProceed && !isSubmitting
            ? 'bg-iron-600 text-white hover:bg-iron-700'
            : 'bg-[#d2d2d7]/40 dark:bg-[#38383a] text-[#86868b] dark:text-[#636366] cursor-not-allowed'
        }`}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Creating...
          </span>
        ) : submitError ? (
          'Retry'
        ) : (
          'Create'
        )}
      </button>
    </div>
  );
}

// ============================================================================
// Step 2: Invite your team (Wispr Flow style — 3 email inputs)
// ============================================================================
function StepInvite({
  state,
  updateState,
  onNext,
  onBack,
  firmCreated,
  submitError,
}: {
  state: OnboardingState;
  updateState: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
  onNext: () => void;
  onBack: () => void;
  firmCreated: boolean;
  submitError: string | null;
}) {
  const { apiFetch } = useApiClient();
  const [inviting, setInviting] = useState(false);

  async function handleInviteAndContinue() {
    const validEmails = state.teamMembers
      .map((m) => m.email.trim())
      .filter((email) => email.length > 0 && email.includes('@'));

    if (validEmails.length === 0) {
      onNext();
      return;
    }

    setInviting(true);
    try {
      // Send invites for each valid email
      for (const email of validEmails) {
        await apiFetch('/admin/users/invite', {
          method: 'POST',
          body: JSON.stringify({ email, role: 'user' }),
        }).catch(() => {}); // Don't block on invite failures
      }
    } catch {
      // Continue even if invites fail
    } finally {
      setInviting(false);
      onNext();
    }
  }

  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60">
      <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
        Invite your team to Iron Gate
      </h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        You can also add team members after setup.
      </p>

      {/* Server connectivity warning */}
      {!firmCreated && submitError && (
        <div className="mb-6 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Settings saved locally. They&apos;ll sync when the server is available.
          </p>
        </div>
      )}

      <div className="space-y-3 mb-8">
        {state.teamMembers.map((member, index) => (
          <input
            key={index}
            type="email"
            placeholder={`colleague${index + 1}@yourfirm.com`}
            value={member.email}
            onChange={(e) => {
              const updated = [...state.teamMembers];
              updated[index] = { ...updated[index], email: e.target.value };
              updateState('teamMembers', updated);
            }}
            className="w-full px-4 py-3 border border-[#d2d2d7] dark:border-[#38383a] rounded-xl text-sm text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] placeholder:text-[#86868b] dark:placeholder:text-[#636366] focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow"
          />
        ))}
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 rounded-xl text-sm font-semibold text-[#424245] dark:text-[#a1a1a6] bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#38383a] transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleInviteAndContinue}
          disabled={inviting}
          className="flex-[2] py-3 rounded-xl text-sm font-semibold bg-iron-600 text-white hover:bg-iron-700 transition-colors disabled:opacity-60"
        >
          {inviting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Sending...
            </span>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Step 3: You're all set
// ============================================================================
function StepComplete({
  orgName,
  onFinish,
}: {
  orgName: string;
  onFinish: () => void;
}) {
  return (
    <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-sm border border-[#d2d2d7]/40 dark:border-[#38383a]/60 text-center">
      {/* Success icon */}
      <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] mb-2">
        You&apos;re all set!
      </h2>
      <p className="text-sm text-[#6e6e73] dark:text-[#86868b] mb-8">
        {orgName} is ready to go. Your 15-day Pro trial has started.
      </p>

      {/* Quick start cards */}
      <div className="space-y-3 mb-8 text-left">
        <div className="flex items-center gap-3 p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-iron-100 dark:bg-iron-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Install the Chrome extension</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">Available in Settings &rarr; Extension</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-iron-100 dark:bg-iron-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Get your API key</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">Available in Settings &rarr; API Keys</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-iron-100 dark:bg-iron-900/30 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-iron-600 dark:text-iron-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Configure protection rules</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">Available in Settings &rarr; Protection</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onFinish}
        className="w-full py-3 rounded-xl text-sm font-semibold bg-iron-600 text-white hover:bg-iron-700 transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
