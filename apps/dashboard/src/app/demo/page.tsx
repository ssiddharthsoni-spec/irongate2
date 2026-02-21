'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Data: the sensitive prompt, detected entities, and pseudonym mappings
// ---------------------------------------------------------------------------

const ORIGINAL_PROMPT =
  `Draft a response to opposing counsel Sarah Mitchell at Baker & McKenzie regarding the Johnson v. Acme Corp case (matter #2024-CV-1847). My client Robert Johnson's SSN is 423-55-8901 and his DOB is 03/15/1978. The proposed settlement amount is $4.2M, which was discussed in a privileged attorney-client communication on March 15th. Please also reference the wire transfer from Chase account #7291-4483-0012 and the confidential mediation brief filed under seal. Contact me at david.chen@kirkland.com or (312) 555-0192.`;

interface Entity {
  text: string;
  type: string;
  color: string;
  pseudonym: string;
  weight: number;
}

const ENTITIES: Entity[] = [
  { text: 'Sarah Mitchell', type: 'PERSON', color: '#4c6ef5', pseudonym: 'Jane Doe', weight: 15 },
  { text: 'Baker & McKenzie', type: 'ORGANIZATION', color: '#7950f2', pseudonym: 'Firm Alpha LLP', weight: 12 },
  { text: 'Johnson v. Acme Corp', type: 'CASE_NAME', color: '#e64980', pseudonym: 'Doe v. Beta Inc', weight: 18 },
  { text: '#2024-CV-1847', type: 'MATTER_NUMBER', color: '#e64980', pseudonym: '#XXXX-CV-0000', weight: 20 },
  { text: 'Robert Johnson', type: 'PERSON', color: '#4c6ef5', pseudonym: 'John Doe', weight: 15 },
  { text: '423-55-8901', type: 'SSN', color: '#ff6b6b', pseudonym: '***-**-****', weight: 25 },
  { text: '03/15/1978', type: 'DATE_OF_BIRTH', color: '#ff922b', pseudonym: 'XX/XX/XXXX', weight: 12 },
  { text: '$4.2M', type: 'MONETARY_AMOUNT', color: '#fab005', pseudonym: '$[REDACTED]', weight: 14 },
  { text: 'privileged attorney-client communication', type: 'PRIVILEGE_MARKER', color: '#ff6b6b', pseudonym: 'confidential discussion', weight: 22 },
  { text: '#7291-4483-0012', type: 'ACCOUNT_NUMBER', color: '#ff6b6b', pseudonym: '#XXXX-XXXX-XXXX', weight: 22 },
  { text: 'Chase', type: 'FINANCIAL_INSTITUTION', color: '#7950f2', pseudonym: '[Bank]', weight: 8 },
  { text: 'confidential mediation brief filed under seal', type: 'PRIVILEGE_MARKER', color: '#ff6b6b', pseudonym: 'legal document', weight: 20 },
  { text: 'david.chen@kirkland.com', type: 'EMAIL', color: '#20c997', pseudonym: 'user@[redacted].com', weight: 10 },
  { text: '(312) 555-0192', type: 'PHONE_NUMBER', color: '#20c997', pseudonym: '(XXX) XXX-XXXX', weight: 8 },
];

const SENSITIVITY_SCORE = 94;

// Build the pseudonymized prompt
function buildPseudonymizedPrompt(): string {
  let result = ORIGINAL_PROMPT;
  for (const e of ENTITIES) {
    result = result.replace(e.text, e.pseudonym);
  }
  return result;
}

const PSEUDONYMIZED_PROMPT = buildPseudonymizedPrompt();

// ---------------------------------------------------------------------------
// Steps in the simulation
// ---------------------------------------------------------------------------
type Step = 'idle' | 'typing' | 'detecting' | 'scoring' | 'pseudonymizing' | 'complete';

const STEP_LABELS: Record<Step, string> = {
  idle: 'Ready',
  typing: 'Employee typing prompt...',
  detecting: 'Iron Gate scanning for sensitive entities...',
  scoring: 'Computing sensitivity score...',
  pseudonymizing: 'Pseudonymizing detected entities...',
  complete: 'Simulation complete',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DemoPage() {
  const [step, setStep] = useState<Step>('idle');
  const [typedLength, setTypedLength] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  const [showPseudonymized, setShowPseudonymized] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  const sleep = useCallback((ms: number) => {
    return new Promise<void>((resolve) => {
      const id = setTimeout(resolve, ms);
      const check = setInterval(() => {
        if (cancelRef.current) {
          clearTimeout(id);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
  }, []);

  async function runSimulation() {
    cancelRef.current = false;
    setIsRunning(true);
    setTypedLength(0);
    setDetectedCount(0);
    setCurrentScore(0);
    setShowPseudonymized(false);

    // Step 1: Typing
    setStep('typing');
    const chunkSize = 4;
    for (let i = 0; i <= ORIGINAL_PROMPT.length; i += chunkSize) {
      if (cancelRef.current) break;
      setTypedLength(Math.min(i, ORIGINAL_PROMPT.length));
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      await sleep(12);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    setTypedLength(ORIGINAL_PROMPT.length);
    await sleep(600);

    // Step 2: Detecting entities one by one
    setStep('detecting');
    for (let i = 0; i < ENTITIES.length; i++) {
      if (cancelRef.current) break;
      setDetectedCount(i + 1);
      await sleep(250);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    await sleep(500);

    // Step 3: Scoring animation
    setStep('scoring');
    for (let s = 0; s <= SENSITIVITY_SCORE; s += 2) {
      if (cancelRef.current) break;
      setCurrentScore(Math.min(s, SENSITIVITY_SCORE));
      await sleep(20);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    setCurrentScore(SENSITIVITY_SCORE);
    await sleep(800);

    // Step 4: Pseudonymization
    setStep('pseudonymizing');
    await sleep(1500);
    if (cancelRef.current) { setIsRunning(false); return; }
    setShowPseudonymized(true);
    await sleep(500);

    setStep('complete');
    setIsRunning(false);
  }

  function resetSimulation() {
    cancelRef.current = true;
    setStep('idle');
    setTypedLength(0);
    setDetectedCount(0);
    setCurrentScore(0);
    setShowPseudonymized(false);
    setIsRunning(false);
  }

  // Render prompt text with entity highlighting
  function renderHighlightedText(text: string, entities: Entity[], maxLen?: number) {
    const displayText = maxLen !== undefined ? text.slice(0, maxLen) : text;
    const parts: { text: string; entity?: Entity }[] = [];
    let remaining = displayText;
    let searchFrom = 0;

    while (remaining.length > 0) {
      let earliest = -1;
      let earliestEntity: Entity | undefined;

      for (const e of entities) {
        const idx = remaining.indexOf(e.text, 0);
        if (idx !== -1 && (earliest === -1 || idx < earliest)) {
          earliest = idx;
          earliestEntity = e;
        }
      }

      if (earliest === -1 || !earliestEntity) {
        parts.push({ text: remaining });
        break;
      }

      if (earliest > 0) {
        parts.push({ text: remaining.slice(0, earliest) });
      }
      parts.push({ text: earliestEntity.text, entity: earliestEntity });
      remaining = remaining.slice(earliest + earliestEntity.text.length);
      searchFrom++;
    }

    return parts.map((p, i) =>
      p.entity ? (
        <span
          key={i}
          className="relative inline"
          style={{
            backgroundColor: `${p.entity.color}20`,
            borderBottom: `2px solid ${p.entity.color}`,
            padding: '1px 2px',
            borderRadius: 2,
          }}
          title={`${p.entity.type}: ${p.entity.text}`}
        >
          {p.text}
          <span
            className="absolute -top-5 left-0 text-[9px] font-bold px-1 rounded whitespace-nowrap pointer-events-none"
            style={{ backgroundColor: p.entity.color, color: '#fff' }}
          >
            {p.entity.type}
          </span>
        </span>
      ) : (
        <span key={i}>{p.text}</span>
      )
    );
  }

  const visibleEntities = ENTITIES.slice(0, detectedCount);
  const shouldHighlight = step === 'detecting' || step === 'scoring' || step === 'pseudonymizing' || step === 'complete';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      {/* Top bar */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-4 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-iron-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">IG</span>
          </div>
          <span className="text-xl font-bold">Iron Gate</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Home
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Live Simulation</h1>
          <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            Watch how Iron Gate intercepts a sensitive legal prompt, detects confidential entities,
            scores the risk, and pseudonymizes the content before it reaches the AI.
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <button
            onClick={runSimulation}
            disabled={isRunning}
            className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
              isRunning
                ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-iron-600 hover:bg-iron-700 text-white shadow-lg shadow-iron-600/25'
            }`}
          >
            {isRunning ? 'Running...' : 'Start Simulation'}
          </button>
          {isRunning && (
            <button
              onClick={resetSimulation}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Reset
            </button>
          )}
          {step === 'complete' && (
            <button
              onClick={() => { resetSimulation(); setTimeout(runSimulation, 100); }}
              className="px-4 py-2.5 rounded-lg text-sm font-medium border border-iron-300 dark:border-iron-700 text-iron-700 dark:text-iron-300 hover:bg-iron-50 dark:hover:bg-iron-900/20 transition-colors"
            >
              Replay
            </button>
          )}
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className={`w-2.5 h-2.5 rounded-full ${
            step === 'idle' ? 'bg-gray-400' :
            step === 'complete' ? 'bg-green-500' :
            'bg-iron-500 animate-pulse'
          }`} />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {STEP_LABELS[step]}
          </span>
        </div>

        {/* Main simulation area */}
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Chat simulation — left side */}
          <div className="lg:col-span-3">
            {/* ChatGPT-like header */}
            <div className="bg-white dark:bg-gray-900 rounded-t-xl border border-b-0 border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 bg-[#10a37f] rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold">ChatGPT</p>
                <p className="text-xs text-gray-400">Simulated interface</p>
              </div>
              {step !== 'idle' && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="w-6 h-6 bg-iron-600 rounded flex items-center justify-center">
                    <span className="text-white text-[8px] font-bold">IG</span>
                  </div>
                  <span className="text-xs font-medium text-iron-600 dark:text-iron-400">Iron Gate Active</span>
                </div>
              )}
            </div>

            {/* Chat messages area */}
            <div
              ref={chatRef}
              className="bg-white dark:bg-gray-900 border-x border-gray-200 dark:border-gray-800 p-4 min-h-[320px] max-h-[420px] overflow-y-auto"
            >
              {step === 'idle' ? (
                <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-600 text-sm">
                  Click &quot;Start Simulation&quot; to begin
                </div>
              ) : (
                <div className="flex gap-3">
                  {/* User avatar */}
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">DC</span>
                  </div>
                  {/* Message */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">David Chen</p>
                    <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {shouldHighlight
                        ? renderHighlightedText(ORIGINAL_PROMPT, visibleEntities)
                        : ORIGINAL_PROMPT.slice(0, typedLength)}
                      {step === 'typing' && (
                        <span className="inline-block w-0.5 h-4 bg-gray-800 dark:bg-gray-200 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat input bar */}
            <div className="bg-white dark:bg-gray-900 rounded-b-xl border border-t-0 border-gray-200 dark:border-gray-800 px-4 py-3">
              <div className="flex items-center gap-3 bg-gray-100 dark:bg-gray-800 rounded-xl px-4 py-2.5">
                <span className="text-sm text-gray-400 dark:text-gray-500 flex-1">Message ChatGPT...</span>
                <div className="w-8 h-8 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Detection panel — right side */}
          <div className="lg:col-span-2 space-y-4">
            {/* Score card */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Sensitivity Score</h3>
                <div className="w-6 h-6 bg-iron-600 rounded flex items-center justify-center">
                  <span className="text-white text-[8px] font-bold">IG</span>
                </div>
              </div>
              <div className="flex items-end gap-3 mb-3">
                <span className={`text-5xl font-bold tabular-nums ${
                  currentScore >= 85 ? 'text-red-500' :
                  currentScore >= 60 ? 'text-orange-500' :
                  currentScore >= 25 ? 'text-yellow-500' :
                  'text-green-500'
                }`}>
                  {currentScore}
                </span>
                <span className="text-sm text-gray-400 dark:text-gray-500 mb-1">/ 100</span>
              </div>
              {/* Score bar */}
              <div className="w-full h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${
                    currentScore >= 85 ? 'bg-red-500' :
                    currentScore >= 60 ? 'bg-orange-500' :
                    currentScore >= 25 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${currentScore}%` }}
                />
              </div>
              {currentScore >= 85 && (
                <div className="mt-3 flex items-center gap-2 text-red-600 dark:text-red-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  <span className="text-xs font-semibold">CRITICAL — Block recommended</span>
                </div>
              )}
              {step !== 'idle' && step !== 'typing' && (
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                  Action: <span className="font-semibold text-red-500">BLOCK</span> — prompt contains privileged content, PII, and financial data
                </p>
              )}
            </div>

            {/* Detected entities */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                Detected Entities ({detectedCount}/{ENTITIES.length})
              </h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {detectedCount === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-600 py-4 text-center">
                    {step === 'idle' ? 'Waiting for simulation...' : 'Scanning...'}
                  </p>
                ) : (
                  visibleEntities.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 animate-in"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: e.color, color: '#fff' }}
                      >
                        {e.type}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{e.text}</p>
                        {showPseudonymized && (
                          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-1">
                            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                            </svg>
                            <span className="font-mono">{e.pseudonym}</span>
                          </p>
                        )}
                      </div>
                      <span className="ml-auto text-[10px] font-semibold text-gray-400 dark:text-gray-500 flex-shrink-0">
                        +{e.weight}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Pseudonymized output — shown at the end */}
        {showPseudonymized && (
          <div className="mt-8 grid lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-red-200 dark:border-red-900/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Original Prompt (BLOCKED)</h3>
              </div>
              <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 bg-red-50 dark:bg-red-950/30 rounded-lg p-4 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {renderHighlightedText(ORIGINAL_PROMPT, ENTITIES)}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-900 rounded-xl border border-green-200 dark:border-green-900/50 p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <h3 className="text-sm font-semibold text-green-600 dark:text-green-400">Pseudonymized Version (SAFE)</h3>
              </div>
              <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400 bg-green-50 dark:bg-green-950/30 rounded-lg p-4 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                {PSEUDONYMIZED_PROMPT}
              </div>
            </div>
          </div>
        )}

        {/* Pipeline diagram */}
        {step !== 'idle' && (
          <div className="mt-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4 text-center">
              Iron Gate Pipeline
            </h3>
            <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
              {[
                { label: 'Capture', icon: '1', active: true },
                { label: 'Detect', icon: '2', active: step === 'detecting' || step === 'scoring' || step === 'pseudonymizing' || step === 'complete' },
                { label: 'Score', icon: '3', active: step === 'scoring' || step === 'pseudonymizing' || step === 'complete' },
                { label: 'Decide', icon: '4', active: step === 'pseudonymizing' || step === 'complete' },
                { label: 'Protect', icon: '5', active: step === 'complete' },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                    s.active
                      ? 'bg-iron-50 dark:bg-iron-900/30 border-iron-300 dark:border-iron-700 text-iron-700 dark:text-iron-300'
                      : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'
                  }`}>
                    <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                      s.active ? 'bg-iron-600 text-white' : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400'
                    }`}>
                      {s.icon}
                    </span>
                    <span className="text-xs font-medium">{s.label}</span>
                  </div>
                  {i < 4 && (
                    <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 hidden md:block" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Back to landing */}
        <div className="mt-12 text-center">
          <Link
            href="/"
            className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
