<p align="center">
  <h1 align="center">Iron Gate</h1>
  <p align="center">
    <strong>AI Governance for Professional Services</strong>
  </p>
  <p align="center">
    Monitor, detect, and protect sensitive data flowing into AI tools across your firm.
  </p>
  <p align="center">
    <a href="#"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status" /></a>
    <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
    <a href="#"><img src="https://img.shields.io/badge/version-0.1.0-orange" alt="Version" /></a>
    <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.7-blue" alt="TypeScript" /></a>
    <a href="#"><img src="https://img.shields.io/badge/Python-3.11-blue" alt="Python" /></a>
  </p>
</p>

---

## What It Does

Iron Gate is an AI governance platform purpose-built for professional services firms -- particularly law firms, consultancies, and financial advisors -- where protecting client confidentiality is not optional; it is a professional obligation.

- **Monitors every AI interaction** across your firm in real time, capturing prompts sent to ChatGPT, Claude, Gemini, Copilot, DeepSeek, and more -- without disrupting attorney workflows.
- **Detects sensitive data before it leaves the building** using a multi-engine pipeline (Presidio + GLiNER + custom legal recognizers) that understands PII, client matter numbers, privilege markers, deal codenames, and opposing counsel references.
- **Automatically protects confidential content** through smart pseudonymization that replaces real entities with realistic fakes, preserving prompt coherence while stripping identifying information.
- **Gives firm leadership a clear picture** of Shadow AI exposure, risk trends, and compliance posture through an executive dashboard with drill-down analytics.

---

## Architecture

```
                                                  +-----------------+
                                                  |   Dashboard     |
                                                  |   (Next.js)     |
                                                  |   :3001         |
                                                  +--------+--------+
                                                           |
                                                           | REST
                                                           v
+-------------------+       REST / WS       +----------------------------+
|  Chrome Extension | --------------------> |        API Server          |
|  (Manifest V3)    |  events, proxy reqs   |        (Hono + Bun)       |
|                   | <-------------------- |        :3000               |
|  - DOM Observer   |    actions, scores    |                            |
|  - Fetch Intercept|                       |  - Auth (Clerk JWT)        |
|  - Submit Handler |                       |  - Rate Limiting           |
|  - GLiNER (local) |                       |  - Pseudonymization Engine |
|  - Sensitivity UI |                       |  - LLM Router             |
+-------------------+                       +--------+-------+----------+
                                                     |       |
                                          +----------+       +----------+
                                          |                             |
                                          v                             v
                                +-----------------+           +------------------+
                                | Detection Svc   |           |    PostgreSQL     |
                                | (FastAPI/Python) |           |    + Redis       |
                                | :8080            |           |                  |
                                |                  |           |  - Events (audit)|
                                | - Presidio       |           |  - Firms/Users   |
                                | - GLiNER         |           |  - Pseudonym Maps|
                                | - Custom Legal   |           |  - Client Matters|
                                |   Recognizers    |           |  - Weight Tuning |
                                +-----------------+           +------------------+

                         Routing Decision (per prompt):

            Score <= 25          25 < Score <= 75          Score > 75
         +---------------+   +--------------------+   +-----------------+
         |  Passthrough   |   | Pseudonymized Proxy|   |  Private LLM    |
         |  (send as-is)  |   | (mask -> cloud LLM)|   |  (Ollama/local) |
         +---------------+   +--------------------+   +-----------------+
```

---

## Key Features

### Real-Time AI Tool Monitoring
Content scripts detect and capture prompts across **11 AI platforms**: ChatGPT, Claude, Gemini, Copilot, DeepSeek, Perplexity, Poe, You.com, HuggingFace Chat, Groq, and generic LLM interfaces. Three capture methods (DOM observation, fetch interception, submit handling) ensure comprehensive coverage regardless of how each platform sends data.

### Industry-Aware Entity Detection
A multi-engine pipeline combines **Microsoft Presidio** (rule-based + spaCy NER), **GLiNER** (transformer-based NER), and **custom legal recognizers** for domain-specific entities. When multiple engines agree on an entity, confidence scores are boosted. Detected entity types include:

| Standard PII | Legal / Professional Services |
|---|---|
| Person, Organization, Location | Matter Number |
| Email, Phone, SSN, Credit Card | Client-Matter Pair |
| IP Address, Account Number | Privilege Marker |
| Medical Record, Passport, License | Deal Codename, Opposing Counsel |

### Smart Pseudonymization
Replaces real data with **deterministic, realistic fakes** -- not `[REDACTED]` tags. "Jane Doe" becomes "Sarah Chen," "$2.5M settlement" becomes "$2.1M settlement," and matter number "M-2024-001" becomes "M-7392-418." The same input always maps to the same pseudonym within a session, preserving referential integrity across multi-turn conversations. LLM responses are automatically de-pseudonymized before returning to the user.

### Executive Lens
Goes beyond PII to determine whether the **content itself is the intellectual property**. Industry-specific rulesets (legal, finance, healthcare, manufacturing, technology, consulting) flag trade secrets, litigation strategy, proprietary formulas, MNPI, and clinical data that cannot be safely pseudonymized -- even with names removed. When triggered, content is routed exclusively to private infrastructure.

### Three Routing Strategies
Based on sensitivity scoring and Executive Lens analysis, each prompt is routed through one of three paths:

| Route | When | What Happens |
|---|---|---|
| **Passthrough** | Score <= 25, no sensitive entities | Sent to cloud LLM as-is |
| **Pseudonymized Proxy** | 25 < Score <= 75, PII but no IP risk | Entities replaced with fakes, sent to cloud LLM, response de-pseudonymized |
| **Private LLM** | Score > 75, or Executive Lens triggered | Sent to self-hosted model (Ollama) with real data intact |

### AES-256-GCM Encryption at Rest
All pseudonym mappings stored in the database are encrypted using AES-256-GCM with per-firm encryption keys. Keys are derived via PBKDF2 (100,000 iterations, SHA-256) from a master secret and a unique per-firm salt. The Web Crypto API (SubtleCrypto) is used across all runtimes for a consistent, auditable implementation.

### Firm-Wide Dashboard
A Next.js dashboard provides firm administrators with:
- Total interaction volume and protection statistics
- Sensitivity score distribution (low / medium / high / critical)
- AI tool usage breakdown with percentages
- Daily trend charts for volume and average risk
- Top users by activity and risk profile
- Recent high-risk event feed with drill-down

### Data Flywheel
User feedback on entity detection accuracy (correct / incorrect, with corrected type) feeds back into per-firm weight overrides, continuously improving detection precision for each firm's specific terminology and data patterns.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Chrome Extension** | TypeScript, React, Vite, Manifest V3 | Real-time prompt capture and side panel UI |
| **API Server** | Hono, Bun/Node.js, TypeScript | REST API, proxy pipeline, LLM routing |
| **Dashboard** | Next.js 15, React 19, Tailwind CSS, Recharts | Firm admin analytics and configuration |
| **Detection Service** | FastAPI, Python, Presidio, GLiNER, PyTorch | PII and entity detection, sensitivity scoring |
| **Database** | PostgreSQL 16, Drizzle ORM | Persistent storage, append-only audit log |
| **Cache** | Redis 7 | Rate limiting, session state |
| **Authentication** | Clerk | JWT-based auth with firm-scoped access |
| **Encryption** | Web Crypto API (AES-256-GCM, PBKDF2) | At-rest encryption of pseudonym data |
| **LLM Providers** | OpenAI, Anthropic, Azure OpenAI, Ollama | Cloud and private LLM routing targets |
| **Build System** | Turborepo, pnpm workspaces | Monorepo orchestration |
| **Validation** | Zod (TS), Pydantic (Python) | Runtime schema validation |
| **Infrastructure** | Docker Compose, Terraform (planned) | Local dev and deployment |

---

## Project Structure

```
iron-gate/
+-- apps/
|   +-- api/                    # Hono REST API server
|   |   +-- src/
|   |   |   +-- index.ts        # Server entrypoint, middleware, routes
|   |   |   +-- routes/
|   |   |   |   +-- events.ts   # Event ingestion (single + batch)
|   |   |   |   +-- dashboard.ts# Firm overview analytics
|   |   |   |   +-- admin.ts    # Firm config, users, client matters
|   |   |   |   +-- reports.ts  # Shadow AI exposure reports
|   |   |   |   +-- feedback.ts # Entity detection feedback
|   |   |   |   +-- proxy.ts    # Analyze + send proxy pipeline
|   |   |   +-- proxy/
|   |   |   |   +-- pseudonymizer.ts    # Pseudonymization engine + Executive Lens
|   |   |   |   +-- pseudonym-store.ts  # Encrypted persistence layer
|   |   |   |   +-- llm-router.ts       # Multi-provider LLM routing
|   |   |   |   +-- providers/          # OpenAI, Anthropic, Azure, Ollama adapters
|   |   |   |   +-- detection-client.ts # Detection service client
|   |   |   +-- db/
|   |   |   |   +-- schema.ts   # Drizzle ORM schema (8 tables)
|   |   |   |   +-- client.ts   # Database connection
|   |   |   |   +-- seed.ts     # Development seed data
|   |   |   +-- middleware/
|   |   |       +-- auth.ts     # Clerk JWT verification
|   |   |       +-- firm-context.ts  # Firm-scoped request context
|   |   |       +-- rate-limit.ts    # Per-user rate limiting
|   |   +-- drizzle.config.ts
|   |   +-- Dockerfile
|   |
|   +-- dashboard/              # Next.js admin dashboard
|   |   +-- src/app/
|   |   |   +-- page.tsx        # Overview dashboard
|   |   |   +-- charts.tsx      # Recharts visualizations
|   |   |   +-- events/         # Event log viewer
|   |   |   +-- reports/        # Shadow AI exposure reports
|   |   |   +-- admin/          # Firm configuration
|   |   +-- Dockerfile
|   |
|   +-- extension/              # Chrome extension (Manifest V3)
|   |   +-- manifest.json
|   |   +-- src/
|   |   |   +-- content/
|   |   |   |   +-- detectors/  # Per-platform DOM detectors
|   |   |   |   |   +-- chatgpt.ts, claude.ts, gemini.ts,
|   |   |   |   |      copilot.ts, deepseek.ts, perplexity.ts,
|   |   |   |   |      poe.ts, generic.ts
|   |   |   |   +-- capture/    # DOM observer, fetch interceptor,
|   |   |   |   |               # submit handler, clipboard monitor
|   |   |   |   +-- ui/         # Block overlay, sensitivity badge,
|   |   |   |                   # response injector
|   |   |   +-- detection/      # Client-side detection
|   |   |   |   +-- gliner-worker.ts     # WebWorker GLiNER inference
|   |   |   |   +-- fallback-regex.ts    # Regex fallback detector
|   |   |   |   +-- document-classifier.ts
|   |   |   |   +-- relationship-analyzer.ts
|   |   |   |   +-- conversation-tracker.ts
|   |   |   |   +-- scorer.ts
|   |   |   +-- worker/         # Service worker
|   |   |   |   +-- index.ts    # Background orchestration
|   |   |   |   +-- api-client.ts
|   |   |   |   +-- proxy-handler.ts
|   |   |   |   +-- auth.ts, queue.ts
|   |   |   +-- sidepanel/      # React side panel UI
|   |
|   +-- detection/              # Python detection service
|       +-- src/
|       |   +-- main.py         # FastAPI server
|       |   +-- pipeline.py     # Multi-engine detection pipeline
|       |   +-- scorer.py       # Sensitivity scoring
|       |   +-- pseudonymizer.py# Server-side pseudonymization
|       |   +-- recognizers/    # Custom legal entity recognizers
|       |       +-- matter_number.py
|       |       +-- privilege_marker.py
|       |       +-- client_matter_pair.py
|       |       +-- deal_codename.py
|       |       +-- opposing_counsel.py
|       +-- requirements.txt
|       +-- Dockerfile
|
+-- packages/
|   +-- types/                  # Shared TypeScript type definitions
|   +-- config/                 # Shared configuration (AI tools, entity weights)
|   +-- crypto/                 # AES-256-GCM encryption library
|   +-- proto/                  # Protocol buffer definitions (gRPC)
|
+-- demo/
|   +-- live-simulation.html    # Interactive demo page
|
+-- infra/
|   +-- docker/
|   |   +-- docker-compose.yml      # Full stack (production-like)
|   |   +-- docker-compose.dev.yml  # Dev infrastructure only
|   +-- terraform/              # Cloud deployment (planned)
|
+-- scripts/
|   +-- dev-setup.sh            # One-command dev environment setup
|   +-- demo.ts                 # CLI demo script
|   +-- smoke-test.ts           # API smoke tests
|
+-- turbo.json                  # Turborepo pipeline config
+-- pnpm-workspace.yaml         # Workspace definitions
+-- tsconfig.json               # Root TypeScript config
```

---

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | >= 20.0 |
| pnpm | >= 9.15 |
| Docker & Docker Compose | Latest |
| Python | >= 3.11 (for detection service) |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/iron-gate.git
cd iron-gate

# 2. Run the automated setup script
chmod +x scripts/dev-setup.sh
./scripts/dev-setup.sh
```

The setup script will:
- Verify prerequisites (Node.js, pnpm, Docker)
- Install all dependencies via `pnpm install`
- Copy `.env.example` to `.env` if not present
- Start PostgreSQL and Redis via Docker Compose

### Manual Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Start infrastructure (PostgreSQL + Redis)
docker compose -f infra/docker/docker-compose.dev.yml up -d

# Push database schema
pnpm db:migrate

# Seed development data
pnpm db:seed

# Start all services in development mode
pnpm dev
```

### Running Individual Services

```bash
# API server only (http://localhost:3000)
pnpm dev --filter=api

# Dashboard only (http://localhost:3001)
pnpm dev --filter=dashboard

# Chrome extension (build, then load unpacked in chrome://extensions)
pnpm dev --filter=extension

# Detection service
cd apps/detection
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8080 --reload
```

### Loading the Chrome Extension

1. Build the extension: `pnpm build --filter=extension`
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked" and select the `apps/extension/dist` directory
5. Navigate to any supported AI tool (ChatGPT, Claude, etc.)

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://irongate:irongate_dev@localhost:5432/irongate` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `CLERK_SECRET_KEY` | Clerk secret key for JWT verification | -- |
| `CLERK_PUBLISHABLE_KEY` | Clerk publishable key | -- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (client-side) | -- |
| `API_URL` | Internal API base URL | `http://localhost:3000` |
| `NEXT_PUBLIC_API_URL` | Public API URL for dashboard/extension | `http://localhost:3000/v1` |
| `DETECTION_SERVICE_URL` | Detection service base URL | `http://localhost:8080` |
| `DEFAULT_FIRM_ID` | Default firm ID for development | -- |
| `NODE_ENV` | Runtime environment | `development` |
| `PORT` | API server port | `3000` |
| `DASHBOARD_URL` | Dashboard origin for CORS | `http://localhost:3001` |
| `CHROME_EXTENSION_ID` | Extension ID for CORS allowlisting | -- |

---

## API Endpoints

All `/v1/*` routes require a valid `Authorization: Bearer <token>` header (Clerk JWT).

### Events

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/events` | Ingest a single prompt event |
| `POST` | `/v1/events/batch` | Ingest up to 100 events in a batch |
| `GET` | `/v1/events` | List events (paginated, filterable by score, tool, date) |
| `GET` | `/v1/events/:id` | Get a single event by ID |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/dashboard/overview` | Firm overview: totals, distribution, trends, top users |

### Reports

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/reports/exposure` | Shadow AI Exposure Report with recommendations |

### Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/firm` | Get firm configuration |
| `PUT` | `/v1/admin/firm` | Update firm configuration (name, mode, config) |
| `GET` | `/v1/admin/users` | List all users in the firm |
| `POST` | `/v1/admin/client-matters` | Import client/matter data |
| `GET` | `/v1/admin/client-matters` | List all client/matters |
| `GET` | `/v1/admin/weight-overrides` | Get entity weight overrides |

### Feedback

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/feedback` | Submit entity detection feedback |
| `GET` | `/v1/feedback/stats` | Get feedback accuracy statistics by entity type |

### Proxy

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/proxy/analyze` | Detect entities, score, pseudonymize, recommend route |
| `POST` | `/v1/proxy/send` | Send pseudonymized prompt to LLM, de-pseudonymize response |

### Detection Service (Python, port 8080)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/v1/detect` | Detect PII and sensitive entities in text |
| `POST` | `/v1/score` | Score sensitivity of text content |
| `POST` | `/v1/pseudonymize` | Combined detection + pseudonymization + scoring |

### Infrastructure

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | API health check (`?deep=true` tests DB connectivity) |

---

## Security

### Authentication
All API routes are protected by **Clerk JWT verification**. Tokens are validated server-side using `@clerk/backend`. Each authenticated request is resolved to an internal user and firm context, ensuring strict tenant isolation. In development mode, a pre-seeded dev user is used automatically.

### Encryption at Rest
Pseudonym mappings -- the link between real and fake data -- are encrypted using **AES-256-GCM** before database storage. Each firm has a unique PBKDF2-derived encryption key (100,000 iterations, SHA-256, 128-bit salt). Keys are non-extractable `CryptoKey` objects that never leave the Web Crypto runtime.

### Data Minimization
- **Prompt text is never stored.** Only a SHA-256 hash and character length are persisted in the audit log.
- **Original entity values are never persisted to the database.** Pseudonym maps store only the hash of the original, the pseudonym, and the entity type -- all encrypted.
- **Pseudonym sessions expire** after 60 minutes (configurable per firm).

### Rate Limiting
Per-user rate limiting (300 requests/minute) is enforced on all authenticated routes, with `X-RateLimit-*` headers returned on every response.

### CORS
The API enforces strict origin allowlisting. Only the dashboard origin, the registered Chrome extension ID, and explicit development origins are permitted.

---

## Compliance Considerations

### ABA Model Rule 1.6 (Confidentiality of Information)
Iron Gate is designed to help law firms satisfy their obligation under **ABA Model Rule 1.6(c)** to "make reasonable efforts to prevent the inadvertent or unauthorized disclosure of, or unauthorized access to, information relating to the representation of a client." By detecting and pseudonymizing client-identifying information before it reaches third-party AI services, Iron Gate provides a technical control that supports compliance with this duty.

### Data Minimization & Security Controls
The architecture incorporates security best practices:
- **Encryption at rest** (AES-256-GCM) for all sensitive stored data
- **Append-only audit log** for every AI interaction across the firm
- **Tenant isolation** with firm-scoped access controls
- **Rate limiting** and authentication on all API endpoints
- **No raw prompt text is persisted** -- only hashes and metadata

### HIPAA-Aware Detection
For firms handling healthcare clients, the Executive Lens includes detection of Protected Health Information (PHI) patterns and can route flagged content to private infrastructure to help limit PHI exposure to external AI services. This is not a substitute for a comprehensive HIPAA compliance program.

---

## Development

```bash
# Run all tests
pnpm test

# Run detection service tests
pnpm test:detection

# Run end-to-end tests
pnpm test:e2e

# Lint all packages
pnpm lint

# Format code
pnpm format

# Open Drizzle Studio (database GUI)
pnpm db:studio

# Run the full stack via Docker Compose
docker compose -f infra/docker/docker-compose.yml up --build
```

---

## License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2025 Iron Gate

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
