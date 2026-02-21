"""
Server-side Sensitivity Scoring Algorithm.
Mirrors the edge scorer but with access to full Presidio results.
"""

from typing import Optional

ENTITY_WEIGHTS = {
    "PERSON": 10,
    "ORGANIZATION": 8,
    "LOCATION": 3,
    "DATE": 2,
    "PHONE_NUMBER": 15,
    "EMAIL": 12,
    "CREDIT_CARD": 30,
    "SSN": 40,
    "MONETARY_AMOUNT": 12,
    "ACCOUNT_NUMBER": 25,
    "IP_ADDRESS": 8,
    "MEDICAL_RECORD": 35,
    "PASSPORT_NUMBER": 35,
    "DRIVERS_LICENSE": 30,
    "MATTER_NUMBER": 20,
    "CLIENT_MATTER_PAIR": 25,
    "PRIVILEGE_MARKER": 30,
    "DEAL_CODENAME": 20,
    "OPPOSING_COUNSEL": 15,
    # Credential entity types
    "API_KEY": 50,
    "DATABASE_URI": 50,
    "AUTH_TOKEN": 45,
    "PRIVATE_KEY": 50,
    "AWS_CREDENTIAL": 50,
    "GCP_CREDENTIAL": 45,
    "AZURE_CREDENTIAL": 45,
    # Domain-specific entity types
    "FINANCIAL_INSTRUMENT": 30,
    "TRADE_SECRET": 50,
    "LITIGATION_STRATEGY": 45,
    "PROPRIETARY_FORMULA": 50,
    "MNPI": 50,
    "CLINICAL_DATA": 40,
}

LEGAL_KEYWORDS = [
    "privileged", "attorney-client", "work product", "without prejudice",
    "confidential", "under seal", "protective order", "settlement",
    "mediation", "arbitration", "deposition", "subpoena",
    "motion to compel", "discovery", "litigation hold",
]

PRIVILEGE_MARKERS = [
    "attorney-client privilege", "work product doctrine",
    "privileged and confidential", "attorney work product",
    "protected communication", "legal professional privilege",
]


def compute_sensitivity_score(
    text: str,
    entities: list[dict],
    firm_id: Optional[str] = None,
) -> tuple[int, str, str]:
    """
    Compute sensitivity score.
    Returns (score: 0-100, level, explanation).
    """
    # 1. Entity score
    entity_score = 0
    for entity in entities:
        weight = ENTITY_WEIGHTS.get(entity.get("type", ""), 5)
        confidence = entity.get("confidence", 0.5)
        entity_score += weight * confidence

    # Entity combination bonus
    unique_types = set(e.get("type") for e in entities)
    if len(unique_types) >= 3:
        entity_score *= 1.3
    elif len(unique_types) >= 2:
        entity_score *= 1.15

    # Count bonus
    if len(entities) >= 10:
        entity_score *= 1.4
    elif len(entities) >= 5:
        entity_score *= 1.2

    entity_score = min(70, entity_score)

    # 2. Volume score
    text_len = len(text)
    if text_len >= 5000:
        volume_score = 20
    elif text_len >= 2000:
        volume_score = 10
    elif text_len >= 500:
        volume_score = 5
    else:
        volume_score = 0

    # 3. Context score (legal keywords near entities)
    context_score = 0
    lower_text = text.lower()
    for entity in entities:
        start = max(0, entity.get("start", 0) - 200)
        end = min(len(text), entity.get("end", 0) + 200)
        surrounding = lower_text[start:end]
        for keyword in LEGAL_KEYWORDS:
            if keyword in surrounding:
                context_score += 5
                break
    context_score = min(25, context_score)

    # 4. Legal boost
    legal_boost = 0
    for marker in PRIVILEGE_MARKERS:
        if marker in lower_text:
            legal_boost += 15
    legal_boost = min(25, legal_boost)

    # Combine
    raw_score = entity_score + volume_score + context_score + legal_boost
    score = min(100, max(0, round(raw_score)))

    # Level
    if score <= 25:
        level = "low"
    elif score <= 60:
        level = "medium"
    elif score <= 85:
        level = "high"
    else:
        level = "critical"

    # Explanation
    explanation = _generate_explanation(score, level, entities, text)

    return score, level, explanation


def _generate_explanation(
    score: int, level: str, entities: list[dict], text: str
) -> str:
    if not entities:
        if len(text) > 5000:
            return "Large text volume detected but no specific entities identified."
        return "No sensitive information detected."

    type_counts: dict[str, int] = {}
    for e in entities:
        t = e.get("type", "UNKNOWN")
        type_counts[t] = type_counts.get(t, 0) + 1

    parts = []
    descriptions = [
        f"{count} {etype.lower().replace('_', ' ')}{'s' if count > 1 else ''}"
        for etype, count in sorted(type_counts.items(), key=lambda x: -x[1])[:3]
    ]
    parts.append(f"Detected {', '.join(descriptions)}")

    lower_text = text.lower()
    if any(m in lower_text for m in PRIVILEGE_MARKERS):
        parts.append("Contains privilege markers")

    if len(text) > 2000:
        parts.append("Large text volume suggests pasted document")

    return ". ".join(parts) + "."
