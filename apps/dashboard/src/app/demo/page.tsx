'use client';

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Entity {
  text: string;
  type: string;
  color: string;
  pseudonym: string;
  weight: number;
}

interface Scenario {
  id: string;
  label: string;
  industry: string;
  icon: string;
  aiTool: string;
  aiToolColor: string;
  aiToolIcon: React.ReactNode;
  userName: string;
  userInitials: string;
  prompt: string;
  entities: Entity[];
  score: number;
  action: 'BLOCK' | 'WARN' | 'PSEUDONYMIZE';
  actionReason: string;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const CHATGPT_ICON = (
  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
);

const CLAUDE_ICON = (
  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
  </svg>
);

const GEMINI_ICON = (
  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

const COPILOT_ICON = (
  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
  </svg>
);

const SCENARIOS: Scenario[] = [
  {
    id: 'legal',
    label: 'Law Firm',
    industry: 'Legal',
    icon: '&#9878;',
    aiTool: 'ChatGPT',
    aiToolColor: '#10a37f',
    aiToolIcon: CHATGPT_ICON,
    userName: 'David Chen',
    userInitials: 'DC',
    prompt: `Draft a response to opposing counsel Sarah Mitchell at Baker & McKenzie regarding the Johnson v. Acme Corp case (matter #2024-CV-1847). My client Robert Johnson's SSN is 423-55-8901 and his DOB is 03/15/1978. The proposed settlement amount is $4.2M, which was discussed in a privileged attorney-client communication on March 15th. Please also reference the wire transfer from Chase account #7291-4483-0012 and the confidential mediation brief filed under seal. Contact me at david.chen@kirkland.com or (312) 555-0192.`,
    entities: [
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
    ],
    score: 94,
    action: 'BLOCK',
    actionReason: 'prompt contains privileged content, PII, and financial data',
  },
  {
    id: 'healthcare',
    label: 'Healthcare',
    industry: 'Healthcare',
    icon: '&#128657;',
    aiTool: 'Claude',
    aiToolColor: '#d97706',
    aiToolIcon: CLAUDE_ICON,
    userName: 'Dr. Priya Sharma',
    userInitials: 'PS',
    prompt: `Summarize the treatment plan for patient Maria Gonzalez (MRN: 4829-7103, DOB: 11/22/1965). She was diagnosed with Stage IIIA non-small cell lung cancer at Memorial Sloan Kettering on 01/08/2026. Current medications include Keytruda 200mg IV q3w and Carboplatin AUC 5. Her insurance ID is UHC-882-991-4420 and the prior authorization number is PA-2026-00847. Labs from 02/10/2026 show WBC 3.2, ANC 1.1, PLT 89. Dr. James Whitfield at (212) 639-2000 is the attending oncologist. The patient expressed suicidal ideation during the 02/15 session per the psychiatric consult notes.`,
    entities: [
      { text: 'Maria Gonzalez', type: 'PATIENT_NAME', color: '#4c6ef5', pseudonym: 'Patient A', weight: 20 },
      { text: '4829-7103', type: 'MRN', color: '#ff6b6b', pseudonym: 'XXXX-XXXX', weight: 25 },
      { text: '11/22/1965', type: 'DATE_OF_BIRTH', color: '#ff922b', pseudonym: 'XX/XX/XXXX', weight: 12 },
      { text: 'Stage IIIA non-small cell lung cancer', type: 'DIAGNOSIS', color: '#e64980', pseudonym: '[diagnosis redacted]', weight: 18 },
      { text: 'Memorial Sloan Kettering', type: 'MEDICAL_FACILITY', color: '#7950f2', pseudonym: '[Hospital]', weight: 10 },
      { text: 'Keytruda 200mg IV q3w', type: 'MEDICATION', color: '#fab005', pseudonym: '[medication A]', weight: 8 },
      { text: 'Carboplatin AUC 5', type: 'MEDICATION', color: '#fab005', pseudonym: '[medication B]', weight: 8 },
      { text: 'UHC-882-991-4420', type: 'INSURANCE_ID', color: '#ff6b6b', pseudonym: 'XXX-XXX-XXX-XXXX', weight: 22 },
      { text: 'PA-2026-00847', type: 'AUTH_NUMBER', color: '#ff922b', pseudonym: 'PA-XXXX-XXXXX', weight: 15 },
      { text: 'WBC 3.2, ANC 1.1, PLT 89', type: 'LAB_RESULTS', color: '#20c997', pseudonym: '[lab values redacted]', weight: 12 },
      { text: 'Dr. James Whitfield', type: 'PROVIDER_NAME', color: '#4c6ef5', pseudonym: 'Dr. [Redacted]', weight: 14 },
      { text: '(212) 639-2000', type: 'PHONE_NUMBER', color: '#20c997', pseudonym: '(XXX) XXX-XXXX', weight: 8 },
      { text: 'suicidal ideation', type: 'MENTAL_HEALTH', color: '#ff6b6b', pseudonym: '[sensitive mental health note]', weight: 25 },
      { text: 'psychiatric consult notes', type: 'PROTECTED_RECORD', color: '#ff6b6b', pseudonym: '[protected clinical notes]', weight: 20 },
    ],
    score: 97,
    action: 'BLOCK',
    actionReason: 'prompt contains HIPAA-protected PHI, mental health records, and patient identifiers',
  },
  {
    id: 'finance',
    label: 'Investment Bank',
    industry: 'Finance',
    icon: '&#128200;',
    aiTool: 'Gemini',
    aiToolColor: '#4285f4',
    aiToolIcon: GEMINI_ICON,
    userName: 'Marcus Rivera',
    userInitials: 'MR',
    prompt: `Create a financial model for Project Nighthawk — the proposed $2.8B acquisition of TechNova Inc (NASDAQ: TNVA) by our client Meridian Capital Partners. The target's Q4 EBITDA was $187M with 34% margins. We're modeling a 6.2x EV/EBITDA entry multiple. Key terms from the draft LOI signed 02/12/2026: $42/share cash offer (23% premium to undisturbed price), $450M bridge financing from Goldman Sachs (commitment letter ref: GS-2026-CL-8847), and a $140M breakup fee. The deal team includes managing director Helen Park (helen.park@jpmorgan.com) and our MNPI list has 47 restricted persons. Do not share outside the Chinese Wall. The HSR filing deadline is March 28th.`,
    entities: [
      { text: 'Project Nighthawk', type: 'DEAL_CODENAME', color: '#e64980', pseudonym: 'Project [Redacted]', weight: 25 },
      { text: '$2.8B', type: 'MONETARY_AMOUNT', color: '#fab005', pseudonym: '$[REDACTED]', weight: 14 },
      { text: 'TechNova Inc', type: 'TARGET_COMPANY', color: '#7950f2', pseudonym: '[Target Co]', weight: 20 },
      { text: 'TNVA', type: 'TICKER_SYMBOL', color: '#ff922b', pseudonym: '[XXXX]', weight: 18 },
      { text: 'Meridian Capital Partners', type: 'CLIENT_NAME', color: '#4c6ef5', pseudonym: '[Client]', weight: 20 },
      { text: '$187M', type: 'FINANCIAL_DATA', color: '#fab005', pseudonym: '$[REDACTED]', weight: 12 },
      { text: '$42/share', type: 'OFFER_PRICE', color: '#ff6b6b', pseudonym: '$[XX]/share', weight: 25 },
      { text: '23% premium', type: 'DEAL_TERMS', color: '#ff922b', pseudonym: '[X]% premium', weight: 15 },
      { text: '$450M', type: 'MONETARY_AMOUNT', color: '#fab005', pseudonym: '$[REDACTED]', weight: 14 },
      { text: 'Goldman Sachs', type: 'COUNTERPARTY', color: '#7950f2', pseudonym: '[Bank]', weight: 12 },
      { text: 'GS-2026-CL-8847', type: 'REFERENCE_NUMBER', color: '#ff922b', pseudonym: 'XX-XXXX-XX-XXXX', weight: 18 },
      { text: '$140M', type: 'MONETARY_AMOUNT', color: '#fab005', pseudonym: '$[REDACTED]', weight: 14 },
      { text: 'Helen Park', type: 'PERSON', color: '#4c6ef5', pseudonym: '[Name Redacted]', weight: 12 },
      { text: 'helen.park@jpmorgan.com', type: 'EMAIL', color: '#20c997', pseudonym: 'user@[redacted].com', weight: 10 },
      { text: 'MNPI', type: 'COMPLIANCE_MARKER', color: '#ff6b6b', pseudonym: '[restricted information]', weight: 22 },
      { text: 'Chinese Wall', type: 'COMPLIANCE_MARKER', color: '#ff6b6b', pseudonym: '[information barrier]', weight: 18 },
    ],
    score: 99,
    action: 'BLOCK',
    actionReason: 'prompt contains material non-public information (MNPI), deal terms, and insider data',
  },
  {
    id: 'hr',
    label: 'HR / People Ops',
    industry: 'Human Resources',
    icon: '&#128101;',
    aiTool: 'Copilot',
    aiToolColor: '#0078d4',
    aiToolIcon: COPILOT_ICON,
    userName: 'Jennifer Hayes',
    userInitials: 'JH',
    prompt: `Help me draft a PIP (Performance Improvement Plan) for employee Thomas Blackwell (EMP-20847) in the engineering department. His current base salary is $185,000 with RSU grant #RSU-2024-4892 vesting in August. His last three performance reviews scored 2.1, 1.8, and 2.3 out of 5. There have been two HR complaints filed against him (HR-2025-1104 and HR-2026-0219) regarding workplace conduct. His manager Lisa Wong documented unauthorized access to the Salesforce admin panel on 01/30/2026. Thomas's emergency contact is his wife Karen Blackwell at (415) 555-0847. He is currently on FMLA intermittent leave for a chronic health condition (request #FMLA-2025-0093).`,
    entities: [
      { text: 'Thomas Blackwell', type: 'EMPLOYEE_NAME', color: '#4c6ef5', pseudonym: 'Employee A', weight: 18 },
      { text: 'EMP-20847', type: 'EMPLOYEE_ID', color: '#ff922b', pseudonym: 'EMP-XXXXX', weight: 15 },
      { text: '$185,000', type: 'SALARY', color: '#fab005', pseudonym: '$[REDACTED]', weight: 20 },
      { text: '#RSU-2024-4892', type: 'EQUITY_GRANT', color: '#fab005', pseudonym: '#RSU-XXXX-XXXX', weight: 16 },
      { text: '2.1, 1.8, and 2.3', type: 'PERFORMANCE_DATA', color: '#e64980', pseudonym: '[scores redacted]', weight: 14 },
      { text: 'HR-2025-1104', type: 'HR_CASE_NUMBER', color: '#ff6b6b', pseudonym: 'HR-XXXX-XXXX', weight: 20 },
      { text: 'HR-2026-0219', type: 'HR_CASE_NUMBER', color: '#ff6b6b', pseudonym: 'HR-XXXX-XXXX', weight: 20 },
      { text: 'Lisa Wong', type: 'PERSON', color: '#4c6ef5', pseudonym: '[Manager]', weight: 12 },
      { text: 'unauthorized access to the Salesforce admin panel', type: 'SECURITY_INCIDENT', color: '#ff6b6b', pseudonym: '[security incident details]', weight: 22 },
      { text: 'Karen Blackwell', type: 'PERSON', color: '#4c6ef5', pseudonym: '[Contact Name]', weight: 12 },
      { text: '(415) 555-0847', type: 'PHONE_NUMBER', color: '#20c997', pseudonym: '(XXX) XXX-XXXX', weight: 8 },
      { text: 'FMLA intermittent leave', type: 'PROTECTED_LEAVE', color: '#ff6b6b', pseudonym: '[protected leave type]', weight: 25 },
      { text: 'chronic health condition', type: 'MEDICAL_INFO', color: '#ff6b6b', pseudonym: '[health information]', weight: 22 },
      { text: 'FMLA-2025-0093', type: 'LEAVE_ID', color: '#ff922b', pseudonym: 'FMLA-XXXX-XXXX', weight: 15 },
    ],
    score: 91,
    action: 'BLOCK',
    actionReason: 'prompt contains protected employee data, FMLA information, medical records, and HR complaints',
  },
];

// Build pseudonymized prompt for a scenario
function buildPseudonymized(scenario: Scenario): string {
  let result = scenario.prompt;
  for (const e of scenario.entities) {
    result = result.replace(e.text, e.pseudonym);
  }
  return result;
}

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
  const [scenarioId, setScenarioId] = useState('legal');
  const [step, setStep] = useState<Step>('idle');
  const [typedLength, setTypedLength] = useState(0);
  const [detectedCount, setDetectedCount] = useState(0);
  const [currentScore, setCurrentScore] = useState(0);
  const [showPseudonymized, setShowPseudonymized] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

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

    const sc = SCENARIOS.find((s) => s.id === scenarioId)!;

    // Step 1: Typing
    setStep('typing');
    const chunkSize = 4;
    for (let i = 0; i <= sc.prompt.length; i += chunkSize) {
      if (cancelRef.current) break;
      setTypedLength(Math.min(i, sc.prompt.length));
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      await sleep(12);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    setTypedLength(sc.prompt.length);
    await sleep(600);

    // Step 2: Detecting entities
    setStep('detecting');
    for (let i = 0; i < sc.entities.length; i++) {
      if (cancelRef.current) break;
      setDetectedCount(i + 1);
      await sleep(220);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    await sleep(500);

    // Step 3: Scoring
    setStep('scoring');
    for (let s = 0; s <= sc.score; s += 2) {
      if (cancelRef.current) break;
      setCurrentScore(Math.min(s, sc.score));
      await sleep(18);
    }
    if (cancelRef.current) { setIsRunning(false); return; }
    setCurrentScore(sc.score);
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

  function switchScenario(id: string) {
    if (isRunning) {
      cancelRef.current = true;
      setTimeout(() => {
        setStep('idle');
        setTypedLength(0);
        setDetectedCount(0);
        setCurrentScore(0);
        setShowPseudonymized(false);
        setIsRunning(false);
        setScenarioId(id);
      }, 100);
    } else {
      resetSimulation();
      setScenarioId(id);
    }
  }

  // Render prompt text with entity highlighting
  function renderHighlightedText(text: string, entities: Entity[]) {
    const parts: { text: string; entity?: Entity }[] = [];
    let remaining = text;

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

  const visibleEntities = scenario.entities.slice(0, detectedCount);
  const shouldHighlight = step === 'detecting' || step === 'scoring' || step === 'pseudonymizing' || step === 'complete';

  const actionColor = scenario.action === 'BLOCK' ? 'text-red-500' : scenario.action === 'WARN' ? 'text-orange-500' : 'text-yellow-500';

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
          <Link href="/dashboard" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            Dashboard
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            Home
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 md:px-12 py-8">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Live Simulation</h1>
          <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            Watch how Iron Gate intercepts sensitive prompts across industries, detects confidential entities,
            scores the risk, and pseudonymizes content before it reaches the AI.
          </p>
        </div>

        {/* Scenario picker */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              onClick={() => switchScenario(sc.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${
                scenarioId === sc.id
                  ? 'border-iron-500 bg-iron-50 dark:bg-iron-900/30 text-iron-700 dark:text-iron-300 shadow-sm'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <span dangerouslySetInnerHTML={{ __html: sc.icon }} />
              <span>{sc.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                scenarioId === sc.id
                  ? 'bg-iron-200 dark:bg-iron-800 text-iron-700 dark:text-iron-300'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}>
                {sc.aiTool}
              </span>
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mb-6">
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
          {step !== 'idle' && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
              {scenario.industry} scenario via {scenario.aiTool}
            </span>
          )}
        </div>

        {/* Main simulation area */}
        <div className="grid lg:grid-cols-5 gap-6">
          {/* Chat simulation — left side */}
          <div className="lg:col-span-3">
            {/* AI tool header */}
            <div className="bg-white dark:bg-gray-900 rounded-t-xl border border-b-0 border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: scenario.aiToolColor }}>
                {scenario.aiToolIcon}
              </div>
              <div>
                <p className="text-sm font-semibold">{scenario.aiTool}</p>
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
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <p className="text-gray-400 dark:text-gray-600 text-sm">
                    Select a scenario above, then click &quot;Start Simulation&quot;
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-300 dark:text-gray-700">
                    <span dangerouslySetInnerHTML={{ __html: scenario.icon }} className="text-base" />
                    <span>{scenario.industry} &mdash; {scenario.userName} on {scenario.aiTool}</span>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex-shrink-0 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">{scenario.userInitials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{scenario.userName}</p>
                    <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {shouldHighlight
                        ? renderHighlightedText(scenario.prompt, visibleEntities)
                        : scenario.prompt.slice(0, typedLength)}
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
                <span className="text-sm text-gray-400 dark:text-gray-500 flex-1">Message {scenario.aiTool}...</span>
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
                  Action: <span className={`font-semibold ${actionColor}`}>{scenario.action}</span> — {scenario.actionReason}
                </p>
              )}
            </div>

            {/* Detected entities */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                Detected Entities ({detectedCount}/{scenario.entities.length})
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
                      className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
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

        {/* Pseudonymized output */}
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
                {renderHighlightedText(scenario.prompt, scenario.entities)}
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
                {buildPseudonymized(scenario)}
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

        {/* Entity type summary at bottom */}
        {step === 'complete' && (
          <div className="mt-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4">
              Detection Summary — {scenario.industry}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(() => {
                const typeMap = new Map<string, { count: number; color: string; totalWeight: number }>();
                for (const e of scenario.entities) {
                  const existing = typeMap.get(e.type);
                  if (existing) {
                    existing.count++;
                    existing.totalWeight += e.weight;
                  } else {
                    typeMap.set(e.type, { count: 1, color: e.color, totalWeight: e.weight });
                  }
                }
                return Array.from(typeMap.entries()).map(([type, data]) => (
                  <div key={type} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: data.color }} />
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-gray-700 dark:text-gray-300 truncate">{type}</p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">{data.count}x &middot; +{data.totalWeight} pts</p>
                    </div>
                  </div>
                ));
              })()}
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
