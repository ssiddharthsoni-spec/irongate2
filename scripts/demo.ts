#!/usr/bin/env bun
/**
 * Iron Gate — Interactive Demo
 *
 * Simulates an employee at "Sterling & Associates LLP" (a fictional law firm)
 * sharing sensitive data with AI tools. Shows how Iron Gate detects, scores,
 * and (in Phase 2) pseudonymizes the content.
 *
 * Run: bun run scripts/demo.ts
 */

// ========================================
// Inline detection engine (from extension)
// ========================================

interface DetectedEntity {
  type: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
  source: 'regex' | 'gliner' | 'presidio' | 'keyword';
}

interface RegexPattern {
  type: string;
  pattern: RegExp;
  confidence: number;
}

const REGEX_PATTERNS: RegexPattern[] = [
  { type: 'SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },
  { type: 'CREDIT_CARD', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g, confidence: 0.9 },
  { type: 'CREDIT_CARD', pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g, confidence: 0.85 },
  { type: 'EMAIL', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, confidence: 0.95 },
  { type: 'PHONE_NUMBER', pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, confidence: 0.8 },
  { type: 'IP_ADDRESS', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g, confidence: 0.9 },
  { type: 'DATE', pattern: /\b(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/g, confidence: 0.7 },
  { type: 'MONETARY_AMOUNT', pattern: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:million|billion|M|B|k|K)?\b/g, confidence: 0.85 },
  { type: 'MONETARY_AMOUNT', pattern: /\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s?(?:dollars?|USD|million|billion)\b/gi, confidence: 0.8 },
  { type: 'ACCOUNT_NUMBER', pattern: /\b(?:acct?\.?\s*#?\s*|account\s*#?\s*)\d{6,12}\b/gi, confidence: 0.8 },
  { type: 'MATTER_NUMBER', pattern: /\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d{2,4}[-./]\d{3,6}\b/gi, confidence: 0.75 },
];

// Named entity patterns (supplement regex for demo)
const NAMED_ENTITY_PATTERNS: RegexPattern[] = [
  // Person names (common patterns near context clues)
  { type: 'PERSON', pattern: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, confidence: 0.85 },
  { type: 'PERSON', pattern: /\b(?:attorney|counsel|partner|associate|client)\s+([A-Z][a-z]+\s+[A-Z][a-z]+)\b/gi, confidence: 0.7 },
  // Organizations
  { type: 'ORGANIZATION', pattern: /\b[A-Z][a-z]+(?:\s+(?:&|and)\s+[A-Z][a-z]+)?\s+(?:LLP|LLC|Inc\.|Corp\.|Ltd\.|Partners|Associates|Group|Holdings)\b/g, confidence: 0.85 },
  // Privilege markers
  { type: 'PRIVILEGE_MARKER', pattern: /\b(?:attorney[- ]client privilege|work product doctrine|privileged and confidential|attorney work product|protected communication)\b/gi, confidence: 0.95 },
  // Deal codenames
  { type: 'DEAL_CODENAME', pattern: /\bProject\s+[A-Z][a-z]+\b/g, confidence: 0.8 },
];

function detectEntities(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const allPatterns = [...REGEX_PATTERNS, ...NAMED_ENTITY_PATTERNS];

  for (const { type, pattern, confidence } of allPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      entities.push({
        type,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence,
        source: 'regex',
      });
    }
  }

  entities.sort((a, b) => a.start - b.start);

  // Remove overlaps
  if (entities.length <= 1) return entities;
  const result: DetectedEntity[] = [entities[0]];
  for (let i = 1; i < entities.length; i++) {
    const current = entities[i];
    const last = result[result.length - 1];
    if (current.start < last.end) {
      if (current.confidence > last.confidence) {
        result[result.length - 1] = current;
      }
    } else {
      result.push(current);
    }
  }
  return result;
}

// ========================================
// Scoring engine (from extension)
// ========================================

const ENTITY_WEIGHTS: Record<string, number> = {
  PERSON: 10, ORGANIZATION: 8, LOCATION: 3, DATE: 2,
  PHONE_NUMBER: 15, EMAIL: 12, CREDIT_CARD: 30, SSN: 40,
  MONETARY_AMOUNT: 12, ACCOUNT_NUMBER: 25, IP_ADDRESS: 8,
  MEDICAL_RECORD: 35, PASSPORT_NUMBER: 35, DRIVERS_LICENSE: 30,
  MATTER_NUMBER: 20, CLIENT_MATTER_PAIR: 25, PRIVILEGE_MARKER: 30,
  DEAL_CODENAME: 20, OPPOSING_COUNSEL: 15,
};

const LEGAL_KEYWORDS = [
  'privileged', 'attorney-client', 'work product', 'without prejudice',
  'confidential', 'under seal', 'protective order', 'settlement',
  'mediation', 'arbitration', 'deposition', 'subpoena',
  'motion to compel', 'discovery', 'litigation hold',
];

const PRIVILEGE_MARKERS = [
  'attorney-client privilege', 'work product doctrine',
  'privileged and confidential', 'attorney work product',
  'protected communication',
];

function computeScore(text: string, entities: DetectedEntity[]) {
  // Entity score
  let entityScore = 0;
  for (const e of entities) {
    entityScore += (ENTITY_WEIGHTS[e.type] || 5) * e.confidence;
  }
  const uniqueTypes = new Set(entities.map((e) => e.type));
  if (uniqueTypes.size >= 3) entityScore *= 1.3;
  else if (uniqueTypes.size >= 2) entityScore *= 1.15;
  if (entities.length >= 10) entityScore *= 1.4;
  else if (entities.length >= 5) entityScore *= 1.2;
  entityScore = Math.min(70, entityScore);

  // Volume score
  const len = text.length;
  const volumeScore = len >= 5000 ? 20 : len >= 2000 ? 10 : len >= 500 ? 5 : 0;

  // Context score
  const lowerText = text.toLowerCase();
  let contextScore = 0;
  for (const e of entities) {
    const surrounding = lowerText.substring(
      Math.max(0, e.start - 200),
      Math.min(text.length, e.end + 200)
    );
    for (const kw of LEGAL_KEYWORDS) {
      if (surrounding.includes(kw)) { contextScore += 5; break; }
    }
  }
  contextScore = Math.min(25, contextScore);

  // Legal boost
  let legalBoost = 0;
  for (const marker of PRIVILEGE_MARKERS) {
    if (lowerText.includes(marker)) legalBoost += 15;
  }
  const caseCitations = text.match(/\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+\b/g);
  if (caseCitations) legalBoost += caseCitations.length * 5;
  if (/\b(?:matter|case|docket)\s*(?:#|no\.?|number)?\s*\d/gi.test(text)) legalBoost += 10;
  legalBoost = Math.min(25, legalBoost);

  const rawScore = entityScore + volumeScore + contextScore + legalBoost;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  const level = score <= 25 ? 'low' : score <= 60 ? 'medium' : score <= 85 ? 'high' : 'critical';

  return {
    score, level, entityScore: Math.round(entityScore),
    volumeScore, contextScore, legalBoost,
    breakdown: { entityScore, volumeScore, contextScore, legalBoost },
  };
}

// ========================================
// Document classifier
// ========================================

function classifyDocument(text: string) {
  const lower = text.toLowerCase();
  if (/\b(whereas|hereby|hereinafter|shall|notwithstanding)\b/i.test(text)) return 'contract_clause';
  if (/\b(plaintiff|defendant|court|ruling|motion|deposition)\b/i.test(text)) return 'litigation_doc';
  if (/\b(revenue|ebitda|valuation|balance sheet)\b/i.test(text)) return 'financial_data';
  if (/\b(memorandum|memo|to:|from:)\b/i.test(text) && text.length > 300) return 'client_memo';
  if (/\b(dear|hi|hello|subject:|re:)\b/i.test(text)) return 'email_draft';
  if (text.length < 200 && text.includes('?')) return 'casual_question';
  return 'client_memo';
}

// ========================================
// Pseudonymization demo
// ========================================

const FAKE_NAMES: Record<string, string> = {
  'Mr. Robert Chen': 'Mr. James Mitchell',
  'Robert Chen': 'James Mitchell',
  'Ms. Patricia Wells': 'Ms. Sarah Thompson',
  'Patricia Wells': 'Sarah Thompson',
  'Sterling & Associates LLP': 'Meridian Partners LLP',
  'Nexus Technologies Inc.': 'Apex Dynamics Corp.',
  'Nexus Technologies': 'Apex Dynamics',
  'GlobalHealth Corp.': 'Pacific Wellness Inc.',
  'GlobalHealth': 'Pacific Wellness',
  'Project Falcon': 'Project Eagle',
};

function pseudonymize(text: string, entities: DetectedEntity[]): { masked: string; map: Record<string, string> } {
  const map: Record<string, string> = {};
  let masked = text;

  // Sort entities by position (reverse) to replace from end to start
  const sorted = [...entities].sort((a, b) => b.start - a.start);

  for (const entity of sorted) {
    let replacement: string;

    // Check if we have a specific fake name
    if (FAKE_NAMES[entity.text]) {
      replacement = FAKE_NAMES[entity.text];
    } else {
      switch (entity.type) {
        case 'SSN': replacement = '***-**-' + Math.floor(1000 + Math.random() * 9000); break;
        case 'EMAIL': replacement = 'j.mitchell@example.com'; break;
        case 'PHONE_NUMBER': replacement = '(555) 012-3456'; break;
        case 'CREDIT_CARD': replacement = '4XXX-XXXX-XXXX-' + Math.floor(1000 + Math.random() * 9000); break;
        case 'MONETARY_AMOUNT': {
          const num = parseFloat(entity.text.replace(/[$,]/g, ''));
          if (!isNaN(num)) {
            const jitter = num * (0.8 + Math.random() * 0.4);
            replacement = '$' + Math.round(jitter).toLocaleString();
          } else {
            replacement = '$XX,XXX';
          }
          break;
        }
        case 'ACCOUNT_NUMBER': replacement = 'Acct# XXXXXX'; break;
        case 'MATTER_NUMBER': replacement = 'Matter #20XX-XXXX'; break;
        case 'IP_ADDRESS': replacement = '192.0.2.' + Math.floor(1 + Math.random() * 254); break;
        case 'DATE': replacement = 'XX/XX/XXXX'; break;
        default: replacement = `[REDACTED_${entity.type}]`;
      }
    }

    map[entity.text] = replacement;
    masked = masked.substring(0, entity.start) + replacement + masked.substring(entity.end);
  }

  return { masked, map };
}

// ========================================
// Demo Scenarios
// ========================================

const COMPANY = {
  name: 'Sterling & Associates LLP',
  description: 'Mid-size law firm specializing in M&A and litigation',
  employee: 'Siddharth Soni',
  role: 'Senior Associate, Corporate Practice Group',
  firmId: 'firm_sterling_001',
};

const SCENARIOS = [
  {
    title: '1. Casual Question (Low Risk)',
    aiTool: 'ChatGPT',
    prompt: `What are the key differences between a stock purchase agreement and an asset purchase agreement in M&A transactions?`,
    description: 'A generic legal question with no client-specific data.',
  },
  {
    title: '2. Email Draft with Client Names (Medium Risk)',
    aiTool: 'Claude',
    prompt: `Help me draft an email to our client Mr. Robert Chen at Nexus Technologies Inc. regarding the upcoming due diligence review. His email is robert.chen@nexustech.com and we need to schedule a call for next week. Our matter number is Matter #2024-4892. Please keep it professional.`,
    description: 'Contains client name, email, organization, and matter number.',
  },
  {
    title: '3. Privileged Memo with Financial Data (High Risk)',
    aiTool: 'ChatGPT',
    prompt: `PRIVILEGED AND CONFIDENTIAL — ATTORNEY WORK PRODUCT

MEMORANDUM
TO: Sterling & Associates LLP — Corporate Practice Group
FROM: Siddharth Soni, Senior Associate
RE: Project Falcon — Acquisition of GlobalHealth Corp.
DATE: 02/15/2025

This memo summarizes the key findings from our due diligence review of GlobalHealth Corp. (the "Target") in connection with the proposed acquisition by our client Nexus Technologies Inc. (the "Buyer") under Matter #2024-7731.

FINANCIAL SUMMARY:
- Target revenue (FY2024): $47,500,000
- EBITDA margin: 18.3%
- Proposed acquisition price: $285 million
- Break-up fee: $14.25 million (5%)

KEY CONTACTS:
- Target CEO: Ms. Patricia Wells (patricia.wells@globalhealth.com, 415-555-0187)
- Target CFO: Mr. David Park (SSN on file: 412-68-9023, for background check)
- Buyer contact: Mr. Robert Chen (robert.chen@nexustech.com)

RISK FACTORS:
The Target has pending litigation — Wells v. MedTrust Corp (Case #2024-CV-08821) — which could impact the valuation. Attorney-client privilege applies to all communications regarding this matter.

Account #784521 at First National Bank holds the escrow funds ($28.5 million deposited 01/15/2025).`,
    description: 'Contains: privilege markers, SSN, multiple emails, phone number, account number, monetary amounts, matter numbers, case citations, deal codename, person names, organization names.',
  },
  {
    title: '4. Litigation Strategy (Critical Risk)',
    aiTool: 'Gemini',
    prompt: `ATTORNEY-CLIENT PRIVILEGE — DO NOT DISCLOSE

I need help analyzing our litigation strategy for Wells v. MedTrust Corp, Docket #2024-CV-08821.

Our client Ms. Patricia Wells (SSN: 412-68-9023) is the plaintiff. She was terminated on 03/15/2024 after reporting financial irregularities to the SEC. Her severance package was $750,000 but MedTrust is claiming breach of NDA.

Opposing counsel is Smith & Barrett LLP, lead attorney David Kim (dkim@smithbarrett.com, 212-555-0923). They've filed a motion to compel discovery of Ms. Wells' personal medical records from IP 10.0.5.42 (internal MedTrust server).

Key depositions scheduled:
- Ms. Patricia Wells: 03/20/2025
- Dr. James Liu (expert witness): 04/02/2025
- MedTrust CEO Thomas Grant: 04/15/2025

Settlement authority from our client: up to $2.8 million. Do NOT share this with opposing counsel.

Please draft our response to the motion to compel, arguing work product doctrine and attorney-client privilege protections.`,
    description: 'Maximum severity: SSNs, settlement authority, litigation strategy, privilege markers, opposing counsel details, medical references, IP addresses.',
  },
];

// ========================================
// Terminal Output Formatting
// ========================================

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_BLUE = '\x1b[44m';

function colorForLevel(level: string) {
  switch (level) {
    case 'low': return GREEN;
    case 'medium': return YELLOW;
    case 'high': return `${BOLD}${YELLOW}`;
    case 'critical': return `${BOLD}${RED}`;
    default: return WHITE;
  }
}

function bgForLevel(level: string) {
  switch (level) {
    case 'low': return BG_GREEN;
    case 'medium': return BG_YELLOW;
    case 'high': return BG_YELLOW;
    case 'critical': return BG_RED;
    default: return '';
  }
}

function bar(value: number, max: number, width: number = 30): string {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return `${GREEN}${'█'.repeat(Math.min(filled, Math.round(width * 0.25)))}${YELLOW}${'█'.repeat(Math.max(0, Math.min(filled - Math.round(width * 0.25), Math.round(width * 0.35))))}${RED}${'█'.repeat(Math.max(0, filled - Math.round(width * 0.6)))}${DIM}${'░'.repeat(empty)}${RESET}`;
}

function divider(char = '─', len = 70) {
  return DIM + char.repeat(len) + RESET;
}

// ========================================
// Main Demo
// ========================================

console.log('\n');
console.log(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════╗${RESET}`);
console.log(`${BOLD}${CYAN}║                                                                      ║${RESET}`);
console.log(`${BOLD}${CYAN}║                    🛡️  IRON GATE — LIVE DEMO  🛡️                     ║${RESET}`);
console.log(`${BOLD}${CYAN}║                    AI Governance Platform v0.2.0                      ║${RESET}`);
console.log(`${BOLD}${CYAN}║                                                                      ║${RESET}`);
console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════╝${RESET}`);
console.log('');
console.log(`${BOLD}Company Profile:${RESET}`);
console.log(`  Firm:     ${CYAN}${COMPANY.name}${RESET}`);
console.log(`  Type:     ${DIM}${COMPANY.description}${RESET}`);
console.log(`  Employee: ${CYAN}${COMPANY.employee}${RESET} — ${DIM}${COMPANY.role}${RESET}`);
console.log(`  Mode:     ${BG_BLUE}${WHITE}${BOLD} AUDIT → PROXY ${RESET}  (Phase 2 demo)`);
console.log('');
console.log(`${DIM}This demo simulates ${COMPANY.employee} using various AI tools during work.`);
console.log(`Iron Gate detects sensitive information, scores risk, and in Phase 2,${RESET}`);
console.log(`${DIM}pseudonymizes the content before it reaches the AI provider.${RESET}`);
console.log('');

for (const scenario of SCENARIOS) {
  console.log(divider('═', 70));
  console.log(`\n${BOLD}${WHITE}${scenario.title}${RESET}`);
  console.log(`${DIM}AI Tool: ${scenario.aiTool} | ${scenario.description}${RESET}\n`);

  // Show the prompt (truncated)
  console.log(`${BOLD}📝 Prompt submitted:${RESET}`);
  const lines = scenario.prompt.split('\n');
  const displayLines = lines.slice(0, 8);
  for (const line of displayLines) {
    console.log(`  ${DIM}${line.substring(0, 80)}${line.length > 80 ? '...' : ''}${RESET}`);
  }
  if (lines.length > 8) {
    console.log(`  ${DIM}... (${lines.length - 8} more lines)${RESET}`);
  }
  console.log('');

  // Detection
  const entities = detectEntities(scenario.prompt);
  const scoreResult = computeScore(scenario.prompt, entities);
  const docType = classifyDocument(scenario.prompt);

  // Score display
  const levelColor = colorForLevel(scoreResult.level);
  const levelBg = bgForLevel(scoreResult.level);

  console.log(`${BOLD}🔍 Detection Results:${RESET}`);
  console.log(`  Sensitivity Score: ${levelBg}${WHITE}${BOLD} ${scoreResult.score}/100 ${RESET} ${levelColor}${scoreResult.level.toUpperCase()}${RESET}`);
  console.log(`  Score Bar:         ${bar(scoreResult.score, 100)}`);
  console.log(`  Document Type:     ${CYAN}${docType}${RESET}`);
  console.log(`  Entities Found:    ${BOLD}${entities.length}${RESET}`);
  console.log('');

  // Score breakdown
  console.log(`  ${DIM}Score Breakdown:${RESET}`);
  console.log(`    Entity Score:    ${bar(scoreResult.entityScore, 70, 20)} ${scoreResult.entityScore}/70`);
  console.log(`    Volume Score:    ${bar(scoreResult.volumeScore, 20, 20)} ${scoreResult.volumeScore}/20`);
  console.log(`    Context Score:   ${bar(scoreResult.contextScore, 25, 20)} ${scoreResult.contextScore}/25`);
  console.log(`    Legal Boost:     ${bar(scoreResult.legalBoost, 25, 20)} ${scoreResult.legalBoost}/25`);
  console.log('');

  // Entities table
  if (entities.length > 0) {
    console.log(`  ${BOLD}Detected Entities:${RESET}`);
    console.log(`  ${'Type'.padEnd(22)} ${'Value'.padEnd(35)} ${'Conf'.padEnd(6)}`);
    console.log(`  ${DIM}${'─'.repeat(22)} ${'─'.repeat(35)} ${'─'.repeat(6)}${RESET}`);

    for (const e of entities.slice(0, 12)) {
      const typeColor = ENTITY_WEIGHTS[e.type] >= 25 ? RED : ENTITY_WEIGHTS[e.type] >= 10 ? YELLOW : GREEN;
      const truncatedText = e.text.length > 33 ? e.text.substring(0, 30) + '...' : e.text;
      console.log(`  ${typeColor}${e.type.padEnd(22)}${RESET} ${truncatedText.padEnd(35)} ${DIM}${(e.confidence * 100).toFixed(0)}%${RESET}`);
    }
    if (entities.length > 12) {
      console.log(`  ${DIM}... and ${entities.length - 12} more entities${RESET}`);
    }
  }
  console.log('');

  // Phase 2: Pseudonymization preview
  if (scoreResult.score > 25) {
    const { masked, map } = pseudonymize(scenario.prompt, entities);

    console.log(`${BOLD}🔐 Phase 2 — Pseudonymized Version:${RESET}`);

    // Action decision
    if (scoreResult.score >= 70) {
      console.log(`  ${BG_RED}${WHITE}${BOLD} ACTION: BLOCK & PROXY ${RESET} — Score exceeds block threshold (70)`);
      console.log(`  ${DIM}Original prompt blocked. Pseudonymized version sent to private LLM.${RESET}`);
    } else if (scoreResult.score >= 40) {
      console.log(`  ${BG_YELLOW}${WHITE}${BOLD} ACTION: WARN & PROXY ${RESET} — Score exceeds warn threshold (40)`);
      console.log(`  ${DIM}User warned. Pseudonymized version sent to cloud LLM.${RESET}`);
    } else {
      console.log(`  ${BG_GREEN}${WHITE}${BOLD} ACTION: PASS ${RESET} — Score below thresholds`);
    }
    console.log('');

    // Show substitution map
    const mapEntries = Object.entries(map).filter(([k, v]) => k !== v);
    if (mapEntries.length > 0) {
      console.log(`  ${BOLD}Pseudonym Map:${RESET}`);
      for (const [original, fake] of mapEntries.slice(0, 10)) {
        const truncOrig = original.length > 30 ? original.substring(0, 27) + '...' : original;
        const truncFake = fake.length > 30 ? fake.substring(0, 27) + '...' : fake;
        console.log(`    ${RED}${truncOrig.padEnd(32)}${RESET} → ${GREEN}${truncFake}${RESET}`);
      }
      if (mapEntries.length > 10) {
        console.log(`    ${DIM}... and ${mapEntries.length - 10} more substitutions${RESET}`);
      }
    }
    console.log('');

    // Show masked prompt (first few lines)
    console.log(`  ${BOLD}Masked prompt (sent to LLM):${RESET}`);
    const maskedLines = masked.split('\n').slice(0, 6);
    for (const line of maskedLines) {
      console.log(`    ${GREEN}${line.substring(0, 76)}${line.length > 76 ? '...' : ''}${RESET}`);
    }
    if (masked.split('\n').length > 6) {
      console.log(`    ${DIM}... (${masked.split('\n').length - 6} more lines)${RESET}`);
    }
  } else {
    console.log(`${BOLD}✅ Phase 2 Action:${RESET} ${BG_GREEN}${WHITE}${BOLD} PASS-THROUGH ${RESET} — Low risk, no proxying needed.`);
  }

  console.log('');
}

// Summary
console.log(divider('═', 70));
console.log(`\n${BOLD}${CYAN}📊 SESSION SUMMARY${RESET}\n`);

const allResults = SCENARIOS.map((s) => {
  const ent = detectEntities(s.prompt);
  return { ...s, entities: ent, score: computeScore(s.prompt, ent) };
});

console.log(`  Total prompts analyzed:    ${BOLD}${SCENARIOS.length}${RESET}`);
console.log(`  Total entities detected:   ${BOLD}${allResults.reduce((sum, r) => sum + r.entities.length, 0)}${RESET}`);
console.log(`  Average sensitivity score: ${BOLD}${Math.round(allResults.reduce((sum, r) => sum + r.score.score, 0) / allResults.length)}${RESET}`);
console.log('');

console.log(`  ${'Scenario'.padEnd(40)} ${'Score'.padEnd(10)} ${'Level'.padEnd(12)} ${'Action'}`);
console.log(`  ${DIM}${'─'.repeat(40)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(15)}${RESET}`);

for (const r of allResults) {
  const color = colorForLevel(r.score.level);
  const action = r.score.score >= 70 ? `${RED}BLOCK+PROXY` : r.score.score >= 40 ? `${YELLOW}WARN+PROXY` : `${GREEN}PASS`;
  console.log(`  ${r.title.substring(0, 40).padEnd(40)} ${color}${String(r.score.score).padEnd(10)}${RESET} ${color}${r.score.level.toUpperCase().padEnd(12)}${RESET} ${action}${RESET}`);
}

console.log('');
console.log(`${DIM}${'─'.repeat(70)}${RESET}`);
console.log(`${DIM}Iron Gate v0.2.0 — Phase 1 (Audit) + Phase 2 (Proxy) Demo${RESET}`);
console.log(`${DIM}Firm: ${COMPANY.name} | Employee: ${COMPANY.employee}${RESET}`);
console.log(`${DIM}All data shown is fictional and for demonstration purposes only.${RESET}`);
console.log('');
