"""
Iron Gate Phase 2 — Server-side Pseudonymization Engine

Mirrors the TypeScript Pseudonymizer (apps/api/src/proxy/pseudonymizer.ts)
for use within the Python detection service. Uses Faker for generating
realistic replacement values, with session-scoped consistency so the same
original value always maps to the same pseudonym within a session.
"""

import hashlib
import time
from typing import Optional

try:
    from faker import Faker
except ImportError:
    Faker = None  # type: ignore[assignment, misc]

# ---------------------------------------------------------------------------
# Static pools (used when Faker is unavailable as a fallback, and also
# seeded from to stay consistent with the TypeScript version)
# ---------------------------------------------------------------------------

FAKE_PERSONS = [
    "James Mitchell", "Sarah Chen", "Robert Alvarez", "Emily Nakamura",
    "David Kowalski", "Maria Rossi", "Michael Okonkwo", "Lisa Johansson",
    "Thomas Brennan", "Amanda Singh", "William Park", "Rachel Moreau",
    "Christopher Tanaka", "Jennifer O'Brien", "Daniel Ivanov", "Laura Schmidt",
    "Andrew Petrov", "Stephanie Kim", "Matthew Dubois", "Nicole Andersen",
    "Brian Herrera", "Karen Yamamoto", "Patrick Sullivan", "Megan Becker",
    "Jonathan Larsen", "Allison Fernandez", "Steven Ito", "Rebecca Malone",
    "Gregory Novak", "Catherine Lindqvist",
]

FAKE_ORGANIZATIONS = [
    "Meridian Holdings", "Atlas Group", "Pinnacle Advisors", "Summit Capital",
    "Horizon Legal Partners", "Apex Dynamics", "Cornerstone Ventures",
    "Landmark Financial", "Silver Creek Industries", "Ironwood Consulting",
    "Blue Harbor Technologies", "Granite Peak Solutions", "Compass Rose Partners",
    "Keystone Analytics", "Northstar Global", "Pacific Ridge Corp",
    "Sterling Bridge LLC", "Westfield Associates", "Crescent Bay Holdings",
    "Redwood Capital Group",
]

FAKE_LOCATIONS = [
    "742 Evergreen Terrace, Springfield, IL 62704",
    "1234 Maple Drive, Suite 300, Portland, OR 97201",
    "567 Oak Boulevard, Austin, TX 78701",
    "890 Pine Street, Denver, CO 80202",
    "2345 Elm Avenue, Boston, MA 02108",
    "678 Cedar Lane, Seattle, WA 98101",
    "1011 Birch Road, Nashville, TN 37201",
    "1213 Walnut Court, Miami, FL 33101",
    "1415 Spruce Way, Chicago, IL 60601",
    "1617 Aspen Circle, San Francisco, CA 94102",
    "1819 Willow Path, Phoenix, AZ 85001",
    "2021 Chestnut Drive, Philadelphia, PA 19101",
    "2223 Poplar Street, Atlanta, GA 30301",
    "2425 Magnolia Blvd, Dallas, TX 75201",
    "2627 Cypress Lane, Minneapolis, MN 55401",
]

FAKE_DEAL_CODENAMES = [
    "Project Falcon", "Project Orion", "Project Nexus", "Project Horizon",
    "Project Zenith", "Project Apex", "Project Titan", "Project Nova",
    "Project Eclipse", "Project Vanguard", "Project Aurora", "Project Summit",
    "Project Atlas", "Project Pinnacle", "Project Compass",
]

SESSION_EXPIRY_SECONDS = 3600  # 1 hour


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sha256(value: str) -> str:
    """Return the hex SHA-256 digest of a string."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _pick_from_pool(pool: list[str], hex_hash: str) -> str:
    """Deterministically pick an item from a pool using the first 8 hex chars."""
    seed = int(hex_hash[:8], 16)
    return pool[seed % len(pool)]


def _deterministic_random(hex_hash: str) -> float:
    """Return a deterministic float in [0, 1) from a different hash slice."""
    seed = int(hex_hash[8:16], 16)
    return seed / 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Faker-backed generators
# ---------------------------------------------------------------------------

def _make_faker(hex_hash: str) -> "Faker":
    """Create a Faker instance seeded from the hash for reproducibility."""
    seed = int(hex_hash[:12], 16)
    fake = Faker()
    Faker.seed(seed)
    fake.seed_instance(seed)
    return fake


def _generate_person(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.name()
    return _pick_from_pool(FAKE_PERSONS, hex_hash)


def _generate_organization(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.company()
    return _pick_from_pool(FAKE_ORGANIZATIONS, hex_hash)


def _generate_email(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.email()
    person = _pick_from_pool(FAKE_PERSONS, hex_hash)
    parts = person.replace("'", "").lower().split()
    domains = ["example.com", "example.org", "test.example.net", "mail.example.com"]
    domain = _pick_from_pool(domains, hex_hash[4:])
    return f"{parts[0]}.{parts[1]}@{domain}"


def _generate_phone(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.phone_number()
    area = (int(hex_hash[:3], 16) % 800) + 200
    mid = (int(hex_hash[3:6], 16) % 900) + 100
    last = (int(hex_hash[6:10], 16) % 9000) + 1000
    return f"({area}) {mid}-{last}"


def _generate_ssn(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.ssn()
    a = (int(hex_hash[:3], 16) % 899) + 100
    b = (int(hex_hash[3:5], 16) % 90) + 10
    c = (int(hex_hash[5:9], 16) % 9000) + 1000
    return f"{a}-{b}-{c}"


def _generate_credit_card(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.credit_card_number()
    card = "4"
    for i in range(1, 16):
        idx = i % len(hex_hash)
        card += str(int(hex_hash[idx : idx + 2], 16) % 10)
    return f"{card[:4]}-{card[4:8]}-{card[8:12]}-{card[12:16]}"


def _generate_monetary_amount(original: str, hex_hash: str) -> str:
    import re

    numeric_str = re.sub(r"[^0-9.]", "", original)
    try:
        value = float(numeric_str)
    except (ValueError, TypeError):
        value = 0.0

    if value == 0:
        return "$1,234.56"

    rnd = _deterministic_random(hex_hash)
    jitter = 0.8 + rnd * 0.4
    new_value = value * jitter

    # Detect currency prefix
    match = re.match(r"^[^\d]*", original)
    prefix = match.group(0).strip() if match else "$"
    if not prefix:
        prefix = "$"

    formatted = f"{new_value:,.2f}"
    return f"{prefix}{formatted}"


def _generate_location(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.address().replace("\n", ", ")
    return _pick_from_pool(FAKE_LOCATIONS, hex_hash)


def _generate_date(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.date()
    seed = int(hex_hash[:8], 16)
    year = 2020 + (seed % 5)
    month = (seed % 12) + 1
    day = (seed % 28) + 1
    return f"{year}-{month:02d}-{day:02d}"


def _generate_matter_number(hex_hash: str) -> str:
    prefix = (int(hex_hash[:4], 16) % 9000) + 1000
    suffix = (int(hex_hash[4:8], 16) % 900) + 100
    return f"M-{prefix}-{suffix}"


def _generate_client_matter_pair(hex_hash: str) -> str:
    client = _generate_organization(hex_hash)
    matter = _generate_matter_number(hex_hash[8:])
    return f"{client} / {matter}"


def _generate_deal_codename(hex_hash: str) -> str:
    return _pick_from_pool(FAKE_DEAL_CODENAMES, hex_hash)


def _generate_account_number(hex_hash: str) -> str:
    acct = ""
    for i in range(10):
        acct += str(int(hex_hash[i : i + 2], 16) % 10)
    return acct


def _generate_ip_address(hex_hash: str) -> str:
    if Faker is not None:
        fake = _make_faker(hex_hash)
        return fake.ipv4_private()
    last_octet = (int(hex_hash[:4], 16) % 254) + 1
    return f"192.0.2.{last_octet}"


def _generate_medical_record(hex_hash: str) -> str:
    num = (int(hex_hash[:8], 16) % 9000000) + 1000000
    return f"MRN-{num}"


def _generate_passport_number(hex_hash: str) -> str:
    letter = chr(ord("A") + (int(hex_hash[:2], 16) % 26))
    digits = (int(hex_hash[2:10], 16) % 90000000) + 10000000
    return f"{letter}{digits}"


def _generate_drivers_license(hex_hash: str) -> str:
    letter = chr(ord("A") + (int(hex_hash[:2], 16) % 26))
    digits = (int(hex_hash[2:10], 16) % 900000000) + 100000000
    return f"{letter}{digits}"


def _generate_opposing_counsel(hex_hash: str) -> str:
    person = _generate_person(hex_hash)
    firms = [
        "Baker & Associates", "Thompson LLP", "Crane Legal Group",
        "Marshall & Briggs", "Ashford Law Offices", "Davenport Partners",
        "Sterling & Young", "Whitmore Coleman LLP",
    ]
    firm = _pick_from_pool(firms, hex_hash[8:])
    return f"{person}, {firm}"


def _generate_privilege_marker(hex_hash: str) -> str:
    markers = [
        "PRIVILEGED AND CONFIDENTIAL",
        "ATTORNEY-CLIENT PRIVILEGE",
        "ATTORNEY WORK PRODUCT",
        "PROTECTED COMMUNICATION",
        "LEGAL PROFESSIONAL PRIVILEGE",
    ]
    return _pick_from_pool(markers, hex_hash)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def generate_pseudonym(entity_type: str, original: str, hex_hash: str) -> str:
    """Generate a pseudonym for a given entity type using a deterministic hash."""
    generators = {
        "PERSON": lambda: _generate_person(hex_hash),
        "ORGANIZATION": lambda: _generate_organization(hex_hash),
        "EMAIL": lambda: _generate_email(hex_hash),
        "PHONE_NUMBER": lambda: _generate_phone(hex_hash),
        "SSN": lambda: _generate_ssn(hex_hash),
        "CREDIT_CARD": lambda: _generate_credit_card(hex_hash),
        "MONETARY_AMOUNT": lambda: _generate_monetary_amount(original, hex_hash),
        "LOCATION": lambda: _generate_location(hex_hash),
        "DATE": lambda: _generate_date(hex_hash),
        "MATTER_NUMBER": lambda: _generate_matter_number(hex_hash),
        "CLIENT_MATTER_PAIR": lambda: _generate_client_matter_pair(hex_hash),
        "DEAL_CODENAME": lambda: _generate_deal_codename(hex_hash),
        "ACCOUNT_NUMBER": lambda: _generate_account_number(hex_hash),
        "IP_ADDRESS": lambda: _generate_ip_address(hex_hash),
        "MEDICAL_RECORD": lambda: _generate_medical_record(hex_hash),
        "PASSPORT_NUMBER": lambda: _generate_passport_number(hex_hash),
        "DRIVERS_LICENSE": lambda: _generate_drivers_license(hex_hash),
        "OPPOSING_COUNSEL": lambda: _generate_opposing_counsel(hex_hash),
        "PRIVILEGE_MARKER": lambda: _generate_privilege_marker(hex_hash),
    }

    gen = generators.get(entity_type)
    if gen:
        return gen()
    return f"[REDACTED_{entity_type}]"


# ---------------------------------------------------------------------------
# Session-scoped Pseudonymizer
# ---------------------------------------------------------------------------

class Pseudonymizer:
    """
    Session-scoped pseudonymization engine.

    The same original entity value always maps to the same pseudonym
    within a given session, enabling consistent masking across multiple
    calls (e.g., a multi-turn conversation).
    """

    def __init__(self, session_id: str, firm_id: str = ""):
        self.session_id = session_id
        self.firm_id = firm_id
        self._mappings: dict[str, dict] = {}        # key -> {original, hash, pseudonym, type}
        self._reverse: dict[str, str] = {}           # pseudonym -> original
        self._created_at = time.time()
        self._expires_at = self._created_at + SESSION_EXPIRY_SECONDS

    @property
    def is_expired(self) -> bool:
        return time.time() > self._expires_at

    def pseudonymize(
        self,
        text: str,
        entities: list[dict],
    ) -> tuple[str, dict[str, str], int]:
        """
        Replace all detected entities in *text* with pseudonyms.

        Returns:
            (masked_text, pseudonym_map, entities_replaced)

        The pseudonym_map is ``{original_text: pseudonym_text}``.
        """
        if self.is_expired:
            raise RuntimeError(f"Pseudonym session {self.session_id} has expired")

        # Sort entities by start position descending so replacements
        # don't shift earlier offsets.
        sorted_entities = sorted(entities, key=lambda e: e["start"], reverse=True)

        masked_text = text
        entities_replaced = 0
        pseudonym_map: dict[str, str] = {}

        for entity in sorted_entities:
            entry = self._get_or_create(entity["text"], entity["type"])
            masked_text = (
                masked_text[: entity["start"]]
                + entry["pseudonym"]
                + masked_text[entity["end"] :]
            )
            pseudonym_map[entity["text"]] = entry["pseudonym"]
            entities_replaced += 1

        return masked_text, pseudonym_map, entities_replaced

    def depseudonymize(self, text: str) -> str:
        """Reverse all pseudonyms in *text* back to their original values."""
        if self.is_expired:
            raise RuntimeError(f"Pseudonym session {self.session_id} has expired")

        result = text
        # Sort by pseudonym length descending to avoid partial replacements
        for pseudonym, original in sorted(
            self._reverse.items(), key=lambda kv: len(kv[0]), reverse=True
        ):
            result = result.replace(pseudonym, original)
        return result

    def get_pseudonym_map(self) -> dict[str, str]:
        """Return the current mapping of original -> pseudonym values."""
        return {
            entry["original"]: entry["pseudonym"]
            for entry in self._mappings.values()
        }

    # -------------------------------------------------------------------
    # Internals
    # -------------------------------------------------------------------

    def _get_or_create(self, original: str, entity_type: str) -> dict:
        """Look up or create a pseudonym entry for an original value."""
        key = f"{entity_type}::{original}"

        existing = self._mappings.get(key)
        if existing is not None:
            return existing

        hex_hash = _sha256(original)
        pseudonym = generate_pseudonym(entity_type, original, hex_hash)

        entry = {
            "original": original,
            "hash": hex_hash,
            "pseudonym": pseudonym,
            "type": entity_type,
        }

        self._mappings[key] = entry
        self._reverse[pseudonym] = original
        return entry
