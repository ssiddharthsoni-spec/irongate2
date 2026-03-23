"""
Iron Gate Entity Dictionary — Org-Specific Entity Lookup

Runs BEFORE ML NER in the pipeline. Admin-configured entities get
100% accuracy, sub-millisecond lookup. This is the compounding moat:
every week of use adds more entries, making detection more accurate
and the product harder to replace.

Architecture:
- On startup (or org config change), load all active entries for the org
  into an in-memory lookup table.
- On each detection request, scan text for exact matches (case-insensitive).
- Dictionary matches are highest priority — they override ML classifications.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class DictionaryMatch:
    """A match from the entity dictionary."""
    text: str
    start: int
    end: int
    entity_type: str
    confidence: float = 1.0  # Dictionary matches are always 100%
    source: str = "dictionary"
    entry_id: Optional[str] = None


@dataclass
class DictionaryEntry:
    """An entry in the entity dictionary."""
    id: str
    value: str
    value_lower: str
    entity_type: str
    aliases: list[str] = field(default_factory=list)


class EntityDictionary:
    """
    In-memory entity dictionary for fast lookup.

    Entries are loaded from the database on init and refreshed periodically.
    Uses case-insensitive substring matching with word boundary awareness.
    """

    def __init__(self):
        # org_id -> list of entries
        self._entries: dict[str, list[DictionaryEntry]] = {}
        # org_id -> list of (lowercase_term, entry) for fast scanning
        self._lookup_terms: dict[str, list[tuple[str, DictionaryEntry]]] = {}
        self._last_refresh: dict[str, float] = {}
        self._refresh_interval = 300  # 5 minutes

    def load_entries(self, org_id: str, entries: list[dict]):
        """
        Load dictionary entries for an org from database rows.

        Each entry dict should have: id, value, value_lower, entity_type, aliases
        """
        parsed: list[DictionaryEntry] = []
        for e in entries:
            parsed.append(DictionaryEntry(
                id=e["id"],
                value=e["value"],
                value_lower=e.get("value_lower", e["value"].lower()),
                entity_type=e["entity_type"],
                aliases=e.get("aliases", []),
            ))
        self._entries[org_id] = parsed

        # Build lookup terms (value + all aliases)
        terms: list[tuple[str, DictionaryEntry]] = []
        for entry in parsed:
            terms.append((entry.value_lower, entry))
            for alias in entry.aliases:
                if alias:
                    terms.append((alias.lower(), entry))

        # Sort by length descending — match longest terms first
        terms.sort(key=lambda t: len(t[0]), reverse=True)
        self._lookup_terms[org_id] = terms
        self._last_refresh[org_id] = time.time()

        logger.info(f"Loaded {len(parsed)} dictionary entries ({len(terms)} terms) for org {org_id}")

    def needs_refresh(self, org_id: str) -> bool:
        """Check if the dictionary for this org needs refreshing."""
        last = self._last_refresh.get(org_id, 0)
        return (time.time() - last) > self._refresh_interval

    def search(self, text: str, org_id: str) -> list[DictionaryMatch]:
        """
        Scan text for all dictionary matches.

        Returns matches sorted by position. Handles overlapping matches
        by preferring longer matches (which are checked first).
        """
        terms = self._lookup_terms.get(org_id, [])
        if not terms:
            return []

        text_lower = text.lower()
        matches: list[DictionaryMatch] = []
        # Track covered character positions to avoid overlapping matches
        covered: set[int] = set()

        for term, entry in terms:
            start = 0
            while True:
                pos = text_lower.find(term, start)
                if pos == -1:
                    break

                end = pos + len(term)

                # Skip if any character in this range is already covered
                if any(i in covered for i in range(pos, end)):
                    start = pos + 1
                    continue

                # Word boundary check — the match shouldn't be in the middle of a word
                if pos > 0 and text_lower[pos - 1].isalnum():
                    start = pos + 1
                    continue
                if end < len(text_lower) and text_lower[end].isalnum():
                    start = pos + 1
                    continue

                # Valid match
                matches.append(DictionaryMatch(
                    text=text[pos:end],  # Use original case from text
                    start=pos,
                    end=end,
                    entity_type=entry.entity_type,
                    entry_id=entry.id,
                ))

                # Mark positions as covered
                covered.update(range(pos, end))
                start = end

        # Sort by position
        matches.sort(key=lambda m: m.start)
        return matches

    def get_entry_count(self, org_id: str) -> int:
        """Return the number of dictionary entries for an org."""
        return len(self._entries.get(org_id, []))


# Global singleton
entity_dictionary = EntityDictionary()
