"""
Iron Gate Detection Service — Database Layer

Five core tables with zero-persistence architecture:
- organizations: multi-tenant config
- users: SSO-only auth
- policies: JSONB rule engine
- entity_dictionary: org-specific entity knowledge graph
- audit_log: anonymized event log (NO raw text columns)

Uses asyncpg via SQLAlchemy async for non-blocking DB access.
"""

import os
import logging
from datetime import datetime, timezone
from typing import Optional
from contextlib import asynccontextmanager

from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text, Float,
    ForeignKey, Index, UniqueConstraint, Enum as SAEnum,
    create_engine, text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.ext.asyncio import (
    AsyncSession, create_async_engine, async_sessionmaker,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Engine setup
# ---------------------------------------------------------------------------

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Convert postgres:// to postgresql+asyncpg:// for async driver
_async_url = DATABASE_URL
if _async_url.startswith("postgres://"):
    _async_url = _async_url.replace("postgres://", "postgresql+asyncpg://", 1)
elif _async_url.startswith("postgresql://"):
    _async_url = _async_url.replace("postgresql://", "postgresql+asyncpg://", 1)

_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None and _async_url:
        _engine = create_async_engine(
            _async_url,
            pool_size=10,
            max_overflow=5,
            pool_recycle=300,
            echo=False,
        )
    return _engine


def get_session_factory():
    global _session_factory
    if _session_factory is None:
        engine = get_engine()
        if engine:
            _session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return _session_factory


@asynccontextmanager
async def get_db():
    """Async context manager for database sessions."""
    factory = get_session_factory()
    if factory is None:
        raise RuntimeError("Database not configured — set DATABASE_URL")
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class Organization(Base):
    """Multi-tenant organization."""
    __tablename__ = "ig_organizations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sso_config: Mapped[Optional[dict]] = mapped_column(JSONB, default=None)
    kill_switch_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    settings: Mapped[Optional[dict]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class User(Base):
    """SSO-only user. No passwords stored."""
    __tablename__ = "ig_users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), ForeignKey("ig_organizations.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    team: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    role: Mapped[str] = mapped_column(String(64), default="member")
    sso_subject: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_ig_users_org_id", "org_id"),
        Index("ix_ig_users_email", "email"),
    )


class Policy(Base):
    """
    JSONB-driven policy rules.

    rules format:
    [
        {
            "if": {"entity_type": "CREDIT_CARD", "ai_tool": "*"},
            "then": "block",
            "explanation": "Credit card data cannot be sent to AI tools.",
            "notify": ["security_team"]
        },
        ...
    ]
    First-match evaluation order.
    """
    __tablename__ = "ig_policies"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), ForeignKey("ig_organizations.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), default="default")
    rules: Mapped[list] = mapped_column(JSONB, default=list)
    compliance_templates: Mapped[list] = mapped_column(JSONB, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        Index("ix_ig_policies_org_id", "org_id"),
    )


class EntityDictionaryEntry(Base):
    """
    Org-specific entity knowledge graph.

    Admin-configured: "Proseware Solutions" → ORG, "Project Falcon" → SENSITIVE_PROJECT.
    Exact-match lookup runs BEFORE ML NER for 100% accuracy on known entities.
    """
    __tablename__ = "ig_entity_dictionary"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), ForeignKey("ig_organizations.id"), nullable=False)
    value: Mapped[str] = mapped_column(String(512), nullable=False)
    value_lower: Mapped[str] = mapped_column(String(512), nullable=False)  # for case-insensitive lookup
    entity_type: Mapped[str] = mapped_column(String(64), nullable=False)
    aliases: Mapped[Optional[list]] = mapped_column(JSONB, default=list)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSONB, default=dict)
    added_by: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    source: Mapped[str] = mapped_column(String(64), default="admin")  # admin, auto_review, import
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        UniqueConstraint("org_id", "value_lower", "entity_type", name="uq_entity_dict_org_value_type"),
        Index("ix_ig_entity_dict_org_id", "org_id"),
        Index("ix_ig_entity_dict_value_lower", "value_lower"),
    )


class AuditLog(Base):
    """
    Zero-persistence audit log.

    CRITICAL: There is NO prompt_text column. There is NO raw_entities column.
    Only anonymized metadata about what happened.
    A SOC 2 auditor can verify that raw prompt storage is architecturally impossible.
    """
    __tablename__ = "ig_audit_log"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id_hash: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256 of user ID
    ai_tool: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_types: Mapped[list] = mapped_column(JSONB, default=list)  # ["PERSON", "ORG"] — types only
    entity_count: Mapped[int] = mapped_column(Integer, default=0)
    context_category: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    policy_decision: Mapped[str] = mapped_column(String(32), nullable=False)  # allow, pseudonymize, warn, block
    score: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[str] = mapped_column(String(16), default="low")
    processing_time_ms: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_ig_audit_org_id", "org_id"),
        Index("ix_ig_audit_created_at", "created_at"),
        Index("ix_ig_audit_org_created", "org_id", "created_at"),
    )


# ---------------------------------------------------------------------------
# Schema creation
# ---------------------------------------------------------------------------

async def create_tables():
    """Create all tables if they don't exist."""
    engine = get_engine()
    if engine is None:
        logger.warning("No database configured — skipping table creation")
        return
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created/verified")
