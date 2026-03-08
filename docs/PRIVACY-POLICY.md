# Privacy Policy — Iron Gate Browser Extension

**Effective Date:** March 8, 2026
**Last Updated:** March 8, 2026
**Extension Name:** Iron Gate — AI Data Governance
**Version:** 0.2.7

---

## Overview

Iron Gate is a browser extension that detects sensitive information in AI prompts before they are submitted. This privacy policy explains what data Iron Gate collects, how it is used, and how it is stored.

Our core principle: **your data stays in your browser.** All PII detection and scoring happens entirely on-device. We never collect, transmit, or store the text of your prompts or the sensitive information detected within them.

---

## 1. Data We Collect

Iron Gate collects **detection event metadata only** — never raw PII or prompt content. The metadata includes:

- **Entity counts** — The number and types of entities detected (e.g., "2 emails, 1 SSN"), without the actual values
- **Sensitivity scores** — The computed sensitivity level (low, medium, high, critical) and numeric score
- **Action taken** — Whether the prompt was allowed, warned, blocked, or pseudonymized
- **Platform identifier** — Which AI tool was in use (e.g., "chatgpt", "claude")
- **Timestamp** — When the detection event occurred
- **Session identifiers** — Anonymous session tokens for correlating events within a browser session

This metadata is transmitted only to your organization's configured Iron Gate API endpoint. If no API endpoint is configured, no data is transmitted at all.

---

## 2. Data We Do NOT Collect

Iron Gate explicitly does **not** collect, transmit, or store:

- The text of your prompts or AI conversations
- Detected PII values (names, SSNs, credit card numbers, emails, phone numbers, etc.)
- Passwords or authentication credentials
- Browser history or browsing activity outside of supported AI platforms
- Keystroke data or form input on non-AI websites
- Screenshots or screen recordings
- Personal files or documents (file content is scanned locally and never transmitted)
- Any data for advertising, profiling, or behavioral tracking purposes

---

## 3. How Data Is Stored Locally

Iron Gate uses the following Chrome storage mechanisms:

- **chrome.storage.session** — Detection events, sensitivity scores, and session state. This data is automatically cleared when the browser is closed and is never persisted to disk.
- **chrome.storage.local** — User preferences, extension configuration, and API endpoint settings. This data persists across browser sessions but remains local to the device.
- **chrome.storage.managed** — Enterprise policy settings deployed by your organization's IT administrator via Chrome enterprise policy. This data is read-only and managed by your organization.

No data is stored in cookies, IndexedDB, or any other browser storage mechanism.

---

## 4. Server Communication

Iron Gate communicates only with your organization's configured Iron Gate API endpoint. No data is sent to any other server.

**When pseudonymization/proxy routing is enabled:**
- Pseudonymized (redacted) versions of prompts may be sent to your organization's API endpoint for routing to a private LLM
- The pseudonymized text contains only placeholder tokens (e.g., "[PERSON_1]", "[SSN_1]") — never real PII values
- De-pseudonymization (restoring original values in the AI response) happens entirely in the browser

**API endpoint communication includes:**
- Detection event metadata (as described in Section 1)
- Authentication tokens for your organization's Iron Gate instance
- Extension version and configuration sync requests

All communication uses HTTPS with TLS 1.2 or higher. The extension's Content Security Policy restricts network requests to configured API endpoints only.

---

## 5. Third Parties

Iron Gate does **not** share data with any third parties. Specifically:

- **No analytics services** — We do not use Google Analytics, Mixpanel, Amplitude, or any analytics SDK
- **No tracking pixels** — No tracking or retargeting pixels are loaded
- **No advertising** — No ad networks, no ad-related data collection
- **No data brokers** — We do not sell, rent, or share user data with data brokers
- **No third-party SDKs** — The extension contains no third-party code that collects user data

The only external communication is with your organization's self-hosted or managed Iron Gate API endpoint.

---

## 6. Data Retention

**Local data (browser):**
- Session data (chrome.storage.session): Automatically deleted when the browser is closed
- Configuration data (chrome.storage.local): Persists until the extension is uninstalled or the user clears extension data
- No local data older than the current browser session is retained for detection events

**Server-side data (your organization's API):**
- Detection event metadata sent to your organization's API endpoint is subject to your organization's own data retention policies
- Iron Gate's default server-side retention policy deletes event metadata after 90 days
- Your organization's administrator can configure custom retention periods
- Data can be deleted on request through the admin dashboard

---

## 7. Permissions Justification

Iron Gate requests only the permissions necessary for its core functionality. See the separate [Permissions Justification](./PERMISSIONS-JUSTIFICATION.md) document for a detailed explanation of each permission and why it is required.

---

## 8. GDPR Compliance (European Economic Area)

For users in the European Economic Area (EEA), Iron Gate processes data in compliance with the General Data Protection Regulation (GDPR):

- **Legal basis:** Legitimate interest (providing data governance services as configured by your organization) and, where applicable, your organization's contractual obligations
- **Data minimization:** Only detection event metadata is collected — never raw PII or prompt content
- **Purpose limitation:** Data is used solely for security monitoring, compliance reporting, and policy enforcement
- **Right of access:** You may request a copy of any detection event metadata associated with your account through your organization's Iron Gate administrator
- **Right to erasure:** You may request deletion of your detection event metadata through your organization's Iron Gate administrator
- **Right to portability:** Detection event metadata can be exported in standard formats (JSON, CSV) through the admin dashboard
- **Data processing agreements:** Available upon request for enterprise customers
- **No cross-border transfers of PII:** PII is never transmitted — detection happens entirely on-device

---

## 9. CCPA Compliance (California)

For California residents, Iron Gate complies with the California Consumer Privacy Act (CCPA):

- **Categories of information collected:** Detection event metadata only (entity counts, sensitivity scores, timestamps, platform identifiers)
- **Sale of personal information:** Iron Gate does not sell personal information. Ever.
- **Right to know:** California residents may request disclosure of the categories and specific pieces of personal information collected
- **Right to delete:** California residents may request deletion of personal information collected
- **Right to opt-out:** As Iron Gate does not sell personal information, the right to opt-out of sale does not apply
- **Non-discrimination:** Iron Gate does not discriminate against users who exercise their privacy rights

---

## 10. Children's Privacy

Iron Gate is designed for enterprise and professional use. We do not knowingly collect personal information from children under the age of 13 (or 16 in the EEA). If you believe a child has provided personal information through Iron Gate, please contact us immediately.

---

## 11. Changes to This Policy

We may update this privacy policy from time to time. Material changes will be communicated through the extension's update notes and the Iron Gate dashboard. The "Last Updated" date at the top of this policy will be revised accordingly.

---

## 12. Contact Information

For privacy-related inquiries, data access requests, or concerns:

- **Email:** [privacy@your-domain.com]
- **Data Protection Officer:** [Contact Name, contact@your-domain.com]
- **Mailing Address:** [Your Organization Address]

For GDPR-related requests, you may also contact your local data protection authority.

---

*This privacy policy applies to the Iron Gate browser extension (Chrome Web Store) version 0.2.7 and later.*
