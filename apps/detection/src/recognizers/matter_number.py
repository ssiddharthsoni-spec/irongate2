"""
Matter Number Recognizer
Detects legal matter/case numbers in various formats:
- Matter #2024-0847
- Case No. 23-cv-01234
- Docket No. 2024-12345
"""

import re
from typing import Optional


class RecognizerResult:
    def __init__(self, entity_type: str, start: int, end: int, score: float):
        self.entity_type = entity_type
        self.start = start
        self.end = end
        self.score = score


class MatterNumberRecognizer:
    """Detects legal matter and case numbers."""

    PATTERNS = [
        # Matter #YYYY-NNNN or Matter No. YYYY-NNNN
        re.compile(
            r'\b(?:matter|case|docket|file)\s*(?:#|no\.?|number:?)\s*'
            r'(\d{2,4}[-./]\d{3,6}(?:[-./]\d{1,4})?)',
            re.IGNORECASE,
        ),
        # Federal court format: NN-cv-NNNNN
        re.compile(
            r'\b(\d{1,2}-(?:cv|cr|mc|mj|ap|bk|po)-\d{4,6})\b',
            re.IGNORECASE,
        ),
        # Generic case citation: YYYY XX NNNNN
        re.compile(
            r'\b(20\d{2}\s+[A-Z]{2}\s+\d{4,8})\b',
        ),
    ]

    def analyze(self, text: str, language: str = "en") -> list[RecognizerResult]:
        results = []
        for pattern in self.PATTERNS:
            for match in pattern.finditer(text):
                results.append(
                    RecognizerResult(
                        entity_type="MATTER_NUMBER",
                        start=match.start(),
                        end=match.end(),
                        score=0.8,
                    )
                )
        return results
