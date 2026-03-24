"""
Iron Gate Detection Service — v2

FastAPI server providing the Intelligence Layer:
- POST /v1/detect — entity detection (dictionary + Presidio/spaCy + GLiNER + secrets)
- POST /v1/score — sensitivity scoring
- POST /v1/pseudonymize — combined detect + pseudonymize + score (primary endpoint)
- POST /v1/policy/evaluate — evaluate org policy rules against detection results
- GET  /v1/org/{org_id}/stats — aggregated stats for CISO dashboard
- GET  /v1/org/{org_id}/compliance-report — compliance report generation
- CRUD /v1/entity-dictionary — org-specific entity management

Zero-persistence architecture:
- Raw text is processed in request-scoped memory and NEVER touches the database
- Only anonymized metadata (entity types, counts, decisions) is logged
- The PseudonymizeResponse includes original_text for the caller, but the API
  never stores it — it's returned in the HTTP response and discarded
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import time
import uuid
import logging

from .pipeline import DetectionPipeline
from .pseudonymizer import Pseudonymizer
from .context_classifier import classify_context
from .policy_engine import evaluate_policy, evaluate_entity_policy, PolicyContext, DEFAULT_RULES
from .entity_ownership import classify_entity_ownership
from .entity_dictionary import entity_dictionary
from .audit import log_event, flush_buffer, get_compliance_report

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize DB and load entity dictionaries on startup."""
    # Startup
    try:
        from .db import create_tables, DATABASE_URL
        if DATABASE_URL:
            await create_tables()
            logger.info("Database tables initialized")
        else:
            logger.warning("No DATABASE_URL — running without persistence")
    except Exception as e:
        logger.warning(f"Database initialization skipped: {e}")

    yield

    # Shutdown — flush any remaining audit events
    await flush_buffer()


app = FastAPI(
    title="Iron Gate Detection Service",
    description="Server-side PII detection, classification, and policy engine",
    version="2.0.0",
    lifespan=lifespan,
)

_allowed_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://irongate-api.onrender.com,http://localhost:3000,chrome-extension://*",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins if o.strip()],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Org-Id", "X-User-Id", "X-AI-Tool"],
)

# Initialize the detection pipeline
pipeline = DetectionPipeline()

# Session-scoped pseudonymizer cache
_pseudonymizer_sessions: dict[str, Pseudonymizer] = {}


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class Entity(BaseModel):
    type: str
    text: str
    start: int
    end: int
    confidence: float
    source: str


class DetectionRequest(BaseModel):
    text: str
    org_id: Optional[str] = None
    entity_types: Optional[list[str]] = None
    language: str = "en"
    score_threshold: float = 0.3


class DetectionResponse(BaseModel):
    entities: list[Entity]
    context_category: str
    context_confidence: float
    processing_time_ms: float
    engines_used: list[str]


class ScoreRequest(BaseModel):
    text: str
    entities: Optional[list[Entity]] = None
    org_id: Optional[str] = None


class ScoreResponse(BaseModel):
    score: int
    level: str
    explanation: str
    entity_count: int
    processing_time_ms: float


class PseudonymizeRequest(BaseModel):
    text: str
    org_id: Optional[str] = None
    session_id: Optional[str] = None
    ai_tool: str = "unknown"
    user_id: Optional[str] = None


class EntityDecision(BaseModel):
    entity_text: str
    entity_type: str
    ownership: str
    decision: str
    explanation: str


class PseudonymizeResponse(BaseModel):
    masked_text: str
    entities: list[Entity]
    pseudonym_map: dict[str, str]
    reverse_map: dict[str, str]
    score: int
    level: str
    context_category: str
    policy_decision: str
    policy_explanation: str
    processing_time_ms: float
    session_id: str
    dry_run_matches: list[DryRunMatchResponse] = []
    entity_decisions: list[EntityDecision] = []


class PolicyEvaluateRequest(BaseModel):
    entity_types: list[str]
    entity_count: int
    context_category: str = "general"
    ai_tool: str = "unknown"
    user_role: Optional[str] = None
    user_team: Optional[str] = None
    score: int = 0
    level: str = "low"
    org_id: Optional[str] = None


class DryRunMatchResponse(BaseModel):
    rule_index: int
    would_action: str
    would_explanation: str
    would_notify: list[str] = []


class PolicyEvaluateResponse(BaseModel):
    action: str
    explanation: str
    matched_rule_index: Optional[int] = None
    notify: list[str] = []
    dry_run_matches: list[DryRunMatchResponse] = []


class EntityDictEntryRequest(BaseModel):
    value: str
    entity_type: str
    aliases: list[str] = []
    metadata: dict = {}


class EntityDictEntryResponse(BaseModel):
    id: str
    value: str
    entity_type: str
    aliases: list[str]
    source: str
    created_at: str


class StatsResponse(BaseModel):
    period_days: int
    total_prompts: int
    sensitive_prompts: int
    sensitive_percentage: float
    policy_decisions: dict[str, int]
    ai_tools: dict[str, int]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_or_create_pseudonymizer(session_id: str, firm_id: str) -> Pseudonymizer:
    """Retrieve or create a session-scoped pseudonymizer."""
    if len(_pseudonymizer_sessions) > 200:
        expired = [k for k, v in _pseudonymizer_sessions.items() if v.is_expired]
        for k in expired:
            del _pseudonymizer_sessions[k]

    existing = _pseudonymizer_sessions.get(session_id)
    if existing is not None and not existing.is_expired:
        return existing

    pseudonymizer = Pseudonymizer(session_id=session_id, firm_id=firm_id)
    _pseudonymizer_sessions[session_id] = pseudonymizer
    return pseudonymizer


async def _load_org_dictionary(org_id: str):
    """Load entity dictionary for an org from the database."""
    if not org_id or not entity_dictionary.needs_refresh(org_id):
        return
    try:
        from .db import get_db, EntityDictionaryEntry
        from sqlalchemy import select

        async with get_db() as session:
            result = await session.execute(
                select(EntityDictionaryEntry)
                .where(EntityDictionaryEntry.org_id == org_id)
                .where(EntityDictionaryEntry.is_active == True)
            )
            rows = result.scalars().all()
            entries = [
                {
                    "id": row.id,
                    "value": row.value,
                    "value_lower": row.value_lower,
                    "entity_type": row.entity_type,
                    "aliases": row.aliases or [],
                }
                for row in rows
            ]
            entity_dictionary.load_entries(org_id, entries)
    except Exception as e:
        logger.warning(f"Could not load entity dictionary for {org_id}: {e}")


async def _load_org_policy(org_id: str) -> tuple[list[dict], list[str]]:
    """Load policy rules for an org from the database."""
    if not org_id:
        return DEFAULT_RULES, []
    try:
        from .db import get_db, Policy
        from sqlalchemy import select

        async with get_db() as session:
            result = await session.execute(
                select(Policy)
                .where(Policy.org_id == org_id)
                .where(Policy.is_active == True)
            )
            policy = result.scalars().first()
            if policy:
                return policy.rules or DEFAULT_RULES, policy.compliance_templates or []
    except Exception as e:
        logger.warning(f"Could not load policy for {org_id}: {e}")

    return DEFAULT_RULES, []


def _build_entity_explanation(
    entity_text: str,
    entity_type: str,
    ownership: str,
    decision: str,
    context_category: str,
) -> str:
    """Build a human-readable explanation for a per-entity policy decision."""
    ownership_labels = {
        "self": "your data",
        "third_party": "third-party",
        "public": "public information",
        "internal": "org-internal",
        "unknown": "unclassified",
    }
    ownership_label = ownership_labels.get(ownership, ownership)

    context_labels = {
        "personal_task": "resume context",
        "resume_review": "resume context",
        "contract_review": "contract context",
        "hr_matters": "HR context",
        "medical_health": "medical context",
        "code_review": "code review context",
        "customer_data": "customer data context",
        "financial_analysis": "financial context",
        "internal_comms": "internal comms context",
        "legal_strategy": "legal context",
        "competitive_intel": "competitive intel context",
        "creative_writing": "creative writing context",
    }
    context_label = context_labels.get(context_category, context_category)

    if decision == "allow":
        return f"{entity_text} \u2192 allowed ({ownership_label}, {context_label})"
    elif decision == "pseudonymize":
        return f"{entity_text} \u2192 pseudonymized ({ownership_label} {entity_type.lower()})"
    elif decision == "redact":
        return f"{entity_text} \u2192 redacted ({ownership_label} {entity_type.lower()}, {context_label})"
    return f"{entity_text} \u2192 {decision} ({ownership_label})"


async def _check_kill_switch(org_id: str) -> bool:
    """Check if the kill switch is active for this org."""
    if not org_id:
        return False
    try:
        from .db import get_db, Organization
        from sqlalchemy import select

        async with get_db() as session:
            result = await session.execute(
                select(Organization.kill_switch_enabled)
                .where(Organization.id == org_id)
            )
            enabled = result.scalar()
            return bool(enabled)
    except Exception as e:
        logger.warning(f"Kill switch check failed for {org_id}: {e}")
        return False  # Fail open if we can't check


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    engines = pipeline.get_active_engines()
    return {
        "status": "ok",
        "version": "2.0.0",
        "engines": engines,
        "engine_count": len(engines),
    }


@app.post("/v1/detect", response_model=DetectionResponse)
async def detect_entities(request: DetectionRequest):
    """
    Detect PII and sensitive entities in text.

    Pipeline order:
    1. Entity dictionary lookup (100% accuracy, sub-ms)
    2. Presidio + spaCy NER
    3. GLiNER transformer NER
    4. Custom legal recognizers
    5. Secret scanner
    6. Merge + boost
    7. Context classification
    """
    start_time = time.time()

    try:
        # Load entity dictionary if available
        if request.org_id:
            await _load_org_dictionary(request.org_id)

        # Run entity dictionary first
        dict_entities = []
        if request.org_id:
            dict_matches = entity_dictionary.search(request.text, request.org_id)
            for m in dict_matches:
                dict_entities.append({
                    "type": m.entity_type,
                    "text": m.text,
                    "start": m.start,
                    "end": m.end,
                    "confidence": m.confidence,
                    "source": m.source,
                })

        # Run ML pipeline
        ml_entities = pipeline.detect(
            text=request.text,
            entity_types=request.entity_types,
            language=request.language,
            score_threshold=request.score_threshold,
        )

        # Merge: dictionary matches override ML classifications at same position
        merged = _merge_dict_and_ml(dict_entities, ml_entities)

        # Classify context
        context = classify_context(request.text)

        processing_time = (time.time() - start_time) * 1000

        return DetectionResponse(
            entities=[
                Entity(
                    type=e["type"], text=e["text"], start=e["start"],
                    end=e["end"], confidence=e["confidence"], source=e["source"],
                )
                for e in merged
            ],
            context_category=context.category,
            context_confidence=context.confidence,
            processing_time_ms=round(processing_time, 2),
            engines_used=pipeline.get_active_engines() + (["dictionary"] if dict_entities else []),
        )
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/score", response_model=ScoreResponse)
async def score_text(request: ScoreRequest):
    """Score the sensitivity of text content."""
    start_time = time.time()

    try:
        if request.entities:
            entities = [e.model_dump() for e in request.entities]
        else:
            entities = pipeline.detect(text=request.text)

        score, level, explanation = pipeline.score(
            text=request.text, entities=entities, firm_id=request.org_id,
        )

        processing_time = (time.time() - start_time) * 1000

        return ScoreResponse(
            score=score, level=level, explanation=explanation,
            entity_count=len(entities),
            processing_time_ms=round(processing_time, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/pseudonymize", response_model=PseudonymizeResponse)
async def pseudonymize_text(request: PseudonymizeRequest):
    """
    THE PRIMARY ENDPOINT.

    Combined pipeline: detect → dictionary lookup → classify context →
    evaluate policy → pseudonymize → score → audit log.

    Returns everything the extension needs in one call.
    """
    start_time = time.time()

    try:
        org_id = request.org_id or ""
        session_id = request.session_id or str(uuid.uuid4())

        # 0. Kill switch check
        if org_id:
            kill_switch = await _check_kill_switch(org_id)
            if kill_switch:
                raise HTTPException(
                    status_code=403,
                    detail="AI tools are currently restricted by your IT policy. Contact your administrator.",
                )

        # 1. Load entity dictionary
        if org_id:
            await _load_org_dictionary(org_id)

        # 2. Dictionary lookup (100% accuracy, sub-ms)
        dict_entities = []
        if org_id:
            dict_matches = entity_dictionary.search(request.text, org_id)
            for m in dict_matches:
                dict_entities.append({
                    "type": m.entity_type, "text": m.text,
                    "start": m.start, "end": m.end,
                    "confidence": m.confidence, "source": m.source,
                })

        # 3. ML pipeline (Presidio + spaCy + GLiNER + secrets)
        ml_entities = pipeline.detect(text=request.text)

        # 4. Merge (dictionary wins on overlap)
        merged = _merge_dict_and_ml(dict_entities, ml_entities)

        # 5. Context classification
        context = classify_context(request.text)

        # 6. Score sensitivity
        score, level, explanation = pipeline.score(
            text=request.text, entities=merged, firm_id=org_id,
        )

        # 7. Policy evaluation
        rules, compliance_templates = await _load_org_policy(org_id)
        entity_types = list(set(e["type"] for e in merged))
        policy_ctx = PolicyContext(
            entity_types=entity_types,
            entity_count=len(merged),
            context_category=context.category,
            ai_tool=request.ai_tool,
            score=score,
            level=level,
        )
        policy_decision = evaluate_policy(rules, policy_ctx, compliance_templates)

        # 7b. Per-entity ownership classification + policy decisions
        entity_decision_list: list[EntityDecision] = []
        skip_entities: set[str] = set()

        if merged:
            ownership_results = classify_entity_ownership(
                text=request.text,
                entities=merged,
                context_category=context.category,
            )

            # Build a lookup from entity text to ownership
            ownership_by_text: dict[str, str] = {}
            for ow in ownership_results:
                ownership_by_text[ow.entity_text] = ow.ownership

            for entity in merged:
                entity_text = entity["text"]
                entity_type = entity["type"]
                ownership = ownership_by_text.get(entity_text, "unknown")

                # Evaluate per-entity policy
                entity_action = evaluate_entity_policy(
                    entity=entity,
                    ownership=ownership,
                    context_category=context.category,
                    rules=None,  # Use built-in defaults; custom rules come from org policy
                )

                # Build human-readable explanation
                explanation = _build_entity_explanation(
                    entity_text, entity_type, ownership, entity_action, context.category,
                )

                entity_decision_list.append(EntityDecision(
                    entity_text=entity_text,
                    entity_type=entity_type,
                    ownership=ownership,
                    decision=entity_action,
                    explanation=explanation,
                ))

                # Track entities that should be skipped (allowed)
                if entity_action == "allow":
                    skip_entities.add(entity_text)

        # 8. Pseudonymize (if policy says pseudonymize or allow)
        pseudonymizer = _get_or_create_pseudonymizer(session_id, org_id)
        if policy_decision.action in ("pseudonymize", "allow") and merged:
            masked_text, pseudonym_map, _ = pseudonymizer.pseudonymize(
                text=request.text, entities=merged,
                skip_entities=skip_entities if skip_entities else None,
            )
        elif policy_decision.action == "block":
            # Block — don't pseudonymize, return empty
            masked_text = ""
            pseudonym_map = {}
        else:
            masked_text = request.text
            pseudonym_map = {}

        # Build reverse map (pseudonym → original) for de-pseudonymization
        reverse_map = {v: k for k, v in pseudonym_map.items()}

        processing_time = (time.time() - start_time) * 1000

        # 9. Audit log (async, non-blocking, zero-persistence)
        if org_id and request.user_id:
            await log_event(
                org_id=org_id,
                user_id=request.user_id,
                ai_tool=request.ai_tool,
                entity_types=entity_types,
                entity_count=len(merged),
                context_category=context.category,
                policy_decision=policy_decision.action,
                score=score,
                level=level,
                processing_time_ms=processing_time,
            )

        # 10. Log dry-run matches for simulation visibility
        dry_run_response = [
            DryRunMatchResponse(
                rule_index=m.rule_index,
                would_action=m.would_action,
                would_explanation=m.would_explanation,
                would_notify=m.would_notify,
            )
            for m in policy_decision.dry_run_matches
        ]

        # Log dry-run match events to audit for dashboard visibility
        if org_id and request.user_id and policy_decision.dry_run_matches:
            for m in policy_decision.dry_run_matches:
                await log_event(
                    org_id=org_id,
                    user_id=request.user_id,
                    ai_tool=request.ai_tool,
                    entity_types=entity_types,
                    entity_count=len(merged),
                    context_category=context.category,
                    policy_decision=f"dry_run:{m.would_action}",
                    score=score,
                    level=level,
                    processing_time_ms=processing_time,
                )

        return PseudonymizeResponse(
            masked_text=masked_text,
            entities=[
                Entity(
                    type=e["type"], text=e["text"], start=e["start"],
                    end=e["end"], confidence=e["confidence"], source=e["source"],
                )
                for e in merged
            ],
            pseudonym_map=pseudonym_map,
            reverse_map=reverse_map,
            score=score,
            level=level,
            context_category=context.category,
            policy_decision=policy_decision.action,
            policy_explanation=policy_decision.explanation,
            processing_time_ms=round(processing_time, 2),
            session_id=session_id,
            dry_run_matches=dry_run_response,
            entity_decisions=entity_decision_list,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Pseudonymize error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/policy/evaluate", response_model=PolicyEvaluateResponse)
async def evaluate_policy_endpoint(request: PolicyEvaluateRequest):
    """Evaluate org policy rules against detection context."""
    try:
        rules, compliance_templates = await _load_org_policy(request.org_id)
        ctx = PolicyContext(
            entity_types=request.entity_types,
            entity_count=request.entity_count,
            context_category=request.context_category,
            ai_tool=request.ai_tool,
            user_role=request.user_role,
            user_team=request.user_team,
            score=request.score,
            level=request.level,
        )
        decision = evaluate_policy(rules, ctx, compliance_templates)

        return PolicyEvaluateResponse(
            action=decision.action,
            explanation=decision.explanation,
            matched_rule_index=decision.matched_rule_index,
            notify=decision.notify,
            dry_run_matches=[
                DryRunMatchResponse(
                    rule_index=m.rule_index,
                    would_action=m.would_action,
                    would_explanation=m.would_explanation,
                    would_notify=m.would_notify,
                )
                for m in decision.dry_run_matches
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Entity Dictionary CRUD
# ---------------------------------------------------------------------------

@app.get("/v1/entity-dictionary")
async def list_entity_dictionary(
    org_id: str = Header(..., alias="X-Org-Id"),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
):
    """List entity dictionary entries for an org."""
    try:
        from .db import get_db, EntityDictionaryEntry
        from sqlalchemy import select, func

        async with get_db() as session:
            query = (
                select(EntityDictionaryEntry)
                .where(EntityDictionaryEntry.org_id == org_id)
                .where(EntityDictionaryEntry.is_active == True)
            )
            if entity_type:
                query = query.where(EntityDictionaryEntry.entity_type == entity_type)

            # Count total
            count_query = (
                select(func.count(EntityDictionaryEntry.id))
                .where(EntityDictionaryEntry.org_id == org_id)
                .where(EntityDictionaryEntry.is_active == True)
            )
            if entity_type:
                count_query = count_query.where(EntityDictionaryEntry.entity_type == entity_type)
            total = (await session.execute(count_query)).scalar() or 0

            # Fetch page
            query = query.order_by(EntityDictionaryEntry.created_at.desc())
            query = query.offset(offset).limit(limit)
            result = await session.execute(query)
            rows = result.scalars().all()

            return {
                "total": total,
                "entries": [
                    {
                        "id": row.id,
                        "value": row.value,
                        "entity_type": row.entity_type,
                        "aliases": row.aliases or [],
                        "source": row.source,
                        "added_by": row.added_by,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                    for row in rows
                ],
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/entity-dictionary", status_code=201)
async def add_entity_dictionary_entry(
    entry: EntityDictEntryRequest,
    org_id: str = Header(..., alias="X-Org-Id"),
    user_id: Optional[str] = Header(None, alias="X-User-Id"),
):
    """Add a new entity to the org dictionary."""
    try:
        from .db import get_db, EntityDictionaryEntry

        entry_id = str(uuid.uuid4())
        async with get_db() as session:
            db_entry = EntityDictionaryEntry(
                id=entry_id,
                org_id=org_id,
                value=entry.value,
                value_lower=entry.value.lower(),
                entity_type=entry.entity_type,
                aliases=entry.aliases,
                metadata_=entry.metadata,
                added_by=user_id,
                source="admin",
            )
            session.add(db_entry)

        # Refresh in-memory dictionary
        entity_dictionary._last_refresh.pop(org_id, None)

        return {"id": entry_id, "value": entry.value, "entity_type": entry.entity_type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/entity-dictionary/bulk", status_code=201)
async def bulk_import_entity_dictionary(
    entries: list[EntityDictEntryRequest],
    org_id: str = Header(..., alias="X-Org-Id"),
    user_id: Optional[str] = Header(None, alias="X-User-Id"),
):
    """Bulk import entity dictionary entries (up to 10,000)."""
    if len(entries) > 10000:
        raise HTTPException(status_code=400, detail="Maximum 10,000 entries per bulk import")

    try:
        from .db import get_db, EntityDictionaryEntry

        created = 0
        async with get_db() as session:
            for entry in entries:
                db_entry = EntityDictionaryEntry(
                    id=str(uuid.uuid4()),
                    org_id=org_id,
                    value=entry.value,
                    value_lower=entry.value.lower(),
                    entity_type=entry.entity_type,
                    aliases=entry.aliases,
                    metadata_=entry.metadata,
                    added_by=user_id,
                    source="import",
                )
                session.add(db_entry)
                created += 1

        entity_dictionary._last_refresh.pop(org_id, None)
        return {"created": created}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/v1/entity-dictionary/{entry_id}")
async def delete_entity_dictionary_entry(
    entry_id: str,
    org_id: str = Header(..., alias="X-Org-Id"),
):
    """Soft-delete an entity dictionary entry."""
    try:
        from .db import get_db, EntityDictionaryEntry
        from sqlalchemy import select

        async with get_db() as session:
            result = await session.execute(
                select(EntityDictionaryEntry)
                .where(EntityDictionaryEntry.id == entry_id)
                .where(EntityDictionaryEntry.org_id == org_id)
            )
            entry = result.scalars().first()
            if not entry:
                raise HTTPException(status_code=404, detail="Entry not found")
            entry.is_active = False

        entity_dictionary._last_refresh.pop(org_id, None)
        return {"deleted": entry_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Dashboard Stats
# ---------------------------------------------------------------------------

@app.get("/v1/org/{org_id}/stats", response_model=StatsResponse)
async def get_org_stats(org_id: str, days: int = Query(7, le=90)):
    """Get aggregated stats for the CISO dashboard."""
    from .audit import get_stats
    stats = await get_stats(org_id, days)
    return StatsResponse(**stats)


# ---------------------------------------------------------------------------
# Compliance Report
# ---------------------------------------------------------------------------

@app.get("/v1/org/{org_id}/compliance-report")
async def compliance_report_endpoint(
    org_id: str,
    start_date: str = Query(..., description="ISO-8601 start date (inclusive)"),
    end_date: str = Query(..., description="ISO-8601 end date (inclusive)"),
    framework: Optional[str] = Query(
        None,
        description="Compliance framework filter: hipaa, gdpr, pci_dss, soc2",
    ),
):
    """
    Generate a compliance report for the specified org and date range.

    Returns entity detection counts by category, policy decision breakdown,
    violations with anonymized user IDs, active policy rules, dry-run
    simulation summary, and compliance framework coverage.

    Output is JSON — PDF/CSV formatting is a frontend concern.
    """
    valid_frameworks = {"hipaa", "gdpr", "pci_dss", "soc2"}
    if framework and framework not in valid_frameworks:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid framework '{framework}'. Must be one of: {', '.join(sorted(valid_frameworks))}",
        )

    try:
        report = await get_compliance_report(
            org_id=org_id,
            start_date=start_date,
            end_date=end_date,
            framework=framework,
        )
        return report
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Compliance report error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# De-pseudonymize (for response processing)
# ---------------------------------------------------------------------------

class DepseudonymizeRequest(BaseModel):
    text: str
    session_id: str


class DepseudonymizeResponse(BaseModel):
    text: str


@app.post("/v1/depseudonymize", response_model=DepseudonymizeResponse)
async def depseudonymize_text(request: DepseudonymizeRequest):
    """Reverse pseudonyms in AI response text."""
    pseudonymizer = _pseudonymizer_sessions.get(request.session_id)
    if pseudonymizer is None:
        raise HTTPException(status_code=404, detail="Session not found or expired")
    if pseudonymizer.is_expired:
        del _pseudonymizer_sessions[request.session_id]
        raise HTTPException(status_code=410, detail="Session expired")

    result = pseudonymizer.depseudonymize(request.text)
    return DepseudonymizeResponse(text=result)


# ---------------------------------------------------------------------------
# Entity merge helper
# ---------------------------------------------------------------------------

def _merge_dict_and_ml(dict_entities: list[dict], ml_entities: list[dict]) -> list[dict]:
    """
    Merge dictionary matches with ML detections.
    Dictionary matches take priority on overlap (100% accuracy > ML guess).
    """
    if not dict_entities:
        return ml_entities
    if not ml_entities:
        return dict_entities

    # Build set of covered ranges from dictionary matches
    covered_ranges: list[tuple[int, int]] = [(e["start"], e["end"]) for e in dict_entities]

    # Add ML entities that don't overlap with dictionary matches
    merged = list(dict_entities)
    for ml_entity in ml_entities:
        ml_start, ml_end = ml_entity["start"], ml_entity["end"]
        overlaps = any(
            ml_start < dr_end and ml_end > dr_start
            for dr_start, dr_end in covered_ranges
        )
        if not overlaps:
            merged.append(ml_entity)

    # Sort by position
    merged.sort(key=lambda e: e["start"])
    return merged


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
