# Provider Configuration

Complete reference for configuring LLM providers with ArtemisKit.

## Supported Providers

| Provider | ID | Description |
|----------|-----|-------------|
| OpenAI | `openai` | OpenAI API (GPT-4, GPT-3.5, etc.) |
| Anthropic | `anthropic` | Anthropic Claude models |
| Azure OpenAI | `azure-openai` | Azure-hosted OpenAI models |
| Vercel AI SDK | `vercel-ai` | Vercel AI SDK integration |
| OpenAI-Compatible | `openai-compatible` | Ollama, vLLM, LM Studio, etc. |

## OpenAI

### Environment Variables

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_ORG_ID=org-...       # Optional
export OPENAI_BASE_URL=https://... # Optional: custom endpoint
```

### Config File

```yaml
# artemis.config.yaml
provider: openai
model: gpt-4

providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
    organization: ${OPENAI_ORG_ID}  # Optional
    baseUrl: https://api.openai.com/v1  # Optional
    timeout: 60000  # ms
```

### Scenario Override

```yaml
# scenario.yaml
provider: openai
model: gpt-4-turbo-preview

providerConfig:
  temperature: 0.7
  maxTokens: 2000
```

### Available Models

- `gpt-4`, `gpt-4-turbo-preview`, `gpt-4-0125-preview`
- `gpt-3.5-turbo`, `gpt-3.5-turbo-0125`
- `gpt-4o`, `gpt-4o-mini`

---

## Anthropic

### Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Config File

```yaml
provider: anthropic
model: claude-3-opus-20240229

providers:
  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    timeout: 120000
```

### Scenario Override

```yaml
provider: anthropic
model: claude-3-sonnet-20240229

providerConfig:
  temperature: 0.5
  maxTokens: 4096
```

### Available Models

- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`
- `claude-3-5-sonnet-20241022`

---

## Azure OpenAI

### Environment Variables

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_RESOURCE_NAME=my-resource
export AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4-deployment
export AZURE_OPENAI_API_VERSION=2024-02-01  # Optional
```

### Config File

```yaml
provider: azure-openai
model: gpt-4  # Deployment name

providers:
  azure-openai:
    apiKey: ${AZURE_OPENAI_API_KEY}
    resourceName: ${AZURE_OPENAI_RESOURCE_NAME}
    deploymentName: ${AZURE_OPENAI_DEPLOYMENT_NAME}
    apiVersion: "2024-02-01"
```

### Scenario Override

```yaml
provider: azure-openai
model: my-gpt4-deployment

providerConfig:
  resourceName: my-azure-resource
  deploymentName: my-gpt4-deployment
```

---

## Vercel AI SDK

For projects using Vercel AI SDK.

### Environment Variables

Set the underlying provider's API key:

```bash
export OPENAI_API_KEY=sk-...
# or
export ANTHROPIC_API_KEY=sk-ant-...
```

### Config File

```yaml
provider: vercel-ai
model: gpt-4

providers:
  vercel-ai:
    provider: openai  # Underlying provider
```

---

## OpenAI-Compatible

For local models (Ollama, vLLM, LM Studio) or third-party APIs.

### Environment Variables

```bash
export OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1
export OPENAI_COMPATIBLE_API_KEY=optional-key  # If required
```

### Config File

```yaml
provider: openai-compatible
model: llama2

providers:
  openai-compatible:
    baseUrl: http://localhost:11434/v1
    apiKey: ${OPENAI_COMPATIBLE_API_KEY}  # Optional
```

### Ollama Example

```bash
# Start Ollama
ollama serve

# Pull a model
ollama pull llama2
```

```yaml
provider: openai-compatible
model: llama2

providers:
  openai-compatible:
    baseUrl: http://localhost:11434/v1
```

### vLLM Example

```bash
# Start vLLM server
python -m vllm.entrypoints.openai.api_server \
  --model mistralai/Mistral-7B-Instruct-v0.1 \
  --port 8000
```

```yaml
provider: openai-compatible
model: mistralai/Mistral-7B-Instruct-v0.1

providers:
  openai-compatible:
    baseUrl: http://localhost:8000/v1
```

### LM Studio Example

```yaml
provider: openai-compatible
model: local-model

providers:
  openai-compatible:
    baseUrl: http://localhost:1234/v1
```

---

## Configuration Priority

Settings are resolved in this order (highest to lowest):

1. **CLI flags**: `--provider openai --model gpt-4`
2. **Scenario file**: `provider:` and `model:` fields
3. **Config file**: `artemis.config.yaml`
4. **Environment variables**: `OPENAI_API_KEY`, etc.
5. **Defaults**: OpenAI, gpt-4

---

## Complete Config Example

```yaml
# artemis.config.yaml

# Default provider and model
provider: openai
model: gpt-4

# Provider configurations
providers:
  openai:
    apiKey: ${OPENAI_API_KEY}
    timeout: 60000

  anthropic:
    apiKey: ${ANTHROPIC_API_KEY}
    timeout: 120000

  azure-openai:
    apiKey: ${AZURE_OPENAI_API_KEY}
    resourceName: my-azure-resource
    deploymentName: gpt-4-deployment
    apiVersion: "2024-02-01"

  openai-compatible:
    baseUrl: http://localhost:11434/v1

# Output settings
output:
  dir: ./artemis-runs
  format: json

# Storage settings
storage:
  type: local  # or 'supabase'

# Default test settings
defaults:
  timeout: 60000
  retries: 2
  concurrency: 5

# Redaction settings (PII protection)
redaction:
  enabled: true
  patterns:
    - email
    - phone
    - api_key
    - credit_card
```

---

## Troubleshooting

### API Key Issues

```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Test with curl
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Timeout Errors

Increase timeout in config:

```yaml
providers:
  openai:
    timeout: 120000  # 2 minutes
```

### Rate Limiting

Reduce concurrency:

```bash
akit run scenarios/ --concurrency 2
```

### Local Model Connection

Verify the server is running:

```bash
curl http://localhost:11434/v1/models
```
