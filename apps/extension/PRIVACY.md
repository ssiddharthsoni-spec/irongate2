# Iron Gate — Privacy Policy

**Effective Date:** March 2026
**Last Updated:** March 6, 2026

## Overview

Iron Gate is an AI data governance tool that protects sensitive information before it reaches AI services. This document explains what data Iron Gate accesses, how it processes data, and what it transmits.

## Data Collection & Processing

### What Iron Gate Scans
Iron Gate scans text entered into supported AI tools (ChatGPT, Claude, Gemini, Copilot, etc.) **locally in your browser** to detect sensitive entities such as:
- Personal Identifiable Information (PII): names, emails, phone numbers, addresses
- Financial data: credit card numbers, account numbers, routing numbers
- Government IDs: SSNs, passport numbers, driver's license numbers
- Healthcare data: medical record numbers, NPI numbers
- Credentials: API keys, tokens, passwords

### How Data Is Processed
1. **Local-first detection**: All PII scanning happens in the browser using regex-based pattern matching. No raw text is sent to external servers for detection.
2. **Pseudonymization**: When sensitive data is detected, it is replaced with pseudonyms (e.g., `[EMAIL-1]`) before the prompt reaches the AI tool.
3. **De-pseudonymization**: AI responses containing pseudonyms are reversed back to original values locally in the browser.

### What Data Is Transmitted
Iron Gate sends **metadata only** to the Iron Gate API for audit logging:
- Entity types detected (e.g., "EMAIL", "SSN") — **never the actual values**
- Sensitivity scores (numeric)
- Timestamp and AI tool identifier
- Action taken (allowed, blocked, pseudonymized)
- SHA-256 hashes of entity values (for provenance tracking)

**Iron Gate never transmits raw PII, original prompt text, or AI responses to its servers.**

### Data Stored Locally
- Pseudonym reverse map (AES-256-GCM encrypted in `chrome.storage.session`)
- User preferences and configuration
- Cached suppression rules and compliance policies

### Data Stored Server-Side
- Audit event logs (entity types, scores, actions — no raw PII)
- Firm/organization configuration
- User accounts (managed via Clerk authentication)

## Permissions Justification

| Permission | Purpose |
|---|---|
| `activeTab` | Access the current tab to scan AI tool input fields |
| `storage` | Store user preferences and encrypted pseudonym maps |
| `sidePanel` | Display the Iron Gate dashboard panel |
| `alarms` | Periodic sync of compliance policies and suppression rules |
| `scripting` | Inject content scripts into supported AI tool pages |
| `webNavigation` | Detect navigation to supported AI tools |
| `notifications` | Alert users when sensitive data is detected |

## Host Permissions
Iron Gate only accesses pages on supported AI tool domains (chatgpt.com, claude.ai, gemini.google.com, etc.) and its own API endpoint for audit logging.

## Third-Party Services
- **Clerk**: Authentication (SSO, email/password)
- **Supabase**: Database hosting (audit logs, configuration)
- **Render**: API hosting

## Data Retention
Audit logs are retained according to the organization's configured retention policy (default: 90 days). Users can request data deletion through their organization's admin.

## Contact
For privacy inquiries: privacy@irongate.dev
