# Permissions Justification — Iron Gate Browser Extension

This document provides the rationale for each permission requested by Iron Gate, as required for Chrome Web Store submission. Each permission is the minimum necessary for the extension's core data governance functionality.

---

## Required Permissions

### `activeTab`

**Why it's needed:** Iron Gate needs to interact with the currently active tab to detect the AI platform in use and coordinate with content scripts. The `activeTab` permission grants temporary access only to the tab the user is actively interacting with, and only when the user engages with the extension (e.g., opens the side panel). This is more privacy-preserving than requesting broad tab access.

**What it's used for:** Identifying which AI platform is active, sending detection results to the side panel, and coordinating pseudonymization actions with the page.

### `storage`

**Why it's needed:** Iron Gate stores user preferences, extension configuration, detection event logs, and pseudonymization session state locally in the browser.

**What it's used for:**
- `chrome.storage.session` — Temporary detection events and session tokens, cleared when the browser closes
- `chrome.storage.local` — Persistent user preferences (sensitivity thresholds, notification settings, API endpoint configuration)
- `chrome.storage.managed` — Reading enterprise policy settings deployed by IT administrators

### `sidePanel`

**Why it's needed:** Iron Gate displays a side panel that shows real-time detection results, sensitivity scores, entity breakdowns, and policy actions. The side panel is the primary user interface — it lets users review what was detected and take action (allow, block, or pseudonymize) without leaving their AI conversation.

**What it's used for:** Rendering the Iron Gate dashboard UI alongside the AI platform, showing detection results, score breakdowns, and session history.

### `alarms`

**Why it's needed:** Iron Gate uses `chrome.alarms` for scheduled background tasks that cannot rely on `setTimeout` (which is unreliable in Manifest V3 service workers that may be suspended).

**What it's used for:**
- Periodic cleanup of expired session data and pseudonymization maps
- Scheduled sync of enterprise policy configurations
- Data retention enforcement (purging detection events older than the configured retention period)
- Inactivity timeout for session lock

### `scripting`

**Why it's needed:** Iron Gate needs to programmatically inject content scripts into AI platform pages. While static content script declarations cover most cases, the `scripting` permission is needed for dynamic injection when the user grants optional host permissions for additional AI platforms at runtime.

**What it's used for:** Injecting detection and interception scripts into newly enabled AI platforms after the user grants optional permissions.

### `webNavigation`

**Why it's needed:** AI platforms like ChatGPT and Claude use single-page application (SPA) navigation that does not trigger standard page load events. Iron Gate needs `webNavigation` to detect in-page navigations (e.g., switching between conversations) so it can re-initialize detection for the new context.

**What it's used for:** Detecting SPA navigation events on supported AI platforms to ensure continuous monitoring across conversation switches.

### `notifications`

**Why it's needed:** Iron Gate displays browser notifications to alert users about high-risk or critical sensitivity detections that require immediate attention, especially when the side panel is not open.

**What it's used for:** Alerting users when a critical-risk prompt is about to be submitted (e.g., detected SSN, API key, or classified content), prompting them to review before proceeding.

### `declarativeNetRequest`

**Why it's needed:** Iron Gate uses declarative net request rules to add security headers to requests between the extension and the configured Iron Gate API endpoint. This is used instead of the more powerful `webRequest`/`webRequestBlocking` permissions because `declarativeNetRequest` is more privacy-preserving — rules are declared statically and do not give the extension access to observe or modify arbitrary network traffic.

**What it's used for:** Adding required authentication and security headers to API requests to the organization's Iron Gate backend. The rules are scoped exclusively to the Iron Gate API endpoints defined in `net_request_rules.json`.

### `offscreen`

**Why it's needed:** Manifest V3 service workers cannot access DOM APIs. Iron Gate uses an offscreen document for operations that require DOM access in the background, such as parsing HTML content from clipboard paste events and processing file content for PII scanning.

**What it's used for:** DOM-dependent background processing tasks like HTML parsing and file content extraction that cannot run in the service worker context.

---

## Host Permissions

### Required Host Permissions

These are the primary AI platforms that Iron Gate monitors. They are required (not optional) because they represent the most widely used AI tools in enterprise environments:

| Host Pattern | Platform | Justification |
|---|---|---|
| `https://chatgpt.com/*` | ChatGPT | Core supported platform — most widely used enterprise AI tool |
| `https://chat.openai.com/*` | ChatGPT (legacy URL) | Legacy OpenAI domain still in active use; redirects and bookmarks point here |
| `https://claude.ai/*` | Claude | Core supported platform — widely adopted in legal and professional services |
| `https://gemini.google.com/*` | Google Gemini | Core supported platform — integrated into Google Workspace enterprise |
| `https://irongate-api.onrender.com/*` | Iron Gate API (production) | The extension's own backend API for event reporting, policy sync, and proxy routing |
| `https://irongate-api-staging.onrender.com/*` | Iron Gate API (staging) | Staging environment for pre-release testing; required for QA workflows |

### Optional Host Permissions

These platforms are supported but not required. The extension requests access only when the user explicitly enables them. This follows Chrome's permission best practice of requesting the minimum permissions upfront:

| Host Pattern | Platform | Justification |
|---|---|---|
| `https://copilot.microsoft.com/*` | Microsoft Copilot | Additional AI platform — opt-in when the organization uses Microsoft AI tools |
| `https://chat.deepseek.com/*` | DeepSeek | Additional AI platform — opt-in for organizations using DeepSeek |
| `https://poe.com/*` | Poe | Additional AI platform — aggregator that provides access to multiple AI models |
| `https://perplexity.ai/*`, `https://www.perplexity.ai/*`, `https://*.perplexity.ai/*` | Perplexity AI | Additional AI platform — multiple subdomains needed due to Perplexity's URL structure |
| `https://you.com/*` | You.com | Additional AI platform — opt-in for organizations using You.com's AI search |
| `https://huggingface.co/chat/*` | Hugging Face Chat | Additional AI platform — opt-in for teams using open-source models via HF Chat |
| `https://groq.com/*` | Groq | Additional AI platform — opt-in for organizations using Groq's fast inference |

---

## Content Scripts

### Why content scripts run on AI platforms

Iron Gate injects two content scripts into supported AI platforms:

**1. `main-world.ts` (runs at `document_start`, `MAIN` world)**

This script runs in the page's main JavaScript execution context. It is required to intercept outgoing API requests (fetch/XHR) before they leave the browser. This is the core mechanism that allows Iron Gate to:
- Capture prompt text before it is sent to the AI provider's API
- Replace detected PII with pseudonymized placeholders in the outgoing request
- Intercept the AI's response to de-pseudonymize it (restore original values)

Running in the MAIN world at `document_start` is necessary because:
- The fetch/XHR interception must be installed before the page's own JavaScript initializes, otherwise requests would bypass Iron Gate
- Access to the page's JavaScript context (MAIN world) is required to intercept `window.fetch` and `XMLHttpRequest` — isolated content scripts cannot intercept these

**2. `src/content/index.ts` (runs at `document_idle`, isolated world)**

This script runs in Chrome's isolated content script world. It handles:
- DOM observation to detect prompt input fields and monitor for pasted content
- Clipboard monitoring for sensitive data in paste events
- File upload interception and scanning
- Communication bridge between the MAIN world script and the service worker (via `chrome.runtime` messaging)
- UI overlays (block warnings, scan indicators, sensitivity badges)

Running in the isolated world provides security isolation — the content script can access Chrome extension APIs (`chrome.runtime`, `chrome.storage`) without exposing them to the page's JavaScript.

---

## Declarative Net Request Rules

The `declarative_net_request` manifest entry references `net_request_rules.json`, which contains static rules scoped exclusively to Iron Gate's own API endpoints. These rules:
- Add authentication headers to requests to the Iron Gate backend
- Are limited to `https://irongate-api.onrender.com` and `https://irongate-api-staging.onrender.com`
- Do not observe, modify, or block any other network traffic
- Follow Chrome's recommended approach for header modification (declarative rather than programmatic)

---

## Web Accessible Resources

The `web_accessible_resources` entry makes `intelligence/model_weights.json` accessible to the four core AI platform domains. This file contains scoring model weights used by the on-device detection engine. It must be web-accessible so that the MAIN world content script (which runs in the page's context, not the extension's) can load it.

This resource contains no sensitive data — only numeric weights for the detection algorithm.

---

## Content Security Policy

The extension's CSP is restrictive by design:

```
script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; connect-src https://irongate-api.onrender.com https://irongate-api-staging.onrender.com 'self';
```

- **script-src 'self'** — Only scripts bundled with the extension can execute; no remote script loading
- **style-src 'self'** — Only styles bundled with the extension; no remote stylesheets
- **img-src 'self' data:** — Only local images and data URIs (for icons and inline images)
- **object-src 'none'** — No plugins, Flash, or embedded objects
- **connect-src** — Network requests from extension pages are restricted to the Iron Gate API endpoints and the extension itself

---

*This document is intended for Chrome Web Store review. For questions about Iron Gate's permission usage, contact [security@your-domain.com].*
