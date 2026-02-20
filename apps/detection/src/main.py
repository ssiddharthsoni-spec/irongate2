"""
Iron Gate Detection Service
FastAPI server providing PII detection via REST and gRPC.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import time
import uuid

from .pipeline import DetectionPipeline
from .pseudonymizer import Pseudonymizer

app = FastAPI(
    title="Iron Gate Detection Service",
    description="Server-side PII and sensitive information detection",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the detection pipeline
pipeline = DetectionPipeline()

# Session-scoped pseudonymizer cache. Maps session_id -> Pseudonymizer.
# Expired sessions are lazily cleaned up when new sessions are created.
_pseudonymizer_sessions: dict[str, Pseudonymizer] = {}


class DetectionRequest(BaseModel):
    text: str
    entity_types: Optional[list[str]] = None
    firm_id: Optional[str] = None
    language: str = "en"
    score_threshold: float = 0.3


class Entity(BaseModel):
    type: str
    text: str
    start: int
    end: int
    confidence: float
    source: str


class DetectionResponse(BaseModel):
    entities: list[Entity]
    processing_time_ms: float
    engines_used: list[str]


class ScoreRequest(BaseModel):
    text: str
    entities: Optional[list[Entity]] = None
    firm_id: Optional[str] = None


class ScoreResponse(BaseModel):
    score: int
    level: str
    explanation: str
    entity_count: int
    processing_time_ms: float


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/v1/detect", response_model=DetectionResponse)
async def detect_entities(request: DetectionRequest):
    """Detect PII and sensitive entities in text."""
    start_time = time.time()

    try:
        entities = pipeline.detect(
            text=request.text,
            entity_types=request.entity_types,
            language=request.language,
            score_threshold=request.score_threshold,
        )

        processing_time = (time.time() - start_time) * 1000

        return DetectionResponse(
            entities=[
                Entity(
                    type=e["type"],
                    text=e["text"],
                    start=e["start"],
                    end=e["end"],
                    confidence=e["confidence"],
                    source=e["source"],
                )
                for e in entities
            ],
            processing_time_ms=round(processing_time, 2),
            engines_used=pipeline.get_active_engines(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/v1/score", response_model=ScoreResponse)
async def score_text(request: ScoreRequest):
    """Score the sensitivity of text content."""
    start_time = time.time()

    try:
        # Detect entities if not provided
        if request.entities:
            entities = [e.model_dump() for e in request.entities]
        else:
            entities = pipeline.detect(text=request.text)

        score, level, explanation = pipeline.score(
            text=request.text,
            entities=entities,
            firm_id=request.firm_id,
        )

        processing_time = (time.time() - start_time) * 1000

        return ScoreResponse(
            score=score,
            level=level,
            explanation=explanation,
            entity_count=len(entities),
            processing_time_ms=round(processing_time, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# POST /v1/pseudonymize — Combined detection + pseudonymization + scoring
# ---------------------------------------------------------------------------


class PseudonymizeRequest(BaseModel):
    text: str
    firm_id: Optional[str] = None
    session_id: Optional[str] = None


class PseudonymizeResponse(BaseModel):
    original_text: str
    masked_text: str
    entities: list[Entity]
    pseudonym_map: dict[str, str]
    score: int
    level: str
    processing_time_ms: float


def _get_or_create_pseudonymizer(session_id: str, firm_id: str) -> Pseudonymizer:
    """
    Retrieve an existing Pseudonymizer for a session, or create a new one.
    Lazily purges expired sessions to prevent memory leaks.
    """
    # Lazy cleanup: remove expired sessions when the cache grows
    if len(_pseudonymizer_sessions) > 100:
        expired_keys = [
            k for k, v in _pseudonymizer_sessions.items() if v.is_expired
        ]
        for k in expired_keys:
            del _pseudonymizer_sessions[k]

    existing = _pseudonymizer_sessions.get(session_id)
    if existing is not None and not existing.is_expired:
        return existing

    pseudonymizer = Pseudonymizer(session_id=session_id, firm_id=firm_id)
    _pseudonymizer_sessions[session_id] = pseudonymizer
    return pseudonymizer


@app.post("/v1/pseudonymize", response_model=PseudonymizeResponse)
async def pseudonymize_text(request: PseudonymizeRequest):
    """
    Detect entities, pseudonymize the text, and score sensitivity — all in
    one call. This is the primary endpoint used by the proxy pipeline for
    Phase 2 masked routing.

    An optional ``session_id`` can be provided to maintain consistent
    pseudonym mappings across multiple calls within the same conversation.
    If omitted, a new session is created for each request.
    """
    start_time = time.time()

    try:
        # 1. Detect entities
        entities = pipeline.detect(text=request.text)

        # 2. Get or create a session-scoped pseudonymizer
        session_id = request.session_id or str(uuid.uuid4())
        firm_id = request.firm_id or ""
        pseudonymizer = _get_or_create_pseudonymizer(session_id, firm_id)

        # 3. Pseudonymize
        masked_text, pseudonym_map, _ = pseudonymizer.pseudonymize(
            text=request.text,
            entities=entities,
        )

        # 4. Score sensitivity
        score, level, _ = pipeline.score(
            text=request.text,
            entities=entities,
            firm_id=request.firm_id,
        )

        processing_time = (time.time() - start_time) * 1000

        return PseudonymizeResponse(
            original_text=request.text,
            masked_text=masked_text,
            entities=[
                Entity(
                    type=e["type"],
                    text=e["text"],
                    start=e["start"],
                    end=e["end"],
                    confidence=e["confidence"],
                    source=e["source"],
                )
                for e in entities
            ],
            pseudonym_map=pseudonym_map,
            score=score,
            level=level,
            processing_time_ms=round(processing_time, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
