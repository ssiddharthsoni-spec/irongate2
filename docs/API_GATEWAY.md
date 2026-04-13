# IronGate API Gateway

**The multi-provider, OpenAI-compatible gateway for enterprise AI applications.**

IronGate's API gateway is a drop-in replacement for `api.openai.com` or
`api.anthropic.com`. Point your existing OpenAI or Anthropic SDK at IronGate's
base URL, and every request flows through detection, pseudonymization, and
compliance audit — without code changes to your application.

One endpoint. Any LLM provider. Zero prompt text stored.

---

## Why use the API gateway?

Your team is building AI features directly against OpenAI / Anthropic / Gemini.
Before each call reaches those providers, you want to:

- Detect sensitive data (PII, client names, credentials, internal IDs)
- Replace it with cryptographic stand-ins the upstream LLM can't reverse
- Get an audit trail of every AI call for compliance
- Route to different providers without rewriting your code

IronGate does all of that as a thin layer in front of any LLM provider.

---

## Quick start

### 1. Get an API key

From the IronGate admin dashboard → **Settings → API Keys → Create Key**.
You'll get a key that starts with `ig_...`.

### 2. Swap one line in your code

**Before (direct to OpenAI):**
```python
from openai import OpenAI
client = OpenAI(api_key="sk-...")
```

**After (through IronGate):**
```python
from openai import OpenAI
client = OpenAI(
    api_key="ig_...",  # your IronGate key
    base_url="https://api.irongate.ai/v1/gateway",
)
```

That's it. The rest of your code is unchanged.

### 3. Your existing code now flows through IronGate

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "Summarize this: Client Sarah Johnson..."}
    ],
)
print(response.choices[0].message.content)
```

**What happened:**
1. IronGate received the request with `"Sarah Johnson"` in it
2. Detection identified `Sarah Johnson` as a PERSON entity
3. Pseudonymization replaced it with a deterministic fake (e.g., `Emily Rogers`)
4. IronGate forwarded to OpenAI with the sanitized text
5. OpenAI returned a response using `Emily Rogers`
6. IronGate de-pseudonymized the response back to `Sarah Johnson` before returning to you
7. An audit event was logged (anonymized — no prompt text stored)

Your code sees `Sarah Johnson` in the final response. OpenAI's servers never saw `Sarah Johnson`.

---

## Endpoints

### `POST /v1/gateway/chat/completions`

OpenAI-compatible endpoint. Works with every OpenAI SDK (Python `openai`, Node `openai`, `openai-node`, LangChain's `ChatOpenAI`, Vercel AI SDK, etc.).

**Supported models** (routing is automatic based on model name):

| Model | Provider |
|---|---|
| `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o3` | OpenAI |
| `claude-sonnet-4-20250514`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` | Anthropic |
| `gemini-2.5-flash`, `gemini-2.5-pro` | Google |
| `llama-*`, `mistral-*`, `phi-*` | Ollama (if configured) |

**Request:** Standard OpenAI chat completions format.

**Response:** Standard OpenAI chat completions format, with an additional
`irongate` field containing IronGate-specific metadata:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{ "message": { "role": "assistant", "content": "..." }}],
  "usage": { "prompt_tokens": 42, "completion_tokens": 120, "total_tokens": 162 },
  "irongate": {
    "sensitivity_level": "high",
    "sensitivity_score": 72,
    "entity_categories": ["PERSON", "SSN"],
    "entity_count": 2,
    "route": "cloud_masked",
    "provider": "openai",
    "latency_ms": 1847
  }
}
```

### `POST /v1/gateway/messages`

Anthropic-compatible endpoint. Works with every Anthropic SDK (Python `anthropic`, Node `@anthropic-ai/sdk`, LangChain's `ChatAnthropic`, etc.).

**Request:** Standard Anthropic messages format.

**Response:** Standard Anthropic messages format, with the same `irongate`
metadata block attached.

### `GET /v1/gateway/models`

OpenAI-compatible models list. Returns the currently supported models across
all upstream providers. Useful for SDK auto-completion and UI pickers.

---

## Authentication

All requests require a Bearer token:

```
Authorization: Bearer ig_your_irongate_key
```

IronGate validates the key, looks up the firm, and uses the firm's stored
provider credentials (OpenAI / Anthropic / Gemini) to make the upstream call.
Your application never needs to manage upstream API keys — they're configured
once in the admin dashboard.

---

## How routing works

IronGate is multi-provider by design. The `model` field in your request
determines which upstream LLM gets the call:

```python
# Call OpenAI
client.chat.completions.create(model="gpt-4o", messages=[...])

# Call Anthropic
client.chat.completions.create(model="claude-sonnet-4-20250514", messages=[...])

# Call Google
client.chat.completions.create(model="gemini-2.5-flash", messages=[...])

# Call local Ollama
client.chat.completions.create(model="llama-3.3", messages=[...])
```

Same code, same SDK. Just change the model name. IronGate handles:
- Request format translation (OpenAI format → Anthropic format when the model is Claude)
- Upstream authentication (uses your firm's configured credentials)
- Response format normalization (always returns OpenAI-compatible shape)

---

## What IronGate does for every request

```
┌───────────────────────────────────────────────────────────────┐
│ 1. Receive your request (OpenAI or Anthropic format)          │
│ 2. Authenticate with your IronGate API key                    │
│ 3. Run detection pipeline on the prompt                        │
│    (regex + firm plugins + client matter matching + scoring)   │
│ 4. If sensitive data found: pseudonymize                       │
│    (cryptographically derived fakes, deterministic per firm)   │
│ 5. Route to upstream provider based on `model` field           │
│ 6. Forward the sanitized request                               │
│ 7. Receive upstream response                                   │
│ 8. De-pseudonymize in the response                             │
│ 9. Record anonymized audit event (no prompt text ever stored)  │
│ 10. Return the final response to you                           │
└───────────────────────────────────────────────────────────────┘
```

Latency added: typically 50-200ms on top of the upstream provider's own
response time.

---

## Configuration (admin dashboard)

The firm admin configures once via the IronGate dashboard:

1. **Provider credentials** — Your OpenAI / Anthropic / Google API keys
   (stored encrypted, used only for upstream forwarding)
2. **Detection policy** — Which entity categories to block / warn / pseudonymize
3. **Default cloud provider** — Which provider handles model-agnostic requests
4. **Allowed models** — Restrict which upstream models can be called (optional)
5. **Rate limits** — Per-firm call budget (default: 500/day, configurable)

Your application code doesn't change when admins tweak these. They take effect
on the next request.

---

## What's NOT supported yet

| Feature | Status | Coming |
|---|---|---|
| **Streaming responses** (SSE) | Not supported — `stream: true` returns 400 | v0.3.0 |
| **Function calling / tools** | Pass-through only — IronGate doesn't inspect tool args yet | v0.3.0 |
| **Vision / multimodal** | Image inputs are not scanned for PII | v0.4.0 |
| **Embeddings endpoint** | Coming soon at `/v1/gateway/embeddings` | v0.3.0 |
| **Fine-tuned models** | Supported via direct upstream passthrough | available now |

---

## Complete example — Python + OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="ig_live_...",
    base_url="https://api.irongate.ai/v1/gateway",
)

# Call GPT-4o
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful legal assistant."},
        {"role": "user", "content": (
            "Draft a settlement letter for Robert Johnson, SSN 423-55-8901, "
            "seeking $4.2M in damages vs Acme Corp."
        )},
    ],
)

print(response.choices[0].message.content)
print("---")
print(f"IronGate detected: {response.irongate.entity_categories}")
print(f"Sensitivity: {response.irongate.sensitivity_level}")
print(f"Provider used: {response.irongate.provider}")

# Switch to Claude — same code, change the model
response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "Same prompt as above..."}],
)
```

---

## Complete example — Node + Anthropic SDK

```javascript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "ig_live_...",
  baseURL: "https://api.irongate.ai/v1/gateway",
});

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "Summarize this contract..." },
  ],
});

console.log(response.content[0].text);
console.log("Sensitivity:", response.irongate.sensitivity_level);
```

---

## Complete example — LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    api_key="ig_live_...",
    base_url="https://api.irongate.ai/v1/gateway",
    model="gpt-4o",
)

# Use exactly as before — every call flows through IronGate
response = llm.invoke("Summarize this client matter...")
```

---

## Pricing

- **Basic plan:** Up to 10,000 gateway requests/month included
- **Pro plan:** Up to 100,000 requests/month, pay-as-you-go above
- **Enterprise:** Unlimited, with SLA and dedicated infrastructure

See [pricing](https://irongate.ai/pricing) or contact sales@irongate.ai.

---

## Support

- **API reference:** https://irongate.ai/docs/gateway
- **Status page:** https://status.irongate.ai
- **Issues:** support@irongate.ai
- **Security:** security@irongate.ai
