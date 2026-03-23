"""
Iron Gate Audit Logger — Zero-Persistence Event Logging

Records anonymized metadata about every interception.
NEVER logs raw prompt text. NEVER stores detected entity values.

What IS logged:
- org_id, user_id_hash (SHA-256), ai_tool
- entity_types (["PERSON", "ORG"] — types only, not values)
- entity_count, context_category, policy_decision
- score, level, processing_time_ms

What is NEVER logged:
- Raw prompt text
- Entity values (no "John Smith", no "Proseware Solutions")
- Pseudonym mappings
- Response content

A SOC 2 auditor can verify: the audit_log table has no column
capable of storing raw content.
"""

import hashlib
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# In-memory buffer for batch writes (reduces DB round-trips)
_buffer: list[dict] = []
_MAX_BUFFER = 50


def _hash_user_id(user_id: str) -> str:
    """SHA-256 hash of user ID for anonymization."""
    return hashlib.sha256(user_id.encode("utf-8")).hexdigest()


async def log_event(
    org_id: str,
    user_id: str,
    ai_tool: str,
    entity_types: list[str],
    entity_count: int,
    context_category: str,
    policy_decision: str,
    score: int = 0,
    level: str = "low",
    processing_time_ms: float = 0.0,
):
    """
    Log an interception event to the audit log.

    user_id is hashed before storage — the raw user ID is never persisted.
    """
    event = {
        "id": str(uuid.uuid4()),
        "org_id": org_id,
        "user_id_hash": _hash_user_id(user_id),
        "ai_tool": ai_tool,
        "entity_types": list(set(entity_types)),  # Deduplicate
        "entity_count": entity_count,
        "context_category": context_category,
        "policy_decision": policy_decision,
        "score": score,
        "level": level,
        "processing_time_ms": round(processing_time_ms, 2),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    _buffer.append(event)

    # Flush buffer when it reaches the threshold
    if len(_buffer) >= _MAX_BUFFER:
        await flush_buffer()


async def flush_buffer():
    """Write buffered events to the database."""
    global _buffer
    if not _buffer:
        return

    events_to_write = _buffer[:]
    _buffer = []

    try:
        from .db import get_db, AuditLog

        async with get_db() as session:
            for event in events_to_write:
                log_entry = AuditLog(
                    id=event["id"],
                    org_id=event["org_id"],
                    user_id_hash=event["user_id_hash"],
                    ai_tool=event["ai_tool"],
                    entity_types=event["entity_types"],
                    entity_count=event["entity_count"],
                    context_category=event["context_category"],
                    policy_decision=event["policy_decision"],
                    score=event["score"],
                    level=event["level"],
                    processing_time_ms=event["processing_time_ms"],
                )
                session.add(log_entry)

        logger.debug(f"Flushed {len(events_to_write)} audit events to database")
    except Exception as e:
        logger.error(f"Failed to flush audit buffer: {e}")
        # Re-add failed events to buffer (with cap to prevent unbounded growth)
        _buffer = (events_to_write + _buffer)[:500]


async def get_stats(
    org_id: str,
    days: int = 7,
) -> dict:
    """
    Get aggregated stats for the CISO dashboard.

    Returns counts and breakdowns for the specified time period.
    """
    from datetime import timedelta
    from sqlalchemy import select, func, text

    try:
        from .db import get_db, AuditLog

        since = datetime.now(timezone.utc) - timedelta(days=days)

        async with get_db() as session:
            # Total prompts
            total_result = await session.execute(
                select(func.count(AuditLog.id))
                .where(AuditLog.org_id == org_id)
                .where(AuditLog.created_at >= since)
            )
            total_prompts = total_result.scalar() or 0

            # Prompts with entities (sensitive)
            sensitive_result = await session.execute(
                select(func.count(AuditLog.id))
                .where(AuditLog.org_id == org_id)
                .where(AuditLog.created_at >= since)
                .where(AuditLog.entity_count > 0)
            )
            sensitive_prompts = sensitive_result.scalar() or 0

            # Policy decision breakdown
            decision_result = await session.execute(
                select(AuditLog.policy_decision, func.count(AuditLog.id))
                .where(AuditLog.org_id == org_id)
                .where(AuditLog.created_at >= since)
                .group_by(AuditLog.policy_decision)
            )
            decisions = {row[0]: row[1] for row in decision_result.all()}

            # AI tool breakdown
            tool_result = await session.execute(
                select(AuditLog.ai_tool, func.count(AuditLog.id))
                .where(AuditLog.org_id == org_id)
                .where(AuditLog.created_at >= since)
                .group_by(AuditLog.ai_tool)
            )
            tools = {row[0]: row[1] for row in tool_result.all()}

            return {
                "period_days": days,
                "total_prompts": total_prompts,
                "sensitive_prompts": sensitive_prompts,
                "sensitive_percentage": round(
                    (sensitive_prompts / total_prompts * 100) if total_prompts > 0 else 0, 1
                ),
                "policy_decisions": decisions,
                "ai_tools": tools,
            }
    except Exception as e:
        logger.error(f"Failed to get stats: {e}")
        return {
            "period_days": days,
            "total_prompts": 0,
            "sensitive_prompts": 0,
            "sensitive_percentage": 0,
            "policy_decisions": {},
            "ai_tools": {},
        }


# ---------------------------------------------------------------------------
# Compliance framework → required entity type mapping
# ---------------------------------------------------------------------------

FRAMEWORK_REQUIRED_ENTITIES: dict[str, list[str]] = {
    "hipaa": [
        "MEDICAL_RECORD", "PERSON", "EMAIL", "PHONE_NUMBER",
        "SSN", "ACCOUNT_NUMBER",
    ],
    "gdpr": [
        "PERSON", "EMAIL", "PHONE_NUMBER", "ORGANIZATION",
        "CREDIT_CARD", "SSN", "PASSPORT_NUMBER",
    ],
    "pci_dss": [
        "CREDIT_CARD", "ACCOUNT_NUMBER", "PERSON",
    ],
    "soc2": [
        "API_KEY", "DATABASE_URI", "PRIVATE_KEY", "AWS_CREDENTIAL",
        "GCP_CREDENTIAL", "AUTH_TOKEN",
    ],
}


async def get_compliance_report(
    org_id: str,
    start_date: str,
    end_date: str,
    framework: Optional[str] = None,
) -> dict:
    """
    Generate a compliance report for the given org and date range.

    Parameters
    ----------
    org_id : str
        Organization identifier.
    start_date : str
        ISO-8601 start date (inclusive).
    end_date : str
        ISO-8601 end date (inclusive — the entire end date is included).
    framework : str | None
        Optional compliance framework filter (hipaa, gdpr, pci_dss, soc2).

    Returns
    -------
    dict
        Compliance report with entity counts, decision breakdown,
        violations (with anonymized user IDs), active policy rules,
        dry-run simulation summary, and framework coverage.
    """
    from sqlalchemy import select, func

    try:
        from .db import get_db, AuditLog, Policy

        # Parse date range — end_date is inclusive of the full day
        dt_start = datetime.fromisoformat(start_date).replace(tzinfo=timezone.utc)
        dt_end = datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
        # Include the entire end date
        if dt_end.hour == 0 and dt_end.minute == 0 and dt_end.second == 0:
            dt_end = dt_end + timedelta(days=1)

        async with get_db() as session:
            # ----- Base filter -----
            base_filter = [
                AuditLog.org_id == org_id,
                AuditLog.created_at >= dt_start,
                AuditLog.created_at < dt_end,
            ]

            # 1. Total prompts
            total_result = await session.execute(
                select(func.count(AuditLog.id)).where(*base_filter)
            )
            total_prompts = total_result.scalar() or 0

            # 2. Entity type breakdown
            #    entity_types is a JSONB array column — we unnest it to count
            #    individual types.
            from sqlalchemy import text as sa_text

            entity_counts_result = await session.execute(
                sa_text("""
                    SELECT entity_type, COUNT(*) as cnt
                    FROM ig_audit_log,
                         jsonb_array_elements_text(entity_types) AS entity_type
                    WHERE org_id = :org_id
                      AND created_at >= :dt_start
                      AND created_at < :dt_end
                    GROUP BY entity_type
                    ORDER BY cnt DESC
                """),
                {"org_id": org_id, "dt_start": dt_start, "dt_end": dt_end},
            )
            entity_counts: dict[str, int] = {
                row[0]: row[1] for row in entity_counts_result.all()
            }

            # 3. Policy decision breakdown
            decision_result = await session.execute(
                select(AuditLog.policy_decision, func.count(AuditLog.id))
                .where(*base_filter)
                .group_by(AuditLog.policy_decision)
            )
            decision_breakdown: dict[str, int] = {
                row[0]: row[1] for row in decision_result.all()
            }

            # 4. Violations — block decisions with anonymized user IDs
            violations_result = await session.execute(
                select(
                    AuditLog.user_id_hash,
                    AuditLog.ai_tool,
                    AuditLog.entity_types,
                    AuditLog.score,
                    AuditLog.context_category,
                    AuditLog.created_at,
                )
                .where(*base_filter)
                .where(AuditLog.policy_decision == "block")
                .order_by(AuditLog.created_at.desc())
                .limit(500)
            )
            violations = [
                {
                    "user_id_hash": row[0],
                    "ai_tool": row[1],
                    "entity_types": row[2],
                    "score": row[3],
                    "context_category": row[4],
                    "timestamp": row[5].isoformat() if row[5] else None,
                }
                for row in violations_result.all()
            ]

            # 5. Active policy rules during the period
            policy_result = await session.execute(
                select(Policy)
                .where(Policy.org_id == org_id)
                .where(Policy.is_active == True)
            )
            policy = policy_result.scalars().first()

            active_rules: list[dict] = []
            compliance_templates: list[str] = []
            dry_run_rules: list[dict] = []

            if policy:
                compliance_templates = policy.compliance_templates or []
                for i, rule in enumerate(policy.rules or []):
                    rule_summary = {
                        "index": i,
                        "condition": rule.get("if", {}),
                        "action": rule.get("then", "allow"),
                        "explanation": rule.get("explanation", ""),
                        "dry_run": bool(rule.get("dry_run", False)),
                    }
                    if rule_summary["dry_run"]:
                        dry_run_rules.append(rule_summary)
                    else:
                        active_rules.append(rule_summary)

            # 6. Dry-run simulation results summary
            #    Dry-run events are logged with policy_decision prefixed
            #    'dry_run:' by the caller. We also surface the rules themselves.
            dry_run_summary = {
                "dry_run_rules_count": len(dry_run_rules),
                "dry_run_rules": dry_run_rules,
            }

            # 7. Compliance framework coverage
            framework_coverage: Optional[dict] = None
            if framework and framework in FRAMEWORK_REQUIRED_ENTITIES:
                required = FRAMEWORK_REQUIRED_ENTITIES[framework]
                detected = set(entity_counts.keys())
                covered = [et for et in required if et in detected]
                missing = [et for et in required if et not in detected]
                framework_coverage = {
                    "framework": framework,
                    "required_entity_types": required,
                    "detected_entity_types": covered,
                    "missing_entity_types": missing,
                    "coverage_percentage": round(
                        len(covered) / len(required) * 100 if required else 0, 1
                    ),
                }

            return {
                "org_id": org_id,
                "period": {
                    "start": dt_start.isoformat(),
                    "end": dt_end.isoformat(),
                },
                "total_prompts": total_prompts,
                "entity_counts_by_type": entity_counts,
                "policy_decision_breakdown": decision_breakdown,
                "violations": violations,
                "violation_count": len(violations),
                "active_policy_rules": active_rules,
                "compliance_templates": compliance_templates,
                "dry_run_summary": dry_run_summary,
                "framework_coverage": framework_coverage,
            }

    except Exception as e:
        logger.error(f"Failed to generate compliance report: {e}", exc_info=True)
        return {
            "org_id": org_id,
            "period": {"start": start_date, "end": end_date},
            "total_prompts": 0,
            "entity_counts_by_type": {},
            "policy_decision_breakdown": {},
            "violations": [],
            "violation_count": 0,
            "active_policy_rules": [],
            "compliance_templates": [],
            "dry_run_summary": {"dry_run_rules_count": 0, "dry_run_rules": []},
            "framework_coverage": None,
            "error": str(e),
        }
