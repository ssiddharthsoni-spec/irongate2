"""
Client-Matter Pair Recognizer
Detects paired client name + matter number references.
"""

import re
from .matter_number import RecognizerResult


class ClientMatterPairRecognizer:
    """Detects client name paired with matter/case number."""

    PATTERN = re.compile(
        r'(?:(?:client|matter|re|regarding|in\s+the\s+matter\s+of)[:\s]+)'
        r'([A-Z][a-zA-Z\s&.,]+?)\s*'
        r'(?:matter|case|docket|file)?\s*(?:#|no\.?|number)?\s*'
        r'(\d{2,4}[-./]\d{3,6})',
        re.IGNORECASE,
    )

    def analyze(self, text: str, language: str = "en") -> list[RecognizerResult]:
        results = []
        for match in self.PATTERN.finditer(text):
            results.append(
                RecognizerResult(
                    entity_type="CLIENT_MATTER_PAIR",
                    start=match.start(),
                    end=match.end(),
                    score=0.9,
                )
            )
        return results
