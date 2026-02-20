"""
Deal Codename Recognizer
Detects deal/project codenames commonly used in M&A and legal contexts.
"""

import re
from .matter_number import RecognizerResult


class DealCodenameRecognizer:
    """Detects deal codenames like 'Project Phoenix' or 'Operation Sunrise'."""

    PATTERNS = [
        re.compile(
            r'\b(?:project|operation|deal|transaction|initiative)\s+'
            r'([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b',
        ),
        re.compile(
            r'\b(?:code[\s-]?name[d]?|codename[d]?)[:\s]+'
            r'["\']?([A-Z][a-zA-Z\s]+?)["\']?\b',
            re.IGNORECASE,
        ),
    ]

    def analyze(self, text: str, language: str = "en") -> list[RecognizerResult]:
        results = []
        # Common non-deal project names to exclude
        exclude = {
            "Project Manager", "Project Management", "Project Plan",
            "Operation System", "Operation Manual",
        }

        for pattern in self.PATTERNS:
            for match in pattern.finditer(text):
                full_match = match.group(0)
                if full_match not in exclude:
                    results.append(
                        RecognizerResult(
                            entity_type="DEAL_CODENAME",
                            start=match.start(),
                            end=match.end(),
                            score=0.7,
                        )
                    )
        return results
