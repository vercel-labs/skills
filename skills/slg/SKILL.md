---
name: slg
description: Semantic git history search and code archaeology. Use when asked why code exists, who owns a file, what introduced a regression, what changed in a commit range, or whether a change is risky to revert.
---

# SLG — Semantic Git Search

`slg` is a local-first CLI that builds a semantic index of your git history (embeddings + BM25) so you can ask natural-language questions about who changed what, why, and when. No API keys required — everything runs offline via ONNX Runtime.

## Installation

```bash
npm install -g slg-cli
# or run without installing
npx slg-cli <command>
```

## When to Use This Skill

Use `slg` when the user:

- Asks **why** a piece of code exists or was written a certain way
- Wants to know **who** is responsible for a file or function
- Is tracking down **what introduced a bug** across many commits
- Needs to understand **what changed** between two refs or in a range
- Wants to assess **how risky** reverting a commit would be
- Asks about **recent activity** on a file or directory

## Setup

Index must be built once before searching. Run this in the repo root:

```bash
slg init
```

Re-index after significant new commits:

```bash
slg reindex
```

Check index health:

```bash
slg doctor
```

## Core Commands

### Why does this code exist?

```bash
slg why "why does the retry logic use exponential backoff"
slg why "what is the purpose of the connection pool size limit"
```

Returns ranked commit results explaining the reasoning behind code decisions.

### Who owns a file?

```bash
slg blame src/auth/middleware.ts
slg blame --top 3 src/payments/
```

Returns contributors ranked by semantic commit weight for the given path.

### Find what introduced a regression

```bash
slg bisect "authentication stopped working after the refactor"
```

Narrows down the range of commits most likely to have introduced an issue using semantic search over the message + diff corpus.

### Search commit history semantically

```bash
slg log "database schema migrations"
slg log --since 2024-01-01 "API rate limiting changes"
slg log --limit 20 "performance optimizations"
```

Returns commits ranked by semantic + BM25 relevance. Supports `--since`, `--until`, `--limit`, and `--path` filters.

### Summarize a diff

```bash
slg diff HEAD~5..HEAD
slg diff v1.2.0..v1.3.0
slg diff --path src/api/ main~10..main
```

Generates a semantic summary of what changed across a commit range.

### Assess revert risk

```bash
slg revert-risk abc1234
slg revert-risk HEAD~3
```

Scores how risky it would be to revert a given commit based on downstream dependency analysis.

### See recent activity

```bash
slg status
slg status --path src/
```

Shows recent indexed commits and index freshness.

## MCP Server

`slg` ships an MCP (Model Context Protocol) server, letting AI agents query git history directly:

```bash
slg serve
# or
slg mcp
```

Configure in your agent:

```json
{
  "mcpServers": {
    "slg": {
      "command": "slg",
      "args": ["serve"]
    }
  }
}
```

Available MCP tools: `slg_why`, `slg_blame`, `slg_bisect`, `slg_log`, `slg_diff`, `slg_revert_risk`, `slg_status`.

## Tips

- `slg why` works best with full-sentence natural language questions
- `slg bisect` is most effective when given a behavioral description rather than error text
- Prefix path filters with `--path` to narrow any command to a directory or file
- Run `slg doctor` if search results seem stale — it reports index coverage and age
- For large repos (10K+ commits) the initial `slg init` may take several minutes; subsequent `slg reindex` calls are incremental and fast
