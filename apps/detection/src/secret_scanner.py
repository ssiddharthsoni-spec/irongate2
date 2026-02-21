"""
Iron Gate Secret Scanner

Detects credentials, API keys, tokens, and other secrets in text.
Ported from the TypeScript version (apps/api/src/proxy/secretScanner.ts).
"""

import re
from dataclasses import dataclass


@dataclass
class DetectedSecret:
    type: str
    text: str
    start: int
    end: int
    confidence: float


class SecretScanner:
    """
    Regex-based secret scanner that detects API keys, cloud credentials,
    database URIs, auth tokens, private keys, and other sensitive secrets.
    """

    PATTERNS = {
        'API_KEY': [
            (r'sk-[a-zA-Z0-9]{20,}', 0.95),           # OpenAI
            (r'sk_live_[a-zA-Z0-9]{24,}', 0.95),       # Stripe
            (r'sk_test_[a-zA-Z0-9]{24,}', 0.90),       # Stripe test
            (r'ghp_[a-zA-Z0-9]{36}', 0.95),             # GitHub PAT
            (r'xoxb-[0-9]+-[a-zA-Z0-9]+', 0.90),       # Slack bot
            (r'SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}', 0.95),  # SendGrid
            (r'sk-ant-[a-zA-Z0-9_-]{40,}', 0.95),      # Anthropic
        ],
        'AWS_CREDENTIAL': [
            (r'AKIA[0-9A-Z]{16}', 0.95),
            (r'ASIA[0-9A-Z]{16}', 0.90),
        ],
        'GCP_CREDENTIAL': [
            (r'AIza[0-9A-Za-z_-]{35}', 0.90),
        ],
        'DATABASE_URI': [
            (r'(?:postgres(?:ql)?|mysql|mongodb|redis)://\S+', 0.95),
        ],
        'AUTH_TOKEN': [
            (r'eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+', 0.90),  # JWT
        ],
        'PRIVATE_KEY': [
            (r'-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----', 0.99),
        ],
        'AZURE_CREDENTIAL': [
            (r'DefaultEndpointsProtocol=https;AccountName=\S+', 0.90),
        ],
    }

    def detect(self, text: str) -> list[DetectedSecret]:
        """
        Scan text for known secret patterns.

        Returns a list of DetectedSecret instances with type, matched text,
        character offsets, and confidence score.
        """
        results = []
        for entity_type, patterns in self.PATTERNS.items():
            for pattern, confidence in patterns:
                for match in re.finditer(pattern, text):
                    results.append(DetectedSecret(
                        type=entity_type,
                        text=match.group(),
                        start=match.start(),
                        end=match.end(),
                        confidence=confidence,
                    ))
        return results
