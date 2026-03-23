"""
Iron Gate Context Classifier

Classifies the overall intent/context of a prompt into categories
that feed the policy engine. A CISO doesn't just need to know
"this prompt contains a PERSON" — they need to know "this is
customer data processing" vs "this is code review."

Categories:
- contract_review: Legal document analysis
- financial_analysis: Financial data, forecasting, valuation
- hr_matters: Employee data, performance, compensation, termination
- customer_data: Customer records, CRM data, client info
- code_review: Source code, technical documentation
- competitive_intel: Competitor analysis, market intelligence
- medical_health: Patient data, clinical, health records
- legal_strategy: Litigation, settlement, privilege
- internal_comms: Slack exports, meeting notes, executive comms
- creative_writing: Marketing copy, blog posts, presentations
- personal_task: Resume, bio, cover letter (self-referential)
- general: Default — no strong signal
"""

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ContextClassification:
    category: str
    confidence: float
    signals: list[str]


# Pattern weights: (regex, category, weight, signal_name)
_CONTEXT_PATTERNS: list[tuple[str, str, float, str]] = [
    # Contract / Legal document review
    (r'\b(?:review|analyze|summarize|redline|draft)\s+(?:this\s+)?(?:contract|agreement|lease|NDA|MOU|terms|clause|provision|amendment)\b', 'contract_review', 3.0, 'contract_language'),
    (r'\b(?:section|clause|paragraph|article)\s+\d+', 'contract_review', 2.0, 'section_reference'),
    (r'\b(?:indemnif|liability|warrant|covenant|terminat|breach|force majeure|governing law)\b', 'contract_review', 1.5, 'legal_terms'),

    # Financial analysis
    (r'\b(?:revenue|EBITDA|valuation|forecast|P&L|balance sheet|cash flow|ROI|NPV|IRR|margin|CAGR)\b', 'financial_analysis', 2.5, 'financial_terms'),
    (r'\b(?:Q[1-4]|fiscal\s+year|FY\d{2}|quarterly|annual\s+report|10-K|10-Q)\b', 'financial_analysis', 2.0, 'reporting_period'),
    (r'\$[\d,]+(?:\.\d+)?[MBK]?\b', 'financial_analysis', 1.0, 'dollar_amounts'),

    # HR matters
    (r'\b(?:employee|headcount|termination|severance|PIP|performance review|compensation|salary|bonus|promotion|demotion|layoff|RIF|furlough)\b', 'hr_matters', 2.5, 'hr_terms'),
    (r'\b(?:HR|human resources|people ops|talent|recruiting|onboarding|offboarding)\b', 'hr_matters', 1.5, 'hr_department'),

    # Customer data processing
    (r'\b(?:customer|client|account\s+holder|subscriber|member|patient)\s+(?:data|record|info|detail|list|database|CRM)\b', 'customer_data', 3.0, 'customer_data_ref'),
    (r'\b(?:CRM|Salesforce|HubSpot|customer\s+database|client\s+list|account\s+list)\b', 'customer_data', 2.0, 'crm_reference'),

    # Code review
    (r'\b(?:function|class|method|variable|import|export|return|async|await|const|let|var|def|self)\b', 'code_review', 1.0, 'code_keywords'),
    (r'(?:```|<code>|\.(?:py|js|ts|java|go|rs|cpp|rb)\b)', 'code_review', 2.0, 'code_markers'),
    (r'\b(?:bug|error|exception|stack\s+trace|debug|refactor|optimize|deploy|CI\/CD|pull\s+request|PR|commit)\b', 'code_review', 1.5, 'dev_terms'),

    # Competitive intelligence
    (r'\b(?:competitor|competitive\s+(?:analysis|landscape|intel)|market\s+share|SWOT|benchmark|positioning)\b', 'competitive_intel', 3.0, 'competitive_terms'),
    (r'\b(?:vs\.?|versus|compared\s+to|compared\s+with)\s+[A-Z][a-z]+', 'competitive_intel', 1.5, 'comparison_pattern'),

    # Medical / Health
    (r'\b(?:patient|diagnosis|treatment|medication|prescription|ICD-10|CPT|HIPAA|PHI|clinical|symptoms|prognosis)\b', 'medical_health', 3.0, 'medical_terms'),
    (r'\b(?:hospital|clinic|physician|nurse|pharmacy|lab\s+results?|radiology|pathology)\b', 'medical_health', 2.0, 'healthcare_setting'),

    # Legal strategy
    (r'\b(?:litigation|settlement|deposition|discovery|privilege|subpoena|motion|filing|opposing\s+counsel|damages|verdict|arbitration)\b', 'legal_strategy', 3.0, 'litigation_terms'),
    (r'\b(?:attorney[\s-]client|work\s+product|privileged\s+and\s+confidential)\b', 'legal_strategy', 4.0, 'privilege_markers'),

    # Internal comms
    (r'\b(?:exported?|copied|pasted?|shared?|forwarded?|dumped?)\s+(?:a\s+|the\s+|this\s+)?(?:slack|teams|email|chat|message|thread|transcript)\b', 'internal_comms', 4.0, 'comms_export'),
    (r'\b(?:CEO|CFO|CTO|COO|CIO|VP|SVP|EVP|Head\s+of)\s*:', 'internal_comms', 3.0, 'executive_quote'),
    (r'\b(?:meeting\s+notes?|standup|all[\s-]?hands|town\s+hall|board\s+meeting|leadership\s+(?:sync|meeting|discussion))\b', 'internal_comms', 2.5, 'meeting_reference'),

    # Creative / Marketing
    (r'\b(?:write|draft|create)\s+(?:a\s+)?(?:blog|article|post|email\s+campaign|newsletter|press\s+release|marketing\s+copy|tagline|slogan)\b', 'creative_writing', 3.0, 'creative_request'),

    # Personal tasks (self-referential)
    (r'\b(?:my\s+resume|my\s+CV|my\s+bio|my\s+cover\s+letter|my\s+LinkedIn|improve\s+my|update\s+my)\b', 'personal_task', 4.0, 'personal_document'),
    (r'\b(?:I\s+am\s+a|I\s+work\s+at|I\s+have\s+\d+\s+years?|my\s+experience|my\s+background)\b', 'personal_task', 2.0, 'self_introduction'),
]


def classify_context(text: str) -> ContextClassification:
    """
    Classify the context/intent of a prompt.

    Returns the highest-scoring category with confidence and signal list.
    """
    scores: dict[str, float] = {}
    signals: dict[str, list[str]] = {}

    for pattern, category, weight, signal_name in _CONTEXT_PATTERNS:
        matches = re.findall(pattern, text, re.IGNORECASE)
        if matches:
            match_count = min(len(matches), 5)  # Cap at 5 to prevent one pattern dominating
            scores[category] = scores.get(category, 0) + weight * match_count
            if category not in signals:
                signals[category] = []
            signals[category].append(f"{signal_name}({match_count})")

    if not scores:
        return ContextClassification(
            category="general",
            confidence=0.5,
            signals=[],
        )

    # Find the top category
    top_category = max(scores, key=scores.get)  # type: ignore
    top_score = scores[top_category]

    # Normalize confidence to 0-1 range
    # Score of 8+ = high confidence, 3-8 = medium, <3 = low
    confidence = min(1.0, top_score / 10.0)
    confidence = max(0.3, confidence)  # Floor at 0.3

    return ContextClassification(
        category=top_category,
        confidence=round(confidence, 2),
        signals=signals.get(top_category, []),
    )
