"""
Iron Gate Policy Engine

Evaluates JSONB policy rules against detection results.
First-match wins. Admins build rules through the dashboard UI.

Rule format:
{
    "if": {
        "entity_type": "CREDIT_CARD",     # or "*" for any
        "context": "customer_data",        # optional
        "ai_tool": "chatgpt",             # optional, or "*"
        "user_role": "finance",           # optional
        "entity_count_gte": 5,            # optional volume threshold
    },
    "then": "block",                       # allow | pseudonymize | warn | block
    "explanation": "Credit card data...",   # shown to employee
    "notify": ["security_team"],           # optional alert targets
}

Compliance templates (HIPAA, PCI-DSS, GDPR, SOC2) are pre-built
collections of these rules. One click enables all of them.
"""

import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DryRunMatch:
    """A rule that matched during dry-run evaluation."""
    rule_index: int
    rule: dict
    would_action: str
    would_explanation: str
    would_notify: list[str]


@dataclass
class PolicyDecision:
    """Result of evaluating a prompt against org policy rules."""
    action: str  # allow, pseudonymize, warn, block
    explanation: str
    matched_rule_index: Optional[int] = None
    notify: list[str] = field(default_factory=list)
    compliance_template: Optional[str] = None
    dry_run_matches: list[DryRunMatch] = field(default_factory=list)


@dataclass
class PolicyContext:
    """Context for policy evaluation."""
    entity_types: list[str]
    entity_count: int
    context_category: str
    ai_tool: str
    user_role: Optional[str] = None
    user_team: Optional[str] = None
    score: int = 0
    level: str = "low"


# ---------------------------------------------------------------------------
# Compliance Templates — pre-built rule collections
# ---------------------------------------------------------------------------

COMPLIANCE_TEMPLATES: dict[str, list[dict]] = {
    "hipaa": [
        {
            "if": {"entity_type": "MEDICAL_RECORD"},
            "then": "block",
            "explanation": "HIPAA: Medical records cannot be sent to AI tools.",
            "notify": ["security_team"],
        },
        {
            "if": {"entity_type": "PERSON", "context": "medical_health"},
            "then": "block",
            "explanation": "HIPAA: Patient-identifiable health information detected.",
            "notify": ["security_team"],
        },
        {
            "if": {"context": "medical_health"},
            "then": "pseudonymize",
            "explanation": "HIPAA: Health-related content detected. Data has been protected.",
        },
    ],
    "pci_dss": [
        {
            "if": {"entity_type": "CREDIT_CARD"},
            "then": "block",
            "explanation": "PCI-DSS: Credit card numbers cannot be shared with AI tools.",
            "notify": ["security_team"],
        },
        {
            "if": {"entity_type": "ACCOUNT_NUMBER"},
            "then": "warn",
            "explanation": "PCI-DSS: Account numbers detected. Proceed with caution.",
        },
    ],
    "gdpr": [
        {
            "if": {"entity_type": "PERSON", "entity_count_gte": 3},
            "then": "pseudonymize",
            "explanation": "GDPR: Multiple personal identifiers detected. Data has been anonymized.",
        },
        {
            "if": {"entity_type": "EMAIL"},
            "then": "pseudonymize",
            "explanation": "GDPR: Email addresses have been anonymized.",
        },
        {
            "if": {"entity_type": "PHONE_NUMBER"},
            "then": "pseudonymize",
            "explanation": "GDPR: Phone numbers have been anonymized.",
        },
    ],
    "soc2": [
        {
            "if": {"entity_type": "API_KEY"},
            "then": "block",
            "explanation": "SOC 2: API keys and credentials must never be shared externally.",
            "notify": ["security_team"],
        },
        {
            "if": {"entity_type": "DATABASE_URI"},
            "then": "block",
            "explanation": "SOC 2: Database connection strings detected.",
            "notify": ["security_team"],
        },
        {
            "if": {"entity_type": "PRIVATE_KEY"},
            "then": "block",
            "explanation": "SOC 2: Private keys detected.",
            "notify": ["security_team"],
        },
        {
            "if": {"entity_type": "AWS_CREDENTIAL"},
            "then": "block",
            "explanation": "SOC 2: Cloud credentials detected.",
            "notify": ["security_team"],
        },
    ],
}


# ---------------------------------------------------------------------------
# Default rules (applied when no org-specific policy exists)
# ---------------------------------------------------------------------------

DEFAULT_RULES: list[dict] = [
    # Credentials — always block
    {
        "if": {"entity_type_in": ["API_KEY", "DATABASE_URI", "PRIVATE_KEY", "AWS_CREDENTIAL", "GCP_CREDENTIAL", "AUTH_TOKEN"]},
        "then": "block",
        "explanation": "Credentials and secrets cannot be sent to AI tools.",
        "notify": ["security_team"],
    },
    # Critical PII — block
    {
        "if": {"entity_type_in": ["SSN", "PASSPORT_NUMBER", "DRIVERS_LICENSE"]},
        "then": "block",
        "explanation": "Government-issued identifiers cannot be shared with AI tools.",
    },
    # High-sensitivity entities — pseudonymize
    {
        "if": {"entity_type_in": ["CREDIT_CARD", "MEDICAL_RECORD", "ACCOUNT_NUMBER"]},
        "then": "pseudonymize",
        "explanation": "Sensitive financial or medical data has been protected.",
    },
    # Personal data — pseudonymize
    {
        "if": {"entity_type_in": ["PERSON", "EMAIL", "PHONE_NUMBER"]},
        "then": "pseudonymize",
        "explanation": "Personal identifiers have been replaced with realistic pseudonyms.",
    },
    # Organization names — pseudonymize
    {
        "if": {"entity_type": "ORGANIZATION"},
        "then": "pseudonymize",
        "explanation": "Organization names have been anonymized.",
    },
    # Internal comms — warn
    {
        "if": {"context": "internal_comms"},
        "then": "pseudonymize",
        "explanation": "Internal communications detected. Sensitive content has been protected.",
    },
    # Default — allow
    {
        "if": {"entity_type": "*"},
        "then": "allow",
        "explanation": "No sensitive content requiring protection was detected.",
    },
]


def evaluate_policy(
    rules: list[dict],
    context: PolicyContext,
    compliance_templates: Optional[list[str]] = None,
) -> PolicyDecision:
    """
    Evaluate policy rules against detection context.

    First-match wins (among non-dry-run rules). Compliance template rules
    are prepended to org rules.

    Dry-run rules (with ``"dry_run": true``) are evaluated alongside real
    rules but do **not** affect the actual decision. They are collected in
    ``dry_run_matches`` so admins can preview what *would* happen before
    activating a rule.
    """
    # Build effective rule list: compliance templates first, then org rules
    effective_rules: list[dict] = []

    if compliance_templates:
        for template_name in compliance_templates:
            template_rules = COMPLIANCE_TEMPLATES.get(template_name, [])
            effective_rules.extend(template_rules)

    effective_rules.extend(rules)

    # If no rules at all, use defaults
    if not effective_rules:
        effective_rules = DEFAULT_RULES

    # Collect dry-run matches separately
    dry_run_matches: list[DryRunMatch] = []
    real_decision: Optional[PolicyDecision] = None

    # Evaluate rules in order
    for i, rule in enumerate(effective_rules):
        condition = rule.get("if", {})
        if not _matches(condition, context):
            continue

        is_dry_run = bool(rule.get("dry_run", False))

        if is_dry_run:
            # Record what would have happened but don't use as the decision
            dry_run_matches.append(DryRunMatch(
                rule_index=i,
                rule=rule,
                would_action=rule.get("then", "allow"),
                would_explanation=rule.get("explanation", ""),
                would_notify=rule.get("notify", []),
            ))
            logger.info(
                "Dry-run rule matched (index=%d): would %s — %s",
                i, rule.get("then", "allow"), rule.get("explanation", ""),
            )
        elif real_decision is None:
            # First non-dry-run match wins
            real_decision = PolicyDecision(
                action=rule.get("then", "allow"),
                explanation=rule.get("explanation", ""),
                matched_rule_index=i,
                notify=rule.get("notify", []),
            )

        # Optimisation: once we have a real decision we only need to keep
        # scanning for remaining dry-run rules.  If there are no more dry-run
        # rules ahead we could break, but for simplicity we scan all rules so
        # every dry-run match is captured.

    if real_decision is not None:
        real_decision.dry_run_matches = dry_run_matches
        return real_decision

    # No rule matched — default allow
    return PolicyDecision(
        action="allow",
        explanation="No policy rule matched. Content allowed.",
        dry_run_matches=dry_run_matches,
    )


def _matches(condition: dict, context: PolicyContext) -> bool:
    """Check if a rule condition matches the current context."""

    # entity_type: exact match against any detected entity type
    if "entity_type" in condition:
        required_type = condition["entity_type"]
        if required_type != "*" and required_type not in context.entity_types:
            return False

    # entity_type_in: match if ANY of the specified types are present
    if "entity_type_in" in condition:
        required_types = set(condition["entity_type_in"])
        if not required_types.intersection(context.entity_types):
            return False

    # context: match context category
    if "context" in condition:
        if condition["context"] != context.context_category:
            return False

    # ai_tool: match AI tool (if specified and not wildcard)
    if "ai_tool" in condition:
        if condition["ai_tool"] != "*" and condition["ai_tool"] != context.ai_tool:
            return False

    # user_role: match user role
    if "user_role" in condition:
        if condition["user_role"] != context.user_role:
            return False

    # user_team: match user team
    if "user_team" in condition:
        if condition["user_team"] != context.user_team:
            return False

    # entity_count_gte: volume threshold
    if "entity_count_gte" in condition:
        if context.entity_count < condition["entity_count_gte"]:
            return False

    # score_gte: minimum score threshold
    if "score_gte" in condition:
        if context.score < condition["score_gte"]:
            return False

    # level: match sensitivity level
    if "level" in condition:
        if condition["level"] != context.level:
            return False

    return True
