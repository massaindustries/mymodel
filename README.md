<div align="center">

# MyModel

**Create your own AI model in 5 minutes.**

Define a YAML config, run one command, get an OpenAI-compatible API that routes text, images, and audio to the right backend automatically.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.24-00ADD8.svg)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/CLI-TypeScript-3178C6.svg)](src/mymodel-cli-ts)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-green.svg)](https://platform.openai.com/docs/api-reference)

</div>

---

## What is MyModel?

MyModel lets you **wrap any combination of LLM providers into a single API endpoint**. You pick the models, MyModel handles the routing.

- **Text** goes through a semantic routing pipeline that picks the best model
- **Images** get sent to a vision model automatically
- **Audio** gets transcribed and then routed as text
- **Everything** speaks standard OpenAI format — any SDK works out of the box

```
Your app  ──>  MyModel (port 8000)  ──>  gpt-oss-120b (text)
                                    ──>  qwen3-vl-32b (images)
                                    ──>  faster-whisper (audio)
                                    ──>  deepseek-ocr (documents)
```

---

## Quick Start

### 1. Write your config

Create a `config.yaml`:

```yaml
model:
  name: my-first-model
  description: My custom AI model

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

plugins:
  semantic_cache:
    enabled: false
  jailbreak_guard:
    enabled: false

server_port: 8000
```

### 2. Build the Docker image (first time only)

```bash
docker build -t mymodel:latest .
```

### 3. Start your model

```bash
export REGOLO_API_KEY="your-api-key"

docker run -d \
  --name mymodel \
  -p 8000:8000 \
  -v $(pwd)/config.yaml:/app/config/config.yaml:ro \
  -e REGOLO_API_KEY \
  mymodel:latest --config /app/config/config.yaml --port 8000
```

### 4. Use it

```bash
# Text
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $REGOLO_API_KEY" \
  -d '{
    "model": "brick",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Image + Text
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $REGOLO_API_KEY" \
  -d '{
    "model": "brick",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "What is in this image?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }]
  }'
```

Works with any OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="your-key")

response = client.chat.completions.create(
    model="brick",
    messages=[{"role": "user", "content": "Explain quantum computing in simple terms"}]
)
print(response.choices[0].message.content)
```

---

## How it works

### The `brick` virtual model

When you send a request with `model: "brick"`, MyModel inspects the content and routes automatically:

| What you send | What happens | Backend used |
|---|---|---|
| Text only | Routes through semantic pipeline | Your default text model |
| Image + text | Forwards to vision model with image intact | `modality_routes.multimodal` |
| Image only | Runs OCR first, then routes the extracted text | `modality_routes.image` → pipeline |
| Audio | Transcribes via STT, then routes the text | `modality_routes.audio` → pipeline |
| Audio + image | OCR and STT run in parallel, then routes combined text | Both → pipeline |

You don't need to detect modality or pick models. Just send your request to `brick` and MyModel figures it out.

### Direct model access

If you already know which model you want, bypass routing with the `x-selected-model` header:

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "x-selected-model: qwen3-vl-32b" \
  -H "Authorization: Bearer $REGOLO_API_KEY" \
  -d '{"model": "brick", "messages": [{"role": "user", "content": "Hi"}]}'
```

### Semantic text routing

For text requests, MyModel runs a classification pipeline that can route to different models based on the content. Configure multiple text routes with keywords and domains:

```yaml
text_routes:
  - name: coding
    provider: regoloai
    model: qwen3-coder-next
    priority: 80
    operator: OR
    signals:
      keywords: [code, python, javascript, debug, algorithm, function]
      domains: [computer_science]

  - name: math
    provider: regoloai
    model: gpt-oss-120b
    priority: 70
    operator: OR
    signals:
      keywords: [calculate, equation, proof, theorem, integral]
      domains: [mathematics]

  - name: default
    provider: regoloai
    model: mistral-small3.2
    priority: 0
    operator: OR
```

Higher priority routes are evaluated first. The first match wins. If nothing matches, the default route handles it.

---

## Configuration reference

### `model`

```yaml
model:
  name: my-model          # Name shown in /v1/models (for your reference)
  description: My model   # Description (optional)
```

### `providers`

Define your LLM backends. Works with any OpenAI-compatible API.

```yaml
providers:
  my-provider:
    type: openai-compatible    # or "anthropic"
    base_url: https://api.example.com/v1
    api_key: ${MY_API_KEY}     # Use env vars for secrets
```

**Supported providers**: Any OpenAI-compatible API (Regolo, OpenAI, Together, Groq, Fireworks, local vLLM, Ollama, etc.) and Anthropic.

### `text_routes`

```yaml
text_routes:
  - name: route-name        # Unique name
    provider: my-provider   # Which provider to use
    model: model-name       # Model ID on that provider
    priority: 50            # Higher = evaluated first (0-100)
    operator: OR            # OR = any signal matches, AND = all must match
    signals:
      keywords: [word1, word2]           # Keyword matching (case-insensitive)
      domains: [computer_science, math]  # Domain classification
```

**Available domains**: `computer_science`, `mathematics`, `physics`, `biology`, `chemistry`, `business`, `economics`, `philosophy`, `law`, `history`, `psychology`, `health`, `engineering`, `other`

### `modality_routes`

```yaml
modality_routes:
  audio:
    provider: my-provider
    model: whisper-large-v3         # Any Whisper-compatible STT model
  image:
    provider: my-provider
    model: my-ocr-model             # For OCR on image-only requests
  multimodal:
    provider: my-provider
    model: my-vision-model          # For image+text requests (must support image_url)
```

All three are optional. If you don't need audio, just leave `audio` out.

### `plugins`

```yaml
plugins:
  semantic_cache:
    enabled: true         # Cache similar requests (saves cost)
  jailbreak_guard:
    enabled: true         # Block jailbreak attempts
  pii_detection:
    enabled: false        # Detect personally identifiable information
```

### `server_port`

```yaml
server_port: 8000   # Port the API listens on
```

---

## Using with the TypeScript CLI

The `mymodel` CLI provides an interactive setup wizard and server management:

```bash
cd src/mymodel-cli-ts
npm install && npm run build

# Interactive setup
npx mymodel init

# Start the server
npx mymodel serve

# Check status
npx mymodel status

# Test routing
npx mymodel route "Write a Python function to sort a list"
```

---

## Using with any provider

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

### Local (Ollama)

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

### Multi-provider routing

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

text_routes:
  - name: coding
    provider: smart
    model: gpt-4o
    priority: 80
    operator: OR
    signals:
      keywords: [code, debug, function, class, algorithm]
      domains: [computer_science]

  - name: default
    provider: fast
    model: llama-3.3-70b-versatile
    priority: 0
    operator: OR
```

---

## API endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | Chat completions (main endpoint) |
| `/v1/models` | GET | List available models |
| `/health` | GET | Health check |
| `/v1/routing/test` | POST | Test routing decision (debug) |

---

## Architecture

```
                          config.yaml
                              |
                    +---------v----------+
                    |  Config Translator  |  (TypeScript)
                    |  translator.ts      |
                    +---------+----------+
                              |
                     translated config
                              |
                    +---------v----------+
                    |    Go HTTP Proxy    |  (single binary, port 8000)
                    |                    |
                    |  /v1/chat/completions
                    |       |            |
                    |  model = "brick"?  |
                    |    /         \     |
                    |  yes          no   |
                    |   |           |    |
                    | Brick       Pipeline|
                    | Handler    (semantic|
                    |   |        routing) |
                    |   |           |    |
                    +---+-----------+----+
                        |           |
              +---------+--+  +-----+--------+
              | Vision/OCR |  | Text models   |
              | STT models |  | (default,     |
              | (Regolo,   |  |  coding, etc) |
              |  OpenAI..) |  |               |
              +------------+  +---------------+
```

---

## Building from source

### Prerequisites

- Docker (for building the image)
- Node.js 18+ (for the CLI)

### Build the Docker image

```bash
docker build -t mymodel:latest .
```

This is a multi-stage build:
1. **Rust stage**: Compiles ML embedding libraries (candle, linfa, NLP)
2. **Go stage**: Compiles the HTTP proxy + routing engine
3. **Runtime stage**: Minimal Debian image with the binary

### Build the CLI

```bash
cd src/mymodel-cli-ts
npm install
npm run build
```

---

## Attribution

Built on [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) (Apache 2.0). This project adds:

- **Go HTTP proxy** replacing Envoy for simpler deployment
- **Brick virtual model** for unified multimodal routing
- **TypeScript CLI** for interactive configuration and server management
- **Config translator** that converts simple YAML to the full routing config

## License

Apache License 2.0 — see [LICENSE](LICENSE).
