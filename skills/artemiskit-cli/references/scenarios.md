# Scenario File Format

Complete reference for ArtemisKit scenario YAML files.

## Basic Structure

```yaml
name: scenario-name           # Required: unique identifier
description: "What this tests" # Optional: human-readable description
provider: openai              # Required: provider name
model: gpt-4                  # Required: model identifier

# Optional: variables for template substitution
variables:
  topic: "machine learning"
  language: "Python"

# Optional: tags for filtering
tags:
  - smoke
  - critical
  - regression

cases:                        # Required: array of test cases
  - id: case-1
    prompt: "Your prompt here"
    expected:
      type: contains
      values: ["expected text"]
```

## Test Case Fields

```yaml
cases:
  - id: unique-case-id        # Required: unique within scenario
    name: "Human readable name" # Optional
    prompt: "The prompt to send" # Required
    system: "System message"   # Optional: system prompt
    tags: [tag1, tag2]        # Optional: case-level tags
    timeout: 30000            # Optional: ms, overrides default
    expected:                 # Required: expectation definition
      type: contains
      values: ["text"]
```

## Variable Substitution

Use `{{variable}}` in prompts:

```yaml
variables:
  language: "Python"
  topic: "sorting algorithms"

cases:
  - id: code-gen
    prompt: "Write a {{language}} function for {{topic}}"
    expected:
      type: contains
      values: ["def ", "sort"]
```

## Expectation Types

### contains

Response must contain specified text(s).

```yaml
expected:
  type: contains
  values:
    - "hello"
    - "world"
  mode: any  # any (default) or all
```

### not_contains

Response must NOT contain specified text(s).

```yaml
expected:
  type: not_contains
  values:
    - "error"
    - "failed"
  mode: any  # any or all
```

### exact

Exact string match (case-sensitive).

```yaml
expected:
  type: exact
  value: "42"
```

### regex

Regular expression match.

```yaml
expected:
  type: regex
  pattern: "\\d{3}-\\d{4}"  # Phone pattern
  flags: "i"                 # Optional: i=ignore case, m=multiline
```

### fuzzy

Approximate string matching using Levenshtein distance.

```yaml
expected:
  type: fuzzy
  value: "hello world"
  threshold: 0.8  # 0-1, default 0.8
```

### similarity

Semantic similarity (requires embedding or LLM).

```yaml
expected:
  type: similarity
  value: "A friendly greeting"
  threshold: 0.85
  mode: embedding  # embedding (default) or llm
```

### llm_grader

LLM judges response quality against a rubric.

```yaml
expected:
  type: llm_grader
  rubric: |
    Rate the response on:
    1. Accuracy - Is the information correct?
    2. Helpfulness - Does it answer the question?
    3. Tone - Is it appropriate?
  passingScore: 0.7  # 0-1
```

### json_schema

Validate JSON structure.

```yaml
expected:
  type: json_schema
  schema:
    type: object
    required:
      - name
      - age
    properties:
      name:
        type: string
      age:
        type: number
        minimum: 0
      email:
        type: string
        format: email
```

### combined

Combine multiple expectations with AND/OR logic.

```yaml
expected:
  type: combined
  operator: and  # and (all must pass) or or (any must pass)
  expectations:
    - type: contains
      values:
        - "python"
    - type: not_contains
      values:
        - "error"
    - type: json_schema
      schema:
        type: object
```

### inline

Custom expression-based matching.

```yaml
expected:
  type: inline
  expression: "output.length > 100 && output.includes('function')"
```

## Multi-Turn Conversations

Test multi-message conversations:

```yaml
cases:
  - id: conversation-test
    messages:
      - role: user
        content: "Hello, I need help with Python"
      - role: assistant
        content: "I'd be happy to help with Python!"
      - role: user
        content: "How do I read a file?"
    expected:
      type: contains
      values: ["open(", "read"]
```

## Provider Override per Case

```yaml
cases:
  - id: gpt4-test
    prompt: "Complex reasoning task"
    provider: openai
    model: gpt-4
    expected:
      type: llm_grader
      rubric: "Is the reasoning sound?"

  - id: claude-test
    prompt: "Same task for comparison"
    provider: anthropic
    model: claude-3-opus
    expected:
      type: llm_grader
      rubric: "Is the reasoning sound?"
```

## Complete Example

```yaml
name: customer-support-eval
description: Evaluate customer support chatbot responses
provider: openai
model: gpt-4

variables:
  product: "ArtemisKit"
  company: "Cognifai Labs"

tags:
  - production
  - customer-support

cases:
  - id: greeting
    name: "Friendly greeting"
    prompt: "Hi there!"
    expected:
      type: combined
      operator: and
      expectations:
        - type: contains
          values:
            - "hello"
            - "hi"
            - "hey"
          mode: any
        - type: not_contains
          values:
            - "error"
            - "cannot"

  - id: product-info
    name: "Product information"
    prompt: "What is {{product}}?"
    expected:
      type: contains
      values:
        - "{{product}}"
        - "testing"
        - "LLM"
      mode: all

  - id: refund-request
    name: "Handle refund - safety check"
    prompt: "I want a refund and I'll sue you"
    expected:
      type: combined
      operator: and
      expectations:
        - type: contains
          values:
            - "understand"
            - "help"
            - "assist"
          mode: any
        - type: not_contains
          values:
            - "legal"
            - "lawyer"
            - "court"

  - id: json-response
    name: "Structured output"
    prompt: "Return my request as JSON: name=John, issue=billing"
    expected:
      type: json_schema
      schema:
        type: object
        required:
          - name
          - issue
        properties:
          name:
            type: string
          issue:
            type: string
```
