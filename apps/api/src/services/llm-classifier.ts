/**
 * LLM Classifier Service — Tier 3 Server-Side Classification
 *
 * Receives sanitized text (PII replaced with [TYPE] tokens) from the
 * extension's confidence router and returns a sensitivity classification.
 *
 * Default LLM: Google Gemini 2.5 Flash via the OpenAI-compatible endpoint
 * (https://generativelanguage.googleapis.com/v1beta/openai/chat/completions).
 * Any OpenAI-compatible API can be substituted via CLASSIFIER_LLM_ENDPOINT.
 *
 * The classifier analyses document context, legal risk, and business
 * sensitivity from the structural patterns alone — never seeing raw PII.
 *
 * Fallback: If no LLM is configured, uses a rule-based heuristic
 * that counts type tokens and contextual markers.
 */

import { logger } from '../lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationRequest {
  /** Sanitized text with [TYPE] tokens replacing PII */
  sanitizedText: string;
  /** Entity type counts from Tier 1 */
  entityTypeCounts: Record<string, number>;
  /** Tier 1 score for reference */
  tier1Score: number;
  /** Tier 1 level for reference */
  tier1Level: string;
  /** Firm ID for firm-specific policies */
  firmId: string;
}

export interface ClassificationResult {
  /** Recommended score (0-100) */
  score: number;
  /** Recommended level */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** Confidence in this classification (0-1) */
  confidence: number;
  /** Classification reasoning */
  reasoning: string;
  /** Source of classification */
  source: 'llm' | 'heuristic';
  /** Processing time in ms */
  latencyMs: number;
}

// ── LLM Classification ──────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are a data sensitivity classifier for an enterprise compliance system.

Analyze the following text where PII has been replaced with [TYPE] tokens (e.g., [PERSON], [SSN], [CREDIT_CARD]).
Your task is to assess the SENSITIVITY LEVEL of the original content based on:

1. Types and counts of PII tokens present
2. Surrounding context (legal, medical, financial, M&A, HR)
3. Whether the content represents a document paste, bulk data, or casual query
4. Regulatory implications (HIPAA, SOX, GDPR, attorney-client privilege)

Respond with EXACTLY this JSON format:
{
  "score": <number 0-100>,
  "level": "<low|medium|high|critical>",
  "confidence": <number 0.0-1.0>,
  "reasoning": "<one sentence explaining the classification>"
}

Score ranges:
- 0-25 (low): Generic queries, no meaningful PII
- 26-60 (medium): Some identifiable information, moderate risk
- 61-85 (high): Multiple sensitive entities, legal/medical/financial context
- 86-100 (critical): Highly sensitive (bulk PII, credentials, privilege, MNPI)`;

export async function classifyWithLLM(
  request: ClassificationRequest,
  llmEndpoint: string,
  llmApiKey: string,
  model: string = 'gemini-2.5-flash',
): Promise<ClassificationResult> {
  const start = Date.now();

  const entitySummary = Object.entries(request.entityTypeCounts)
    .map(([type, count]) => `${count}x [${type}]`)
    .join(', ');

  const userMessage = `Entity summary: ${entitySummary}
Tier 1 score: ${request.tier1Score} (${request.tier1Level})

Text to classify:
---
${request.sanitizedText.substring(0, 4000)}
---`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(llmEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: CLASSIFICATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('Empty LLM response');
    }

    const parsed = JSON.parse(content);
    const latencyMs = Date.now() - start;

    return {
      score: Math.min(100, Math.max(0, Math.round(parsed.score || 0))),
      level: validateLevel(parsed.level),
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.substring(0, 200) : '',
      source: 'llm',
      latencyMs,
    };
  } catch (err) {
    logger.warn('LLM classification failed, falling back to heuristic', {
      error: err instanceof Error ? err.message : String(err),
    });
    return classifyWithHeuristic(request);
  }
}

// ── Heuristic Fallback ───────────────────────────────────────────────────────

const HIGH_RISK_TOKENS = new Set([
  'SSN', 'CREDIT_CARD', 'MEDICAL_RECORD', 'PASSPORT_NUMBER', 'DRIVERS_LICENSE',
  'API_KEY', 'AWS_CREDENTIAL', 'GCP_CREDENTIAL', 'DATABASE_URI', 'PRIVATE_KEY',
  'CLASSIFICATION_MARKING', 'EXPORT_CONTROL',
]);

const MEDIUM_RISK_TOKENS = new Set([
  'PERSON', 'EMAIL', 'PHONE_NUMBER', 'ACCOUNT_NUMBER', 'MONETARY_AMOUNT',
  'MATTER_NUMBER', 'CLIENT_MATTER_PAIR', 'PRIVILEGE_MARKER',
]);

const CONTEXT_KEYWORDS: Record<string, number> = {
  'privileged': 15, 'attorney-client': 15, 'hipaa': 15, 'phi': 10,
  'settlement': 10, 'merger': 12, 'acquisition': 12, 'confidential': 8,
  'classified': 15, 'secret': 10, 'whistleblower': 15, 'insider': 10,
  'layoff': 10, 'termination': 8, 'severance': 10,
};

export function classifyWithHeuristic(request: ClassificationRequest): ClassificationResult {
  const start = Date.now();
  let score = request.tier1Score; // Start from Tier 1 as baseline

  // Count high-risk and medium-risk tokens
  let highRiskCount = 0;
  let mediumRiskCount = 0;
  let totalEntities = 0;

  for (const [type, count] of Object.entries(request.entityTypeCounts)) {
    totalEntities += count;
    if (HIGH_RISK_TOKENS.has(type)) highRiskCount += count;
    else if (MEDIUM_RISK_TOKENS.has(type)) mediumRiskCount += count;
  }

  // Scan sanitized text for contextual keywords
  const lowerText = request.sanitizedText.toLowerCase();
  let contextBoost = 0;
  for (const [keyword, weight] of Object.entries(CONTEXT_KEYWORDS)) {
    if (lowerText.includes(keyword)) {
      contextBoost += weight;
    }
  }

  // Heuristic scoring adjustments
  if (highRiskCount >= 2) score = Math.max(score, 86);
  else if (highRiskCount >= 1) score = Math.max(score, 61);

  if (mediumRiskCount >= 5) score = Math.max(score, 61);
  else if (mediumRiskCount >= 3) score = Math.max(score, 40);

  if (totalEntities >= 10) score = Math.max(score, 70);

  score = Math.min(100, score + Math.min(30, contextBoost));

  const level = score <= 25 ? 'low' : score <= 60 ? 'medium' : score <= 85 ? 'high' : 'critical';
  const latencyMs = Date.now() - start;

  return {
    score,
    level,
    confidence: 0.6,
    reasoning: `Heuristic: ${highRiskCount} high-risk, ${mediumRiskCount} medium-risk entities, ${totalEntities} total, context boost ${contextBoost}`,
    source: 'heuristic',
    latencyMs,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function validateLevel(level: string): 'low' | 'medium' | 'high' | 'critical' {
  const valid = ['low', 'medium', 'high', 'critical'];
  return valid.includes(level) ? level as any : 'medium';
}
