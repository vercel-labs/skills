# CLI Command Reference

Complete reference for all ArtemisKit CLI commands.

## Global Options

Available on all commands:

```
--help, -h       Show help
--version, -v    Show version
--verbose        Verbose output
--quiet, -q      Minimal output
```

---

## akit run

Execute scenario-based evaluations.

```bash
akit run <scenario> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `scenario` | Path to scenario file or directory (supports globs) |

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--provider` | `-p` | LLM provider (openai, anthropic, azure-openai, vercel-ai) | From config |
| `--model` | `-m` | Model name/identifier | From config |
| `--parallel` | | Number of scenarios to run concurrently | sequential |
| `--concurrency` | `-c` | Max concurrent test cases per scenario | 1 |
| `--tags` | `-t` | Filter by tags (space-separated) | All |
| `--timeout` | | Timeout per case in ms | |
| `--retries` | | Retry count on failure | |
| `--save` | | Persist results to storage | true |
| `--ci` | | CI mode (machine output, no colors) | false |
| `--output` | `-o` | Output directory | |
| `--baseline` | | Compare against stored baseline | false |
| `--threshold` | | Regression threshold (0-1) | 0.05 |
| `--budget` | | Maximum budget in USD | |
| `--export` | | Export format (markdown, junit) | |
| `--export-output` | | Output directory for exports | ./artemis-exports |
| `--interactive` | `-i` | Interactive mode for scenario/provider selection | false |
| `--summary` | | Summary format (json, text, security) | text |
| `--verbose` | `-v` | Verbose output | false |
| `--config` | | Path to config file | |
| `--redact` | | Enable PII/sensitive data redaction | false |
| `--redact-patterns` | | Custom redaction patterns | |

### Examples

```bash
# Single scenario
akit run tests/math.yaml

# Directory with glob
akit run "scenarios/**/*.yaml"

# With provider override
akit run scenario.yaml --provider anthropic --model claude-3-opus

# Parallel execution with tags
akit run scenarios/ --parallel 3 --tags smoke critical

# CI pipeline with baseline comparison
akit run scenarios/ --ci --save --baseline --threshold 0.10

# With budget limit
akit run scenarios/ --budget 5.00 --save
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 2 | Configuration/runtime error |

---

## akit redteam

Security red team testing for LLM vulnerabilities.

```bash
akit redteam <scenario> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `scenario` | Path to scenario YAML file |

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--provider` | `-p` | LLM provider | From config |
| `--model` | `-m` | Model to test | From config |
| `--mutations` | | Mutation techniques (space-separated) | none |
| `--count` | `-c` | Number of mutated prompts per case | 5 |
| `--custom-attacks` | | Path to custom attacks YAML | |
| `--attack-config` | | Path to attack configuration YAML | |
| `--owasp` | | OWASP categories (e.g., LLM01 LLM05) | |
| `--owasp-full` | | Run full OWASP LLM Top 10 scan | false |
| `--min-severity` | | Minimum severity (low, medium, high, critical) | |
| `--agent-detection` | | Agent detection mode (trace, response, combined) | |
| `--save` | | Persist results | false |
| `--output` | `-o` | Output directory | |
| `--export` | | Export format (markdown, junit) | |
| `--export-output` | | Output directory for exports | ./artemis-exports |
| `--verbose` | `-v` | Verbose output | false |
| `--config` | | Path to config file | |
| `--redact` | | Enable PII redaction | false |
| `--redact-patterns` | | Custom redaction patterns | |

### Mutations

| Mutation | Description |
|----------|-------------|
| `typo` | Typo-based evasion |
| `role-spoof` | Role spoofing attacks |
| `instruction-flip` | Instruction reversal |
| `cot-injection` | Chain-of-thought injection |
| `encoding` | Base64, ROT13, hex, unicode obfuscation |
| `multi-turn` | Multi-message attack sequences |
| `bad-likert-judge` | Bad Likert judge attacks |
| `crescendo` | Gradual escalation attacks |
| `deceptive-delight` | Deceptive delight attacks |
| `output-injection` | Output injection attacks |
| `excessive-agency` | Excessive agency exploitation |
| `system-extraction` | System prompt extraction |
| `hallucination-trap` | Hallucination triggers |

### OWASP Categories

| Category | Description |
|----------|-------------|
| `LLM01` | Prompt Injection |
| `LLM02` | Insecure Output Handling |
| `LLM03` | Training Data Poisoning |
| `LLM04` | Model Denial of Service |
| `LLM05` | Supply Chain Vulnerabilities |
| `LLM06` | Sensitive Information Disclosure |
| `LLM07` | Insecure Plugin Design |
| `LLM08` | Excessive Agency |
| `LLM09` | Overreliance |
| `LLM10` | Model Theft |

### Examples

```bash
# Basic red team with scenario
akit redteam scenario.yaml

# With specific mutations
akit redteam scenario.yaml --mutations typo role-spoof encoding

# OWASP compliance scan
akit redteam scenario.yaml --owasp-full --save

# Targeted OWASP categories
akit redteam scenario.yaml --owasp LLM01 LLM06 --min-severity high

# With attack configuration file
akit redteam scenario.yaml --attack-config attacks.yaml

# Full security audit
akit redteam scenario.yaml \
  --mutations encoding multi-turn cot-injection \
  --count 10 \
  --save \
  --export markdown
```

### Attack Config YAML

```yaml
# attacks.yaml - Fine-grained mutation control
mutations:
  encoding:
    enabled: true
    types: [base64, rot13, hex]
  multi-turn:
    enabled: true
    maxTurns: 5
  cot-injection:
    enabled: true

severity:
  minimum: medium
```

---

## akit stress

Load and stress testing for LLM endpoints.

```bash
akit stress <scenario> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `scenario` | Path to scenario YAML file |

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--provider` | `-p` | LLM provider | From config |
| `--model` | `-m` | Model to test | From config |
| `--requests` | `-n` | Total requests to make | |
| `--duration` | `-d` | Duration in seconds | 30 |
| `--concurrency` | `-c` | Concurrent requests | 10 |
| `--ramp-up` | | Ramp-up time in seconds | 5 |
| `--save` | | Persist results | false |
| `--output` | `-o` | Output directory | |
| `--verbose` | `-v` | Verbose output | false |
| `--config` | | Path to config file | |
| `--budget` | | Maximum budget in USD | |
| `--redact` | | Enable PII redaction | false |
| `--redact-patterns` | | Custom redaction patterns | |

### Output Metrics

- **Latency**: min, max, avg, p50, p90, p95, p99
- **Throughput**: requests per second (RPS)
- **Success Rate**: percentage of successful requests
- **Token Usage**: input/output tokens per request
- **Cost Estimate**: estimated API cost

### Examples

```bash
# Basic stress test with scenario
akit stress scenario.yaml

# Request-based test
akit stress scenario.yaml --requests 100 --concurrency 10

# Duration-based test (30 seconds)
akit stress scenario.yaml --duration 30 --concurrency 20

# With ramp-up period
akit stress scenario.yaml --requests 500 --ramp-up 10 --concurrency 50

# With budget limit
akit stress scenario.yaml --requests 100 --budget 5.00 --save
```

---

## akit report

Generate reports from test runs.

```bash
akit report <run-id> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `run-id` | Run ID to generate report for (required) |

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--format` | `-f` | Output format (html, json, both) | html |
| `--output` | `-o` | Output directory | ./artemis-output |
| `--config` | | Path to config file | |

### Examples

```bash
# Generate HTML report
akit report abc123

# JSON format
akit report abc123 --format json

# Both formats
akit report abc123 --format both

# Custom output directory
akit report abc123 --output ./reports
```

---

## akit history

View run history.

```bash
akit history [options]
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--limit` | `-l` | Number of runs to show | 20 |
| `--project` | `-p` | Filter by project | |
| `--scenario` | `-s` | Filter by scenario | |
| `--show-cost` | | Show cost column | false |
| `--config` | | Path to config file | |

### Examples

```bash
# Recent runs
akit history

# More history
akit history --limit 50

# Filter by project
akit history --project myproject

# Show cost column
akit history --show-cost
```

---

## akit compare

Compare two test runs for regression detection.

```bash
akit compare <baseline> <current> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `baseline` | Baseline run ID |
| `current` | Current run ID to compare |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--threshold` | Regression threshold (0-1) | 0.05 |
| `--config` | Path to config file | |
| `--html` | Generate HTML comparison report | |
| `--json` | Generate JSON comparison report | |

### Examples

```bash
# Compare two runs
akit compare abc123 def456

# Custom threshold (10% regression allowed)
akit compare abc123 def456 --threshold 0.10

# Generate comparison report
akit compare abc123 def456 --html comparison.html

# Generate both reports
akit compare abc123 def456 --html report.html --json report.json
```

---

## akit baseline

Manage baselines for comparison.

```bash
akit baseline <subcommand> [options]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `set <run-id>` | Set run as baseline |
| `get <identifier>` | Get baseline by scenario or run ID |
| `list` | List all baselines |
| `remove <identifier>` | Remove baseline by scenario or run ID |

### Examples

```bash
# Set baseline
akit baseline set abc123

# Get baseline for scenario
akit baseline get my-scenario

# List all baselines
akit baseline list

# Remove baseline
akit baseline remove my-scenario
```

---

## akit init

Initialize ArtemisKit configuration.

```bash
akit init [options]
```

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--force` | `-f` | Overwrite existing configuration |
| `--skip-env` | | Skip adding environment variables to .env |
| `--interactive` | `-i` | Run interactive setup wizard |
| `--yes` | `-y` | Use defaults without prompts (non-interactive) |

### Examples

```bash
# Interactive setup
akit init

# Non-interactive with defaults
akit init --yes

# Force overwrite existing config
akit init --force

# Interactive wizard
akit init --interactive
```

Creates `artemis.config.yaml` with settings for:
- Default provider
- Default model
- API keys (stored as env var references)
- Output directory
- Storage type

---

## akit validate

Validate scenario files without running them.

```bash
akit validate <path> [options]
```

### Arguments

| Argument | Description |
|----------|-------------|
| `path` | Path to scenario file, directory, or glob pattern |

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--strict` | | Treat warnings as errors |
| `--json` | | Output as JSON |
| `--quiet` | `-q` | Only output errors (no success messages) |
| `--export` | | Export format (junit for CI integration) |
| `--export-output` | | Output directory for exports (default: ./artemis-exports) |

### Examples

```bash
# Validate single file
akit validate scenarios/test.yaml

# Validate directory
akit validate scenarios/

# Strict mode (fail on warnings)
akit validate scenarios/ --strict

# JSON output for programmatic use
akit validate scenarios/ --json

# Quiet mode (errors only)
akit validate scenarios/ --quiet

# Export JUnit report for CI
akit validate scenarios/ --export junit --export-output ./test-results
```
