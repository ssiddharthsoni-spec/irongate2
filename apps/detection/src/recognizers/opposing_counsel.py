"""
Opposing Counsel Recognizer
Detects references to opposing counsel/parties in legal text.
"""

import re
from .matter_number import RecognizerResult


class OpposingCounselRecognizer:
    """Detects opposing counsel references."""

    PATTERNS = [
        re.compile(
            r'\b(?:opposing\s+counsel|adverse\s+party|defendant\'?s?\s+counsel|'
            r'plaintiff\'?s?\s+counsel|respondent\'?s?\s+counsel|'
            r'petitioner\'?s?\s+counsel)\s*[:\s]*'
            r'([A-Z][a-zA-Z\s&.,]+?)(?:\.|,|\n|$)',
            re.IGNORECASE,
        ),
        re.compile(
            r'\b(?:counsel\s+for\s+(?:the\s+)?(?:defendant|plaintiff|respondent|petitioner))\s*'
            r'[:\s]*([A-Z][a-zA-Z\s&.,]+?)(?:\.|,|\n|$)',
            re.IGNORECASE,
        ),
    ]

    def analyze(self, text: str, language: str = "en") -> list[RecognizerResult]:
        results = []
        for pattern in self.PATTERNS:
            for match in pattern.finditer(text):
                results.append(
                    RecognizerResult(
                        entity_type="OPPOSING_COUNSEL",
                        start=match.start(),
                        end=match.end(),
                        score=0.75,
                    )
                )
        return results
