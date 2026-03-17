<div align="center">

![MyModel](https://readme-typing-svg.demolab.com?font=Fira+Code&size=24&pause=1000&color=FFFFFF&center=true&vCenter=true&width=435&lines=MYMODEL)

```text
      ___           ___           ___           ___           ___           ___           ___
     /\__\         |\__\         /\__\         /\  \         /\  \         /\  \         /\__\
    /::|  |        |:|  |       /::|  |       /::\  \       /::\  \       /::\  \       /:/  /
   /:|:|  |        |:|  |      /:|:|  |      /:/\:\  \     /:/\:\  \     /:/\:\  \     /:/  /
  /:/|:|__|__      |:|__|__   /:/|:|__|__   /:/  \:\  \   /:/  \:\__\   /::\~\:\  \   /:/  /
 /:/ |::::\__\     /::::\__\ /:/ |::::\__\ /:/__/ \:\__\ /:/__/ \:|__| /:/\:\ \:\__\ /:/__/
 \/__/~~/:/  /    /:/~~/~    \/__/~~/:/  / \:\  \ /:/  / \:\  \ /:/  / \:\~\:\ \/__/ \:\  \
       /:/  /    /:/  /            /:/  /   \:\  /:/  /   \:\  /:/  /   \:\ \:\__\    \:\  \
      /:/  /     \/__/            /:/  /     \:\/:/  /     \:\/:/  /     \:\ \/__/     \:\  \
     /:/  /                      /:/  /       \::/  /       \::/__/       \:\__\        \:\__\
     \/__/                       \/__/         \/__/         ~~            \/__/         \/__/
```

# MyModel

**Create your own AI model in 5 minutes.**

One YAML file. Any provider. Text, images, audio — all through a single endpoint.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8.svg)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/CLI-TypeScript-3178C6.svg)](src/mymodel-cli-ts)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-green.svg)](https://platform.openai.com/docs/api-reference)

</div>

---

## What is MyModel?

MyModel wraps **any LLM provider** into a single OpenAI-compatible API. You write a config, MyModel handles everything else: routing, multimodal detection, model selection.

Works with **OpenAI, Anthropic, Groq, Together, Fireworks, Regolo, Ollama, local vLLM** — anything that speaks OpenAI format.

```
                                         ┌─ gpt-4o (coding questions)
Your app ──> MyModel ──> brick ──────────┼─ llama-3.3-70b (general chat)
             :8000       (auto-routes)   ├─ gpt-4o-vision (images)
                                         └─ whisper-large-v3 (audio)
```

- **Text** routes to the best model based on content (keywords, domains, complexity)
- **Images** go to a vision model automatically
- **Audio** gets transcribed then routed as text
- **Any OpenAI SDK** works — no client changes needed

---

## Quick Start

### 1. Write a config

```yaml
model:
  name: my-assistant

providers:
  openai:
    type: openai-compatible
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}

text_routes:
  - name: default
    provider: openai
    model: gpt-4o-mini
    priority: 0
    operator: OR

modality_routes:
  multimodal:
    provider: openai
    model: gpt-4o

server_port: 8000
```

That's it. This creates a model called "my-assistant" that routes text to `gpt-4o-mini` and images to `gpt-4o`.

### 2. Build & run

```bash
docker build -t mymodel:latest .

export OPENAI_API_KEY="sk-..."

docker run -d --name mymodel -p 8000:8000 \
  -v $(pwd)/config.yaml:/app/config/config.yaml:ro \
  -e OPENAI_API_KEY \
  mymodel:latest --config /app/config/config.yaml --port 8000
```

### 3. Call it

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model": "brick", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Or with the Python SDK:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="your-key")
r = client.chat.completions.create(
    model="brick",
    messages=[{"role": "user", "content": "Explain quantum computing simply"}]
)
print(r.choices[0].message.content)
```

---

## Providers

MyModel works with any OpenAI-compatible API. Here are some examples:

### OpenAI

```yaml
providers:
  openai:
    type: openai-compatible
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
text_routes:
  - name: default
    provider: openai
    model: gpt-4o-mini
    priority: 0
    operator: OR
modality_routes:
  multimodal:
    provider: openai
    model: gpt-4o
```

### Anthropic

```yaml
providers:
  anthropic:
    type: anthropic
    base_url: https://api.anthropic.com
    api_key: ${ANTHROPIC_API_KEY}
text_routes:
  - name: default
    provider: anthropic
    model: claude-sonnet-4-20250514
    priority: 0
    operator: OR
```

### Groq (fast inference)

```yaml
providers:
  groq:
    type: openai-compatible
    base_url: https://api.groq.com/openai/v1
    api_key: ${GROQ_API_KEY}
text_routes:
  - name: default
    provider: groq
    model: llama-3.3-70b-versatile
    priority: 0
    operator: OR
```

### Together AI

```yaml
providers:
  together:
    type: openai-compatible
    base_url: https://api.together.xyz/v1
    api_key: ${TOGETHER_API_KEY}
text_routes:
  - name: default
    provider: together
    model: meta-llama/Llama-3.3-70B-Instruct-Turbo
    priority: 0
    operator: OR
```

### Fireworks AI

```yaml
providers:
  fireworks:
    type: openai-compatible
    base_url: https://api.fireworks.ai/inference/v1
    api_key: ${FIREWORKS_API_KEY}
text_routes:
  - name: default
    provider: fireworks
    model: accounts/fireworks/models/llama-v3p3-70b-instruct
    priority: 0
    operator: OR
```

### Regolo AI

```yaml
providers:
  regoloai:
    type: openai-compatible
    base_url: https://api.regolo.ai/v1
    api_key: ${REGOLO_API_KEY}
text_routes:
  - name: default
    provider: regoloai
    model: gpt-oss-120b
    priority: 0
    operator: OR
modality_routes:
  audio:
    provider: regoloai
    model: faster-whisper-large-v3
  image:
    provider: regoloai
    model: deepseek-ocr
  multimodal:
    provider: regoloai
    model: qwen3-vl-32b
```

### Ollama (local)

```yaml
providers:
  local:
    type: openai-compatible
    base_url: http://localhost:11434/v1
    api_key: ollama
text_routes:
  - name: default
    provider: local
    model: llama3.1
    priority: 0
    operator: OR
```

### Mix multiple providers

The real power: route different types of requests to different providers.

```yaml
providers:
  fast:
    type: openai-compatible
    base_url: https://api.groq.com/openai/v1
    api_key: ${GROQ_API_KEY}
  smart:
    type: openai-compatible
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}
  vision:
    type: openai-compatible
    base_url: https://api.openai.com/v1
    api_key: ${OPENAI_API_KEY}

text_routes:
  - name: coding
    provider: smart
    model: gpt-4o
    priority: 80
    operator: OR
    signals:
      keywords: [code, debug, function, class, algorithm, python, javascript]
      domains: [computer_science]

  - name: default
    provider: fast
    model: llama-3.3-70b-versatile
    priority: 0
    operator: OR

modality_routes:
  multimodal:
    provider: vision
    model: gpt-4o
```

This sends coding questions to GPT-4o, everything else to Llama on Groq (fast and cheap), and images to GPT-4o vision.

---

## Brick: the multimodal virtual model

Every request goes to `model: "brick"`. Brick detects what you're sending and routes it:

| What you send | What MyModel does | Where it goes |
|---|---|---|
| **Text** | Routes through semantic pipeline | Best matching text model |
| **Image + text** | Forwards with image intact | Vision model (`modality_routes.multimodal`) |
| **Image only** | Runs OCR, then routes extracted text | OCR model → text pipeline |
| **Audio** | Transcribes, then routes text | STT model → text pipeline |
| **Audio + image** | OCR + STT in parallel, routes combined text | Both → text pipeline |

You never need to pick a model. Brick picks for you.

### Direct model access

Already know which model you want? Bypass routing:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "x-selected-model: gpt-4o" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model": "brick", "messages": [{"role": "user", "content": "Hi"}]}'
```

---

## Semantic text routing

Route different questions to different models based on content:

```yaml
text_routes:
  - name: coding
    provider: smart
    model: gpt-4o
    priority: 80
    operator: OR
    signals:
      keywords: [code, python, javascript, debug, algorithm, function, class]
      domains: [computer_science]

  - name: math
    provider: smart
    model: gpt-4o
    priority: 70
    operator: OR
    signals:
      keywords: [calculate, equation, proof, theorem, integral, derivative]
      domains: [mathematics]

  - name: default
    provider: fast
    model: llama-3.3-70b-versatile
    priority: 0
    operator: OR
```

- **Priority**: higher = evaluated first (0-100)
- **Operator**: `OR` = any signal matches, `AND` = all must match
- **Keywords**: case-insensitive word matching
- **Domains**: ML-based classification into academic categories

**Available domains**: `computer_science`, `mathematics`, `physics`, `biology`, `chemistry`, `business`, `economics`, `philosophy`, `law`, `history`, `psychology`, `health`, `engineering`, `other`

---

## Configuration reference

### `model`

```yaml
model:
  name: my-model          # Your model's name
  description: My model   # Optional description
```

### `providers`

```yaml
providers:
  provider-name:
    type: openai-compatible    # or "anthropic"
    base_url: https://api.example.com/v1
    api_key: ${MY_API_KEY}     # Env vars for secrets
```

### `text_routes`

```yaml
text_routes:
  - name: route-name
    provider: provider-name
    model: model-id
    priority: 50              # 0-100, higher = first
    operator: OR              # OR or AND
    signals:                  # Optional — omit for default route
      keywords: [word1, word2]
      domains: [domain1]
```

### `modality_routes`

```yaml
modality_routes:
  audio:                      # Speech-to-text (Whisper-compatible)
    provider: my-provider
    model: whisper-large-v3
  image:                      # OCR for image-only requests
    provider: my-provider
    model: my-ocr-model
  multimodal:                 # Vision for image+text
    provider: my-provider
    model: my-vision-model
```

All optional. Add only what you need.

### `plugins`

```yaml
plugins:
  semantic_cache:
    enabled: true             # Cache similar requests
  jailbreak_guard:
    enabled: true             # Block jailbreak attempts
  pii_detection:
    enabled: false            # Detect personal information
```

### `server_port`

```yaml
server_port: 8000
```

---

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | Chat completions (main endpoint) |
| `/v1/models` | GET | List available models |
| `/health` | GET | Health check |
| `/v1/routing/test` | POST | Test a routing decision |

Standard OpenAI format. Works with any SDK or tool that supports OpenAI.

---

## TypeScript CLI

Interactive setup and server management:

```bash
cd src/mymodel-cli-ts
npm install && npm run build

npx mymodel init          # Guided config wizard
npx mymodel serve         # Start the server
npx mymodel status        # Check health
npx mymodel route "..."   # Test routing offline
npx mymodel config show   # Display current config
```

---

## Architecture

```
 config.yaml (you write this)
      |
      v
 Config Translator (TypeScript)
      |
      v
 Go HTTP Proxy (single binary, port 8000)
      |
      +-- model = "brick"?
      |     |
      |    YES ── Brick Handler
      |     |       |
      |     |      detect modality
      |     |       |
      |     |      image+text ──> vision model (direct forward)
      |     |      audio ──────> STT ──> text pipeline
      |     |      text ───────> text pipeline
      |     |
      |    NO ── direct forward to specified model
      |
      v
 Text Routing Pipeline
      |
      +-- keyword matching
      +-- domain classification
      +-- priority evaluation
      |
      v
 Selected Backend (OpenAI, Anthropic, Groq, Ollama, ...)
```

---

## Building from source

```bash
# Docker image (includes Rust ML libs + Go binary)
docker build -t mymodel:latest .

# CLI only
cd src/mymodel-cli-ts && npm install && npm run build
```

The Docker build is multi-stage: Rust (ML embeddings) → Go (proxy + router) → Debian slim runtime. Takes ~10 min first time, cached after that.

---

## Attribution

Built on [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) (Apache 2.0). This project adds the Go HTTP proxy, Brick multimodal gateway, TypeScript CLI, and config translator.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
