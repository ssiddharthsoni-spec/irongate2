/**
 * Document Type Classifier
 * Classifies prompts by structural signals — no ML needed for v1.
 * Used as a score multiplier in the sensitivity scoring pipeline.
 */

export type DocumentType =
  | 'casual_question'
  | 'email_draft'
  | 'contract_clause'
  | 'meeting_notes'
  | 'code_snippet'
  | 'financial_data'
  | 'litigation_doc'
  | 'client_memo'
  | 'personal'
  | 'insurance_doc'
  | 'medical_record'
  | 'government_doc'
  | 'energy_report'
  | 'real_estate_doc'
  | 'education_record'
  | 'public_content';

export const DOCUMENT_TYPE_MULTIPLIERS: Record<DocumentType, number> = {
  casual_question: 0.5,
  email_draft: 1.2,
  contract_clause: 2.0,
  meeting_notes: 1.3,
  code_snippet: 0.8,
  financial_data: 1.8,
  litigation_doc: 2.0,
  client_memo: 1.5,
  personal: 0.3,
  insurance_doc: 1.8,
  medical_record: 2.0,
  government_doc: 2.0,
  energy_report: 1.6,
  real_estate_doc: 1.5,
  education_record: 1.8,
  public_content: 0.3,
};

interface ClassificationResult {
  type: DocumentType;
  confidence: number;
  signals: string[];
}

export function classifyDocument(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const signals: string[] = [];
  const scores: Partial<Record<DocumentType, number>> = {};

  // --- Casual Question ---
  if (text.length < 200 && text.includes('?')) {
    scores.casual_question = (scores.casual_question || 0) + 3;
    signals.push('short_question');
  }
  if (/^(what|how|why|when|where|who|can|could|would|should|is|are|do|does)\b/i.test(text.trim())) {
    scores.casual_question = (scores.casual_question || 0) + 2;
    signals.push('question_word_start');
  }

  // --- Email Draft ---
  if (/\b(dear|hi|hello|hey|subject:|re:|fwd:)\b/i.test(text)) {
    scores.email_draft = (scores.email_draft || 0) + 3;
    signals.push('email_greeting');
  }
  if (/\b(regards|sincerely|best|thanks|cheers)\b/i.test(text)) {
    scores.email_draft = (scores.email_draft || 0) + 2;
    signals.push('email_closing');
  }

  // --- Contract Clause ---
  if (/\b(whereas|hereby|hereinafter|notwithstanding|shall|therein|thereof)\b/i.test(text)) {
    scores.contract_clause = (scores.contract_clause || 0) + 4;
    signals.push('legal_language');
  }
  if (/\b(section\s+\d|article\s+\d|clause\s+\d|paragraph\s+\d)\b/i.test(text)) {
    scores.contract_clause = (scores.contract_clause || 0) + 3;
    signals.push('section_references');
  }
  if (/\b(indemnif|warrant|covenant|representation|obligation)\b/i.test(text)) {
    scores.contract_clause = (scores.contract_clause || 0) + 3;
    signals.push('contract_terms');
  }

  // --- Meeting Notes ---
  if (/\b(agenda|action items?|attendees?|minutes|discussed|next steps)\b/i.test(text)) {
    scores.meeting_notes = (scores.meeting_notes || 0) + 4;
    signals.push('meeting_keywords');
  }
  if (/^\s*[-•*]\s/m.test(text)) {
    scores.meeting_notes = (scores.meeting_notes || 0) + 1;
    signals.push('bullet_points');
  }

  // --- Code Snippet ---
  if (/\b(function|const|let|var|import|export|class|interface|return|if|else|for|while)\b/.test(text)) {
    scores.code_snippet = (scores.code_snippet || 0) + 2;
    signals.push('code_keywords');
  }
  if (/[{}\[\]();]/.test(text) && /\n/.test(text)) {
    scores.code_snippet = (scores.code_snippet || 0) + 2;
    signals.push('code_syntax');
  }
  if (/```/.test(text)) {
    scores.code_snippet = (scores.code_snippet || 0) + 3;
    signals.push('code_fences');
  }

  // --- Financial Data ---
  if (/\$[\d,.]+\s*(million|billion|M|B|k)/i.test(text)) {
    scores.financial_data = (scores.financial_data || 0) + 4;
    signals.push('large_monetary');
  }
  if (/\b(revenue|ebitda|profit|margin|valuation|cap table|balance sheet|p&l|income statement)\b/i.test(text)) {
    scores.financial_data = (scores.financial_data || 0) + 3;
    signals.push('financial_terms');
  }

  // --- Litigation Doc ---
  if (/\b(plaintiff|defendant|court|judge|ruling|motion|complaint|discovery|deposition)\b/i.test(text)) {
    scores.litigation_doc = (scores.litigation_doc || 0) + 4;
    signals.push('litigation_terms');
  }
  if (/\bv\.\s+/i.test(text)) {
    scores.litigation_doc = (scores.litigation_doc || 0) + 2;
    signals.push('case_citation');
  }

  // --- Client Memo ---
  if (/\b(memorandum|memo|to:|from:|date:|re:)\b/i.test(text) && text.length > 300) {
    scores.client_memo = (scores.client_memo || 0) + 3;
    signals.push('memo_format');
  }
  if (/\b(analysis|recommendation|conclusion|summary|background)\b/i.test(text)) {
    scores.client_memo = (scores.client_memo || 0) + 2;
    signals.push('memo_sections');
  }

  // --- Personal ---
  if (/\b(my personal|my own|just for me|not work|personal project)\b/i.test(text)) {
    scores.personal = (scores.personal || 0) + 4;
    signals.push('personal_markers');
  }

  // --- Insurance Document ---
  if (/\b(policyholder|insured|claimant|claims?\s+reserve|loss\s+ratio|combined\s+ratio|actuarial|underwriting)\b/i.test(text)) {
    scores.insurance_doc = (scores.insurance_doc || 0) + 4;
    signals.push('insurance_terms');
  }
  if (/\b(IBNR|reinsurance|treaty|catastrophe\s+model|PML|solvency)\b/i.test(text)) {
    scores.insurance_doc = (scores.insurance_doc || 0) + 3;
    signals.push('insurance_technical');
  }

  // --- Medical Record ---
  if (/\b(patient|diagnosis|medication|dosage|discharge|admission|MRN|medical\s+record)\b/i.test(text)) {
    scores.medical_record = (scores.medical_record || 0) + 4;
    signals.push('medical_terms');
  }
  if (/\b(HIPAA|PHI|protected\s+health|clinical\s+trial|lab\s+results?)\b/i.test(text)) {
    scores.medical_record = (scores.medical_record || 0) + 3;
    signals.push('hipaa_context');
  }

  // --- Government Document ---
  if (/\b(classified|top\s+secret|FOUO|CUI|controlled\s+unclassified|ITAR|export\s+control)\b/i.test(text)) {
    scores.government_doc = (scores.government_doc || 0) + 5;
    signals.push('classification_markers');
  }
  if (/\b(procurement|RFP|appropriation|CFIUS|inspector\s+general|OFAC|sanctions?)\b/i.test(text)) {
    scores.government_doc = (scores.government_doc || 0) + 3;
    signals.push('government_terms');
  }

  // --- Energy Report ---
  if (/\b(reserves?|BOE|MBOE|production\s+rate|decline\s+curve|well\s+log|seismic)\b/i.test(text)) {
    scores.energy_report = (scores.energy_report || 0) + 4;
    signals.push('energy_exploration');
  }
  if (/\b(PPA|FERC|NERC|tariff|rate\s+case|LCOE|capacity\s+factor|renewable)\b/i.test(text)) {
    scores.energy_report = (scores.energy_report || 0) + 3;
    signals.push('energy_regulatory');
  }

  // --- Real Estate Document ---
  if (/\b(cap\s+rate|NOI|rent\s+roll|occupancy|vacancy|tenant|lease\s+abstract)\b/i.test(text)) {
    scores.real_estate_doc = (scores.real_estate_doc || 0) + 4;
    signals.push('real_estate_terms');
  }
  if (/\b(1031\s+exchange|zoning|entitlement|off[\s-]?market|appraisal|APN|parcel)\b/i.test(text)) {
    scores.real_estate_doc = (scores.real_estate_doc || 0) + 3;
    signals.push('real_estate_deal');
  }

  // --- Education Record ---
  if (/\b(FERPA|student\s+record|transcript|GPA|financial\s+aid|enrollment)\b/i.test(text)) {
    scores.education_record = (scores.education_record || 0) + 4;
    signals.push('education_terms');
  }
  if (/\b(Title\s+IX|disciplinary|IRB|accreditation|NCAA|tenure)\b/i.test(text)) {
    scores.education_record = (scores.education_record || 0) + 3;
    signals.push('education_compliance');
  }

  // --- Public Content (press releases, public filings, generic advice) ---
  if (/\b(for\s+immediate\s+release|press\s+release|publicly\s+(?:filed|available|released|disclosed)|public\s+record|this\s+(?:information|filing)\s+is\s+(?:a\s+)?public)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 5;
    signals.push('public_release');
  }
  if (/\b(available\s+(?:at|on)\s+\w+\.(?:com|gov|org|edu)|now\s+playing|visit\s+\w+\.com|open\s+to\s+all)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 3;
    signals.push('public_availability');
  }
  // Generic advice/tips/educational (no specific individuals)
  if (/\b(\d+\s+tips?\s+for|how\s+to\s+(?:manage|improve|prevent|reduce)|consult\s+your\s+(?:doctor|healthcare|physician|advisor)|always\s+consult)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 4;
    signals.push('generic_advice');
  }
  // Job postings with generic structure
  if (/\b(how\s+to\s+apply|we\s+are\s+an?\s+equal\s+opportunity|send\s+your\s+resume|requirements?:|nice\s+to\s+have:)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 4;
    signals.push('job_posting');
  }
  // Public listing/catalog language
  if (/\b(for\s+sale:|list\s+price:|days\s+on\s+market|MLS#|now\s+recruiting|open\s+(?:enrollment|house))\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 4;
    signals.push('public_listing');
  }
  // Published CVE / public security advisory
  if (/\b(patches?\s+(?:are\s+)?available|has\s+been\s+publicly\s+disclosed|fixed\s+in|workaround:)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 3;
    signals.push('public_advisory');
  }
  // Public regulatory/government filings
  if (/\b(public\s+comments?\s+(?:due|period)|this\s+(?:schedule|filing|document)\s+is\s+a\s+public)\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 4;
    signals.push('public_filing');
  }
  // No PII indicators present in the text (reinforces public content)
  if ((scores.public_content || 0) >= 3 && !/\b(SSN|DOB|date\s+of\s+birth|social\s+security|confidential|privileged|do\s+not\s+(?:share|distribute|forward))\b/i.test(text)) {
    scores.public_content = (scores.public_content || 0) + 2;
    signals.push('no_confidential_markers');
  }

  // Find the type with highest score
  let bestType: DocumentType = 'casual_question';
  let bestScore = 0;

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as DocumentType;
    }
  }

  // Calculate confidence (normalize)
  const maxPossible = 8; // Rough max for any single type
  const confidence = Math.min(1, bestScore / maxPossible);

  return {
    type: bestType,
    confidence,
    signals,
  };
}
