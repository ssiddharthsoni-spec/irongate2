"""
Privilege Marker Recognizer
Detects attorney-client privilege and work product markers.
"""

import re
from .matter_number import RecognizerResult


class PrivilegeMarkerRecognizer:
    """Detects privilege and confidentiality markers in legal text."""

    PATTERNS = [
        re.compile(r'\battorney[\s-]client\s+privilege\b', re.IGNORECASE),
        re.compile(r'\bwork\s+product\s+(?:doctrine|protection|privilege)\b', re.IGNORECASE),
        re.compile(r'\bprivileged\s+and\s+confidential\b', re.IGNORECASE),
        re.compile(r'\battorney\s+work\s+product\b', re.IGNORECASE),
        re.compile(r'\bprotected\s+communication\b', re.IGNORECASE),
        re.compile(r'\blegal\s+professional\s+privilege\b', re.IGNORECASE),
        re.compile(r'\blitigation\s+privilege\b', re.IGNORECASE),
        re.compile(r'\bcommon\s+interest\s+privilege\b', re.IGNORECASE),
        re.compile(r'\bjoint\s+defense\s+privilege\b', re.IGNORECASE),
        re.compile(r'\bwithout\s+prejudice\b', re.IGNORECASE),
        re.compile(r'\bunder\s+seal\b', re.IGNORECASE),
        re.compile(r'\bconfidential\s+(?:treatment|information)\b', re.IGNORECASE),
    ]

    def analyze(self, text: str, language: str = "en") -> list[RecognizerResult]:
        results = []
        for pattern in self.PATTERNS:
            for match in pattern.finditer(text):
                results.append(
                    RecognizerResult(
                        entity_type="PRIVILEGE_MARKER",
                        start=match.start(),
                        end=match.end(),
                        score=0.95,
                    )
                )
        return results
