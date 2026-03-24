"""
Iron Gate Entity Ownership Classifier

Determines WHO each detected entity belongs to:
- self: the user's own data (their name, employer, email, address)
- third_party: someone else's data (client email, patient name)
- public: publicly known info being discussed/researched (CEO of Google)
- internal: organization's confidential data (deal codenames, revenue)
- unknown: can't determine ownership

This is the critical missing piece — without it, a resume gets all
company names pseudonymized even though they're the user's own employers.

The classifier examines a window of text around each entity and checks
for linguistic signals (possessive pronouns, labels, research framing)
before falling back to context-category defaults.
"""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Window size for context extraction around each entity
# ---------------------------------------------------------------------------
CONTEXT_WINDOW = 100


@dataclass
class EntityOwnership:
    entity_text: str
    entity_type: str
    start: int
    end: int
    ownership: str  # 'self' | 'third_party' | 'public' | 'internal' | 'unknown'
    confidence: float  # 0-1
    signal: str  # human-readable evidence description


# ---------------------------------------------------------------------------
# Signal patterns — compiled once at module load
# ---------------------------------------------------------------------------

# Self-referential: the entity belongs to the person writing the prompt
_SELF_PATTERNS: list[tuple[re.Pattern, float, str]] = [
    # "my name is X", "I am X", "I'm X"
    (re.compile(r"\bmy\s+name\s+is\b", re.I), 0.95, "possessive_my_name"),
    (re.compile(r"\b(?:I\s+am|I'm)\b", re.I), 0.80, "self_introduction"),
    # "my email/phone/address is"
    (re.compile(r"\bmy\s+(?:email|phone|address|number|cell|contact)\b", re.I), 0.90, "possessive_my_contact"),
    # "reach me at", "contact me at"
    (re.compile(r"\b(?:reach|contact)\s+me\s+at\b", re.I), 0.90, "reach_me_at"),
    # "I work at X", "I worked at X", "I joined X"
    (re.compile(r"\bI\s+(?:work|worked|joined|left|started|manage|managed)\s+(?:at|for)\b", re.I), 0.90, "self_employment"),
    # "my experience at X", "my time at X", "my role at X"
    (re.compile(r"\bmy\s+(?:experience|time|role|position|tenure|career|work)\s+(?:at|with)\b", re.I), 0.90, "possessive_experience"),
    # "I managed", "I led", "I built", "I developed" (resume language)
    (re.compile(r"\bI\s+(?:managed|led|built|developed|designed|created|oversaw|directed|launched|spearheaded|implemented|architected|established)\b", re.I), 0.75, "self_achievement"),
    # Resume job history: "ORG (2019-2023)" or "ORG (2021-Present)"
    (re.compile(r"\(\s*\d{4}\s*[-–—]\s*(?:\d{4}|[Pp]resent)\s*\)", re.I), 0.90, "job_date_range"),
    # "worked at", "employed at/by" (without explicit I, but near entity)
    (re.compile(r"\b(?:worked|employed)\s+(?:at|by)\b", re.I), 0.80, "employment_context"),
    # Resume section headers
    (re.compile(r"\b(?:experience|education|employment\s+history|work\s+history|professional\s+summary)\b", re.I), 0.70, "resume_section"),
]

# Third-party: the entity belongs to someone else
_THIRD_PARTY_PATTERNS: list[tuple[re.Pattern, float, str]] = [
    # "his/her/their email/phone/name"
    (re.compile(r"\b(?:his|her|their)\s+(?:email|phone|name|address|number|contact)\b", re.I), 0.90, "other_person_possessive"),
    # Explicit labels: "client contact:", "patient:", "customer:", "recipient:"
    (re.compile(r"\b(?:client\s+contact|patient|customer|recipient|vendor|contractor|applicant|candidate)\s*:", re.I), 0.95, "labeled_third_party"),
    # Forwarded/shared: "from:", "sent by:", "cc:", "forwarded from"
    (re.compile(r"\b(?:from|sent\s+by|cc|bcc|forwarded\s+from|forwarded\s+by)\s*:", re.I), 0.80, "forwarded_attribution"),
    # "[PERSON]'s email/phone is"
    (re.compile(r"'s\s+(?:email|phone|address|number|contact)\s+(?:is|was)\b", re.I), 0.85, "attributed_contact"),
    # "contact [PERSON] at"
    (re.compile(r"\bcontact\s+\w+\s+at\b", re.I), 0.80, "contact_person_at"),
    # "on behalf of"
    (re.compile(r"\bon\s+behalf\s+of\b", re.I), 0.75, "on_behalf_of"),
    # "belonging to", "associated with"
    (re.compile(r"\b(?:belonging|associated|assigned)\s+to\b", re.I), 0.70, "belonging_to"),
]

# Public: well-known entity being discussed/researched
_PUBLIC_PATTERNS: list[tuple[re.Pattern, float, str]] = [
    # Research: "tell me about X", "who is X", "what does X do"
    (re.compile(r"\b(?:tell\s+me\s+about|who\s+is|what\s+(?:does|is|are)|explain|describe|look\s+up|search\s+for|find\s+info\s+(?:on|about))\b", re.I), 0.85, "research_framing"),
    # Known titles: "CEO of X", "founder of X", "president of X"
    (re.compile(r"\b(?:CEO|CTO|CFO|COO|founder|co-founder|president|chairman|director|secretary|minister|governor|senator|mayor)\s+of\b", re.I), 0.90, "public_title"),
    # News/article: "according to", "reported by", "announced by"
    (re.compile(r"\b(?:according\s+to|reported\s+by|announced\s+by|published\s+by|stated\s+by)\b", re.I), 0.80, "news_attribution"),
    # Wikipedia-style: "X is an American", "X was born in"
    (re.compile(r"\b(?:is|was)\s+(?:an?\s+)?(?:American|British|Canadian|French|German|Indian|Chinese|Japanese|Australian)\b", re.I), 0.75, "biographical_context"),
    # Historical: "in the history of", "historically"
    (re.compile(r"\b(?:historically|in\s+(?:the\s+)?history\s+of|famous\s+for)\b", re.I), 0.70, "historical_context"),
]

# Internal: organization's confidential data
_INTERNAL_PATTERNS: list[tuple[re.Pattern, float, str]] = [
    # "our client", "our deal", "our contract", "our project"
    (re.compile(r"\bour\s+(?:client|deal|contract|project|account|partner|vendor|customer|team|company|firm)\b", re.I), 0.85, "organizational_possessive"),
    # Project/Operation codenames
    (re.compile(r"\b(?:Project|Operation|Initiative|Program|Codename)\s+[A-Z]\w*\b"), 0.80, "project_codename"),
    # Confidentiality markers
    (re.compile(r"\b(?:confidential|proprietary|internal\s+only|do\s+not\s+distribute|not\s+for\s+external|privileged|trade\s+secret)\b", re.I), 0.90, "confidentiality_marker"),
    # Deal value: "$X deal", "$X acquisition"
    (re.compile(r"\$[\d,]+(?:\.\d+)?[MBK]?\s+(?:deal|acquisition|contract|revenue|funding)\b", re.I), 0.80, "deal_value"),
]


# ---------------------------------------------------------------------------
# Context-category default mappings
# ---------------------------------------------------------------------------
_CONTEXT_DEFAULTS: dict[str, tuple[str, float]] = {
    # personal_task is the server-side equivalent of resume_review/personal_bio
    "personal_task": ("self", 0.50),
    "resume_review": ("self", 0.50),
    "personal_bio": ("self", 0.50),
    "contract_review": ("internal", 0.40),
    "customer_data": ("third_party", 0.50),
    "hr_matters": ("third_party", 0.50),
    "code_review": ("self", 0.40),
    "creative_writing": ("self", 0.40),
    "medical_health": ("third_party", 0.50),
    "legal_strategy": ("internal", 0.40),
    "financial_analysis": ("internal", 0.40),
    "competitive_intel": ("public", 0.40),
    "internal_comms": ("internal", 0.40),
    "general": ("unknown", 0.20),
}


# ---------------------------------------------------------------------------
# Special entity-type handling
# ---------------------------------------------------------------------------

def _classify_email_special(window_before: str) -> tuple[str, float, str] | None:
    """
    Emails have strong contextual signals from the text immediately before them.
    Returns (ownership, confidence, signal) or None if no special signal found.
    """
    lower = window_before.lower()
    if re.search(r"\bmy\s+(?:email|e-mail|address)\b", lower):
        return ("self", 0.95, "my_email_prefix")
    if re.search(r"\breach\s+me\s+at\b", lower):
        return ("self", 0.90, "reach_me_prefix")
    if re.search(r"\bcontact\s+me\s+at\b", lower):
        return ("self", 0.90, "contact_me_prefix")
    if re.search(r"\b(?:client\s+contact|patient|customer|recipient)\s*:", lower):
        return ("third_party", 0.95, "labeled_contact_email")
    if re.search(r"\b(?:his|her|their)\s+(?:email|e-mail|address)\b", lower):
        return ("third_party", 0.90, "other_person_email")
    return None


def _classify_phone_special(window_before: str) -> tuple[str, float, str] | None:
    """Phone numbers: check for possessive signals."""
    lower = window_before.lower()
    if re.search(r"\bmy\s+(?:phone|cell|number|mobile)\b", lower):
        return ("self", 0.95, "my_phone_prefix")
    if re.search(r"\b(?:his|her|their)\s+(?:phone|cell|number|mobile)\b", lower):
        return ("third_party", 0.90, "other_person_phone")
    if re.search(r"\b(?:client|patient|customer)\s*(?:'s)?\s+(?:phone|cell|number|mobile)\b", lower):
        return ("third_party", 0.90, "labeled_contact_phone")
    return None


# ---------------------------------------------------------------------------
# Resume-specific heuristic
# ---------------------------------------------------------------------------

def _is_resume_first_entity(
    entity: dict,
    entities: list[dict],
    text: str,
) -> bool:
    """
    In a resume context, the first PERSON entity (usually in the header)
    is almost always the resume owner.
    """
    if entity.get("type") != "PERSON":
        return False

    # Check if this is the first PERSON entity
    person_entities = [e for e in entities if e.get("type") == "PERSON"]
    if not person_entities:
        return False

    first_person = min(person_entities, key=lambda e: e.get("start", 0))
    if entity.get("start") != first_person.get("start"):
        return False

    # The first PERSON in the first ~300 chars is likely the resume owner
    return entity.get("start", 0) < 300


# ---------------------------------------------------------------------------
# Main classification function
# ---------------------------------------------------------------------------

def classify_entity_ownership(
    text: str,
    entities: list[dict],
    context_category: str,
) -> list[EntityOwnership]:
    """
    Classify ownership of each entity based on surrounding text context.

    Args:
        text: The full prompt/document text.
        entities: List of detected entities, each with keys:
            type, text, start, end, confidence, source.
        context_category: The prompt's context category (e.g. 'personal_task',
            'contract_review', 'customer_data', 'hr_matters', etc.)

    Returns:
        List of EntityOwnership objects, one per input entity.
    """
    results: list[EntityOwnership] = []
    text_len = len(text)
    is_resume_context = context_category in ("personal_task", "resume_review", "personal_bio")

    for entity in entities:
        entity_text = entity.get("text", "")
        entity_type = entity.get("type", "")
        start = entity.get("start", 0)
        end = entity.get("end", 0)

        # Extract context window around the entity
        window_start = max(0, start - CONTEXT_WINDOW)
        window_end = min(text_len, end + CONTEXT_WINDOW)
        window_before = text[window_start:start]
        window_after = text[end:window_end]
        full_window = text[window_start:window_end]

        # ------------------------------------------------------------------
        # Step 1: Special entity-type handling (EMAIL, PHONE)
        # ------------------------------------------------------------------
        special_result = None
        if entity_type == "EMAIL":
            special_result = _classify_email_special(window_before)
        elif entity_type in ("PHONE_NUMBER", "PHONE"):
            special_result = _classify_phone_special(window_before)

        if special_result:
            ownership, confidence, signal = special_result
            results.append(EntityOwnership(
                entity_text=entity_text,
                entity_type=entity_type,
                start=start,
                end=end,
                ownership=ownership,
                confidence=confidence,
                signal=signal,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 2: Resume first-entity heuristic
        # ------------------------------------------------------------------
        if is_resume_context and _is_resume_first_entity(entity, entities, text):
            results.append(EntityOwnership(
                entity_text=entity_text,
                entity_type=entity_type,
                start=start,
                end=end,
                ownership="self",
                confidence=0.90,
                signal="resume_header_person",
            ))
            continue

        # ------------------------------------------------------------------
        # Step 3: Check signal patterns — proximity-weighted scoring
        #
        # When multiple signals match within the context window, we
        # combine base confidence with a proximity bonus so that a
        # pattern matched right next to the entity beats one matched
        # at the edge of the window (e.g. "(2018-2021)" next to an ORG
        # should beat a distant "client contact:" label).
        # ------------------------------------------------------------------
        best_ownership: str | None = None
        best_score = 0.0
        best_confidence = 0.0
        best_signal = ""

        # entity_offset_in_window is where the entity text starts inside full_window
        entity_offset_in_window = start - window_start
        window_len = len(full_window)

        for patterns, ownership_type in [
            (_SELF_PATTERNS, "self"),
            (_THIRD_PARTY_PATTERNS, "third_party"),
            (_PUBLIC_PATTERNS, "public"),
            (_INTERNAL_PATTERNS, "internal"),
        ]:
            for pattern, confidence, signal_name in patterns:
                m = pattern.search(full_window)
                if m:
                    # Proximity bonus: how close is the match to the entity?
                    # Distance is measured from the match midpoint to the entity start.
                    match_mid = (m.start() + m.end()) / 2
                    distance = abs(match_mid - entity_offset_in_window)
                    # Normalize distance to 0-1 range (0 = right next to entity)
                    proximity = 1.0 - (distance / max(window_len, 1))
                    # Score = base confidence + proximity bonus (up to 0.15)
                    score = confidence + proximity * 0.15
                    if score > best_score:
                        best_ownership = ownership_type
                        best_score = score
                        best_confidence = confidence
                        best_signal = signal_name

        if best_ownership is not None:
            results.append(EntityOwnership(
                entity_text=entity_text,
                entity_type=entity_type,
                start=start,
                end=end,
                ownership=best_ownership,
                confidence=best_confidence,
                signal=best_signal,
            ))
            continue

        # ------------------------------------------------------------------
        # Step 4: Context-based default
        # ------------------------------------------------------------------
        default_ownership, default_confidence = _CONTEXT_DEFAULTS.get(
            context_category, ("unknown", 0.20)
        )

        results.append(EntityOwnership(
            entity_text=entity_text,
            entity_type=entity_type,
            start=start,
            end=end,
            ownership=default_ownership,
            confidence=default_confidence,
            signal=f"context_default_{context_category}",
        ))

    return results
