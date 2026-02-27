/**
 * Prompt Template Library — Priority 10.5
 *
 * Firm-approved prompt templates with designated paste zones.
 * Delivered via policy sync, displayed in the side panel.
 */

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  /** Practice group tag for filtering */
  practiceGroup: string;
  /** Template text with {{PASTE_HERE}} placeholder */
  promptText: string;
  /** Entity rules for the paste zone context */
  entityRules?: {
    /** Entity types to always scan in this context */
    requiredTypes?: string[];
    /** Entity types to suppress in this context */
    suppressedTypes?: string[];
    /** Minimum confidence threshold */
    minConfidence?: number;
  };
}

/**
 * Built-in templates for common use cases.
 */
export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'legal-contract-review',
    name: 'Contract Review',
    description: 'Analyze a contract clause for risks and obligations',
    practiceGroup: 'Legal',
    promptText: `You are a legal assistant. Review the following contract clause and identify:
1. Key obligations for each party
2. Potential risks or ambiguities
3. Suggested improvements

Contract clause:
{{PASTE_HERE}}

Provide your analysis in a structured format.`,
    entityRules: {
      requiredTypes: ['PERSON', 'ORGANIZATION', 'MONETARY_AMOUNT'],
      minConfidence: 0.7,
    },
  },
  {
    id: 'legal-case-research',
    name: 'Case Law Research',
    description: 'Research relevant case law for a legal issue',
    practiceGroup: 'Legal',
    promptText: `Research relevant case law for the following legal issue. Do not include any privileged information — focus on public case citations only.

Legal issue:
{{PASTE_HERE}}

List relevant cases with citations and brief summaries of holdings.`,
    entityRules: {
      suppressedTypes: ['PERSON', 'SSN', 'CREDIT_CARD'],
    },
  },
  {
    id: 'medical-clinical-summary',
    name: 'Clinical Summary',
    description: 'Summarize clinical findings (ensure PHI is redacted)',
    practiceGroup: 'Healthcare',
    promptText: `Summarize the following clinical findings into a concise clinical summary.
Note: All patient identifiers should be redacted before pasting.

Clinical findings:
{{PASTE_HERE}}

Provide a structured summary with: diagnosis, key findings, and recommended next steps.`,
    entityRules: {
      requiredTypes: ['MEDICAL_RECORD', 'PERSON', 'DATE'],
      minConfidence: 0.6,
    },
  },
  {
    id: 'financial-analysis',
    name: 'Financial Analysis',
    description: 'Analyze financial data or market conditions',
    practiceGroup: 'Finance',
    promptText: `Analyze the following financial data. Focus on trends, anomalies, and actionable insights.
Note: Ensure no material non-public information is included.

Data:
{{PASTE_HERE}}

Provide your analysis with key metrics and recommendations.`,
    entityRules: {
      requiredTypes: ['MONETARY_AMOUNT', 'ORGANIZATION'],
    },
  },
  {
    id: 'general-email-draft',
    name: 'Professional Email Draft',
    description: 'Draft a professional email from bullet points',
    practiceGroup: 'General',
    promptText: `Draft a professional email based on the following key points.
Use a formal but friendly tone appropriate for a business context.

Key points:
{{PASTE_HERE}}

Provide the complete email with subject line.`,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Review code for bugs, security issues, and best practices',
    practiceGroup: 'Engineering',
    promptText: `Review the following code for:
1. Bugs or logic errors
2. Security vulnerabilities
3. Performance issues
4. Best practice violations

Code:
{{PASTE_HERE}}

Provide specific, actionable feedback.`,
    entityRules: {
      suppressedTypes: ['PERSON', 'DATE', 'PHONE_NUMBER'],
    },
  },
];

/**
 * Apply a template by replacing the {{PASTE_HERE}} placeholder.
 */
export function applyTemplate(template: PromptTemplate, pastedContent: string): string {
  return template.promptText.replace('{{PASTE_HERE}}', pastedContent);
}

/**
 * Filter templates by practice group.
 */
export function filterTemplates(
  templates: PromptTemplate[],
  practiceGroup?: string
): PromptTemplate[] {
  if (!practiceGroup) return templates;
  return templates.filter((t) => t.practiceGroup === practiceGroup);
}

/**
 * Get unique practice groups from templates.
 */
export function getPracticeGroups(templates: PromptTemplate[]): string[] {
  return [...new Set(templates.map((t) => t.practiceGroup))].sort();
}
