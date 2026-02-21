'use client';

import React, { useState, useCallback } from 'react';
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

type ProtectionMode = 'audit' | 'proxy';

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
  protectionMode: ProtectionMode;
  warnThreshold: number;
  blockThreshold: number;
  proxyThreshold: number;
  // Step 4
  teamMembers: TeamMember[];
}

const TOTAL_STEPS = 5;

export default function OnboardingPage() {
  const router = useRouter();
  const { apiFetch } = useApiClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [firmCreated, setFirmCreated] = useState(false);

  const [state, setState] = useState<OnboardingState>({
    firmName: '',
    industry: '',
    firmSize: '',
    protectionMode: 'audit',
    warnThreshold: 30,
    blockThreshold: 60,
    proxyThreshold: 80,
    teamMembers: [{ email: '', role: 'user' }],
  });

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
    } catch (err: any) {
      setSubmitError(
        err.message || 'Failed to create firm. Please check your connection and try again.'
      );
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <div className="w-9 h-9 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">IG</span>
          </div>
          <div>
            <h1 className="font-bold text-gray-900">Iron Gate</h1>
            <p className="text-xs text-gray-500">Setup Wizard</p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-100">
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
                            : 'bg-gray-100 text-gray-400'
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
                        isCurrent ? 'text-iron-700' : isCompleted ? 'text-gray-700' : 'text-gray-400'
                      }`}
                    >
                      {['Welcome', 'Protection', 'Extension', 'Team', 'Done'][i]}
                    </span>
                  </div>
                  {step < TOTAL_STEPS && (
                    <div
                      className={`flex-1 h-0.5 mx-2 rounded transition-colors ${
                        step < currentStep ? 'bg-iron-600' : 'bg-gray-200'
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
              onGoToDashboard={() => router.push('/')}
            />
          )}

          {/* Error banner (shown on step 4 if API fails before advancing to 5) */}
          {submitError && currentStep === 4 && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-red-700">{submitError}</p>
              </div>
              <button
                onClick={createFirm}
                disabled={isSubmitting}
                className="mt-2 text-sm font-medium text-red-700 hover:text-red-800 underline"
              >
                {isSubmitting ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          )}

          {/* Navigation buttons */}
          {currentStep < 5 && (
            <div className="flex items-center justify-between mt-8">
              <button
                onClick={handleBack}
                disabled={currentStep === 1}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  currentStep === 1
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                Back
              </button>
              <button
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
                className={`px-6 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  canProceed() && !isSubmitting
                    ? 'bg-iron-600 text-white hover:bg-iron-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
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
        <h2 className="text-2xl font-bold text-gray-900">Welcome to Iron Gate</h2>
        <p className="text-gray-500 mt-1">
          Let&apos;s set up AI governance for your organization. This only takes a few minutes.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-5">
        {/* Firm name */}
        <div>
          <label htmlFor="firmName" className="block text-sm font-medium text-gray-700 mb-1.5">
            Firm Name
          </label>
          <input
            id="firmName"
            type="text"
            value={state.firmName}
            onChange={(e) => updateState('firmName', e.target.value)}
            placeholder="e.g. Sterling & Associates LLP"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow"
          />
        </div>

        {/* Industry */}
        <div>
          <label htmlFor="industry" className="block text-sm font-medium text-gray-700 mb-1.5">
            Industry
          </label>
          <select
            id="industry"
            value={state.industry}
            onChange={(e) => updateState('industry', e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow bg-white"
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
          <label className="block text-sm font-medium text-gray-700 mb-2">
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
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
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
        <h2 className="text-2xl font-bold text-gray-900">Configure Protection</h2>
        <p className="text-gray-500 mt-1">
          Choose how Iron Gate monitors and protects AI interactions at your firm.
        </p>
      </div>

      {/* Mode selection */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <ModeCard
          title="Audit Mode"
          subtitle="Monitor Only"
          description="Observe AI usage across your organization without interfering. Ideal for understanding current patterns before enforcing policies."
          pros={['Zero disruption to workflows', 'Full visibility into AI usage', 'Builds data for informed policy decisions']}
          cons={['No active blocking of sensitive data', 'Relies on post-hoc review']}
          isSelected={state.protectionMode === 'audit'}
          onSelect={() => updateState('protectionMode', 'audit')}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          }
        />
        <ModeCard
          title="Proxy Mode"
          subtitle="Active Protection"
          description="Intercept and filter AI interactions in real-time. Sensitive content is blocked or redacted before reaching external AI services."
          pros={['Real-time sensitive data protection', 'Automatic PII redaction', 'Enforces compliance policies instantly']}
          cons={['May add slight latency to requests', 'Requires extension in proxy mode']}
          isSelected={state.protectionMode === 'proxy'}
          onSelect={() => updateState('protectionMode', 'proxy')}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
          }
        />
      </div>

      {/* Sensitivity thresholds */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Sensitivity Thresholds</h3>
        <p className="text-xs text-gray-500 mb-5">
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
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Threshold Preview</p>
          <div className="relative h-6 bg-gray-100 rounded-full overflow-hidden">
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
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
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

function ModeCard({
  title,
  subtitle,
  description,
  pros,
  cons,
  isSelected,
  onSelect,
  icon,
}: {
  title: string;
  subtitle: string;
  description: string;
  pros: string[];
  cons: string[];
  isSelected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-xl p-5 border-2 transition-all ${
        isSelected
          ? 'border-iron-600 bg-iron-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            isSelected ? 'bg-iron-600 text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      <p className="text-xs text-gray-600 mb-3 leading-relaxed">{description}</p>
      <div className="space-y-1.5">
        {pros.map((pro) => (
          <div key={pro} className="flex items-start gap-1.5">
            <svg className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="text-xs text-gray-600">{pro}</span>
          </div>
        ))}
        {cons.map((con) => (
          <div key={con} className="flex items-start gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <span className="text-xs text-gray-500">{con}</span>
          </div>
        ))}
      </div>
    </button>
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
          <span className="text-sm font-medium text-gray-700">{label}</span>
          <span className="text-xs text-gray-400">{description}</span>
        </div>
        <span className="text-sm font-semibold text-gray-900 tabular-nums w-8 text-right">
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
  const [copied, setCopied] = useState(false);

  const extensionUrl = 'https://github.com/ssiddharthsoni-spec/irongate2/releases';

  function handleCopy() {
    navigator.clipboard.writeText(extensionUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Deploy the Extension</h2>
        <p className="text-gray-500 mt-1">
          Install the Iron Gate Chrome extension to begin monitoring AI tool usage.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 space-y-6">
        {/* Step-by-step instructions */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Installation Steps</h3>
          <ol className="space-y-3">
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-xs font-semibold">
                1
              </span>
              <div>
                <p className="text-sm text-gray-700">
                  Download the latest extension build from the releases page below.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-xs font-semibold">
                2
              </span>
              <div>
                <p className="text-sm text-gray-700">
                  Open <strong>chrome://extensions</strong>, enable <strong>Developer mode</strong>, and click <strong>&ldquo;Load unpacked&rdquo;</strong>.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-xs font-semibold">
                3
              </span>
              <div>
                <p className="text-sm text-gray-700">
                  Select the <strong>dist</strong> folder from the downloaded extension build.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-iron-100 text-iron-700 rounded-full flex items-center justify-center text-xs font-semibold">
                4
              </span>
              <div>
                <p className="text-sm text-gray-700">
                  The Iron Gate icon will appear in your toolbar. You&apos;re protected!
                </p>
              </div>
            </li>
          </ol>
        </div>

        {/* Copy-able link */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Extension Install Link
          </label>
          <div className="flex items-center gap-2">
            <div className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 font-mono truncate">
              {extensionUrl}
            </div>
            <button
              onClick={handleCopy}
              className="px-4 py-2.5 bg-iron-600 text-white rounded-lg text-sm font-medium hover:bg-iron-700 transition-colors flex items-center gap-2 flex-shrink-0"
            >
              {copied ? (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                  </svg>
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        {/* Enterprise deployment note */}
        <div className="p-4 bg-iron-50 rounded-lg border border-iron-100">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-iron-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-iron-800">Enterprise Deployment</p>
              <p className="text-xs text-iron-600 mt-1 leading-relaxed">
                For organization-wide deployment, use Chrome Enterprise policies to force-install the
                extension across all managed devices. Refer to the{' '}
                <span className="font-medium">ExtensionInstallForcelist</span> policy in the Google
                Chrome Enterprise documentation. This ensures all employees are protected automatically
                without individual installations.
              </p>
            </div>
          </div>
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
        <h2 className="text-2xl font-bold text-gray-900">Invite Your Team</h2>
        <p className="text-gray-500 mt-1">
          Add team members who will use the Iron Gate dashboard. You can always invite more later.
        </p>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200">
        <div className="space-y-3">
          {state.teamMembers.map((member, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="flex-1">
                <input
                  type="email"
                  placeholder="colleague@yourfirm.com"
                  value={member.email}
                  onChange={(e) => updateMember(index, 'email', e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500 transition-shadow"
                />
              </div>
              <select
                value={member.role}
                onChange={(e) => updateMember(index, 'role', e.target.value)}
                className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-iron-500 focus:border-iron-500"
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
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
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
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors underline underline-offset-2"
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
  onRetry,
  isSubmitting,
  onGoToDashboard,
}: {
  state: OnboardingState;
  firmCreated: boolean;
  submitError: string | null;
  onRetry: () => void;
  isSubmitting: boolean;
  onGoToDashboard: () => void;
}) {
  // If there was an error and firm wasn't created, show error state
  if (!firmCreated && submitError) {
    return (
      <div>
        <div className="mb-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Setup Encountered an Issue</h2>
          <p className="text-gray-500 mt-2 max-w-md mx-auto">
            We couldn&apos;t complete the setup. This is usually a temporary connectivity issue.
          </p>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-red-200 mb-6">
          <p className="text-sm text-red-700 mb-4">{submitError}</p>
          <button
            onClick={onRetry}
            disabled={isSubmitting}
            className="px-6 py-2.5 bg-iron-600 text-white rounded-lg text-sm font-medium hover:bg-iron-700 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Retrying...' : 'Retry Setup'}
          </button>
        </div>
      </div>
    );
  }

  // Loading state while creating
  if (!firmCreated && isSubmitting) {
    return (
      <div className="text-center py-16">
        <div className="w-12 h-12 border-4 border-iron-200 border-t-iron-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-gray-500">Setting up your organization...</p>
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
        <h2 className="text-2xl font-bold text-gray-900">You&apos;re All Set!</h2>
        <p className="text-gray-500 mt-2">
          Iron Gate is configured and ready to protect your organization.
        </p>
      </div>

      {/* Configuration summary */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 mb-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Configuration Summary</h3>
        <div className="space-y-3">
          <SummaryRow label="Firm" value={state.firmName} />
          <SummaryRow label="Industry" value={state.industry} />
          <SummaryRow label="Size" value={`${state.firmSize} employees`} />
          <SummaryRow
            label="Protection Mode"
            value={state.protectionMode === 'audit' ? 'Audit Mode (Monitor Only)' : 'Proxy Mode (Active Protection)'}
          />
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
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
      className="block p-4 bg-white rounded-xl border border-gray-200 hover:border-iron-300 hover:shadow-sm transition-all group"
    >
      <div className="text-gray-400 group-hover:text-iron-600 transition-colors mb-2">{icon}</div>
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <p className="text-xs text-gray-500">{description}</p>
    </a>
  );
}
