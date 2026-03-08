# Chrome Web Store Listing — Iron Gate

## Extension Name

Iron Gate — AI Data Governance

## Short Description (132 characters max)

Protect sensitive data in AI prompts. Real-time PII scanning, pseudonymization, and compliance for ChatGPT, Claude, Gemini & more.

## Detailed Description

Iron Gate is a browser extension that prevents sensitive data from leaking into AI tools. It scans every prompt in real time — before it leaves your browser — and detects personally identifiable information (PII), credentials, legal privilege markers, financial data, and classified content.

Designed for law firms, financial institutions, healthcare organizations, and enterprises that need to use AI safely without risking regulatory violations or data breaches.

### How It Works

Iron Gate sits between you and your AI assistant. When you type or paste content into a supported AI platform, Iron Gate instantly analyzes the text for sensitive information. Detected entities are scored on a 0-100 sensitivity scale across four levels: low, medium, high, and critical.

Depending on your organization's policy, Iron Gate can:
- **Warn** you about sensitive content before submission
- **Block** high-risk prompts from being sent
- **Pseudonymize** detected entities (replace real names, SSNs, account numbers with realistic placeholders) so the AI never sees real data
- **De-pseudonymize** the AI's response, restoring original values so you get a useful answer without any data exposure

All detection happens on-device. Your data never leaves the browser for scanning purposes.

### Supported AI Platforms (10)

1. ChatGPT (chatgpt.com, chat.openai.com)
2. Claude (claude.ai)
3. Google Gemini (gemini.google.com)
4. Microsoft Copilot (copilot.microsoft.com)
5. Perplexity AI (perplexity.ai)
6. DeepSeek (chat.deepseek.com)
7. Poe (poe.com)
8. Groq (groq.com)
9. Hugging Face Chat (huggingface.co/chat)
10. You.com (you.com)

### Detection Capabilities

Iron Gate detects 40+ entity types across multiple categories:

**Personal Identifiers:** Names, email addresses, phone numbers, dates of birth, passport numbers, driver's license numbers

**Financial Data:** Credit card numbers, account numbers, monetary amounts, IBAN numbers, bank routing numbers

**Government IDs:** Social Security Numbers (US), National Insurance Numbers (UK), Social Insurance Numbers (Canada), Aadhaar numbers (India), Tax File Numbers (Australia), German Tax IDs, French INSEE numbers

**Healthcare:** Medical record numbers, HIPAA-protected content

**Legal & Compliance:** Attorney-client privilege markers, matter/case numbers, classification markings (SECRET, TOP SECRET//SCI), CUI markings, ITAR/EAR export controls

**Credentials & Secrets:** API keys (GitHub, Slack, Stripe, SendGrid), AWS credentials, GCP credentials, Azure credentials, database connection strings, private keys, JWT tokens

**Industry-Specific:** Insurance policy numbers, NAIC codes, student IDs, FERPA education records, well API numbers, FERC docket numbers, parcel/APN numbers, MLS listing numbers

**Anti-Evasion:** Detects base64-encoded PII and strips zero-width character obfuscation attempts

### Key Features

- **Real-time scanning** — Detection runs as you type, before submission
- **Sensitivity scoring** — Four-tier scoring system (low, medium, high, critical) with full score breakdown
- **Smart pseudonymization** — Replaces sensitive entities with realistic placeholders, preserving prompt structure
- **Response de-pseudonymization** — AI responses are automatically restored with original values
- **File scanning** — Detects PII in uploaded files before they reach AI platforms
- **Clipboard monitoring** — Scans pasted content for sensitive data
- **Intent suppression** — Distinguishes intentional PII use (e.g., "What's my horoscope for March 15?") from accidental data leakage
- **Document classification** — Identifies document types (litigation memos, contracts, financial data) for context-aware scoring
- **Contextual keyword detection** — Flags business-sensitive patterns like M&A deal terms, MNPI, litigation strategy, and layoff plans even without traditional PII entities

### Enterprise Features

- **Admin dashboard** — Centralized visibility into AI usage across your organization
- **Policy enforcement** — Configure sensitivity thresholds, block/warn/allow rules per platform
- **Managed configuration** — Deploy settings via Chrome enterprise policy (managed storage)
- **Audit trail** — Complete log of detection events, actions taken, and policy decisions
- **SIEM forwarding** — Forward audit events to your existing security infrastructure via webhooks
- **Compliance reporting** — Export-ready reports for GDPR, CCPA, HIPAA, and SOC 2 audits
- **Session lock** — Inactivity timeout with PIN/password lock screen

### Privacy Promise

- All PII detection runs entirely on-device in your browser
- Raw prompt text and detected PII values are never transmitted to our servers
- Only aggregate event metadata (entity counts, sensitivity levels, action taken) is sent to your organization's configured API endpoint
- No analytics, no tracking pixels, no advertising, no third-party data sharing
- Session data is stored in chrome.storage.session and cleared when the browser closes

## Category

Productivity

## Tags / Keywords

- data governance
- PII detection
- AI security
- compliance
- GDPR
- HIPAA
- data loss prevention
- ChatGPT security
- enterprise AI
- pseudonymization
- data privacy
- DLP
