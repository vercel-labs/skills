---
name: recsys-pipeline-architect
description: Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework popularized by xAI's open-sourced X For You algorithm. Use when building any system that picks "the top K items for a (user, context)" — content feeds, search ranking, RAG rerankers, task prioritizers, notification triage, ad selection.
allowed-tools: Read, Write
---

# Recsys Pipeline Architect

A spec-and-scaffold skill for building composable recommendation, ranking, and feed pipelines using the **six-stage** pattern popularized by xAI's open-sourced [For You algorithm](https://github.com/xai-org/x-algorithm) (Apache 2.0). Independent MIT reimplementation of the pattern — no code copied.

## Overview

Most "recommendation systems" in production aren't exotic ML — they are *pipelines*: fetch candidates from one or more sources, enrich them with metadata, drop the ineligible, score the rest, sort and pick the top K, then fire off async side effects. The pattern is universal. The scoring function and the items change; the pipeline shape doesn't.

This skill encodes that pattern as six composable stages, surfaces the trade-offs at each stage, and produces a runnable scaffold in the user's stack.

## When to Use Orchestration

✅ **Good for:**
- Building any system that returns top K items for a (user, context)
- Designing personalized feeds (content, search results, notifications)
- Wrapping an LLM/ML scorer in proper pipeline plumbing
- Adding multi-action prediction with tunable weights
- Building a RAG retrieval reranker (cheap retrieval + expensive rerank)
- Task prioritizers, alert triage, ad ranking

❌ **Not for:**
- Model architecture work (transformer design, two-tower retrieval, embedding training)
- Pure ML training pipelines — the scoring function is the user's responsibility
- Operating a deployed pipeline (monitoring, autoscaling)

## The Six-Stage Framework

| # | Stage | Job | Parallel? |
|---|---|---|---|
| 1 | **Source** | Fetch candidates from one or more origins | Yes |
| 2 | **Hydrator** | Enrich candidates with metadata | Yes |
| 3 | **Filter** | Drop ineligible candidates | Sequential |
| 4 | **Scorer** | Assign scores | Sequential |
| 5 | **Selector** | Sort and pick top K | Single op |
| 6 | **SideEffect** | Log, cache, emit events | Async (non-blocking) |

### Why this exact order

- Sources before hydration: know what candidates exist before paying to enrich
- Hydration before filtering: many filters need metadata the source didn't provide
- Filtering before scoring: scoring is the expensive stage — drop the ineligible first
- Scorer chain (not single scorer): real systems compose ML scoring + diversity reranking + business rules
- Selector after scoring: keeps scoring deterministic and cacheable
- SideEffects last and async: side effects must never block the user response

## Workflow When Invoked

Walk the user through eight steps:

1. **Clarify the use case** (only what's missing): items being ranked, input context, language/runtime
2. **Identify the candidate sources** (usually in-network + out-of-network)
3. **List required hydrations** for filters and scorers
4. **List the filters** — cheap before expensive, universal before user-specific
5. **Design the scorer chain** — primary ML/heuristic → combiner (multi-action with weights) → diversity → business rules
6. **Selector** — sort descending by final score, take top K
7. **SideEffects** — fire-and-forget patterns only
8. **Generate the scaffold** in the user's stack — use `Write` to emit the directory tree

## Key Trade-offs to Surface

Never default silently — these are product decisions disguised as technical ones.

### 1. Single score vs multi-action prediction

- **Single score:** train one model to predict relevance. To change behavior → retrain.
- **Multi-action:** predict `P(action)` for many actions (read, like, share, skip, report), combine with weights at serving time. To change behavior → change weights. No retraining.

The X For You algorithm uses multi-action with both positive and negative weights. Recommend multi-action when the user expects to tune frequently.

### 2. Candidate isolation vs joint scoring

- **Isolated:** deterministic, cacheable. Default.
- **Joint:** more expressive, harder to cache.

### 3. Online vs offline batch

- **Online:** request-time, 100–300ms latency. Default.
- **Offline:** lower latency, lower freshness.
- **Hybrid:** retrieval offline, ranking online.

## Hard Rules

1. **Do not invent benchmark numbers.** "How fast?" → "depends on workload, run it yourself."
2. **Attribution discipline.** Attribute as "popularized by xAI's open-sourced For You algorithm" (Apache 2.0).
3. **No trademark use.** Use neutral names like "candidate pipeline" or "feed pipeline", not "X-like" or "For You".
4. **Surface trade-offs.** Never default silently.
5. **Scaffold must run.** No pseudocode.
6. **Filter order matters.** Cheap before expensive.
7. **Side effects never block.** Wrap in fire-and-forget patterns.

## Anti-Patterns

- ❌ Scoring before filtering (wastes compute)
- ❌ Synchronous side effects (block the response)
- ❌ Single "relevance" score when product needs multi-objective tuning
- ❌ Joint scoring as default (non-deterministic, uncacheable)
- ❌ Pseudocode "for illustration" — the scaffold must actually run

## Examples

### Strapi content feed (TypeScript)

User: "I have a Strapi v5 instance with 50k articles. I want a 'for you' feed personalized to each logged-in user based on reading history."

Walk through 8 steps → generate Strapi plugin scaffold with multi-action scoring, author diversity, standard filters, async side-effect lane.

### RAG retrieval reranker (Python async)

User: "My RAG returns top-50 chunks from a vector DB. I want to rerank with a more expensive scorer and return top-5."

Single-source pipeline with a scorer chain. Two-stage: cheap retrieval + expensive rerank.

### Task prioritizer (FastAPI)

User: "PMAI receives a queue of incoming task suggestions. I want to rank them by 'what should this user work on next' considering their past patterns."

Items reversed (tasks instead of content), same shape applies. Generate FastAPI scaffold.

### Notification triage (offline batch)

User: "We send too many notifications. I want a daily digest that picks the top 10 from the last 24h queue."

Offline-batch pipeline. Source = queue, filters = age/dedup/eligibility, scorer = urgency × user-affinity, selector = top 10, side effect = email send (still async).

## Upstream

This is a single-file adapter for the upstream repository, which ships 5 load-on-demand reference docs and 3 runnable example scaffolds:

- **Upstream:** https://github.com/mturac/recsys-pipeline-architect
- **Release:** v0.1.0 (MIT)
- **References:** interfaces in 4 languages (TypeScript, Go, Python, Rust), multi-action scoring pattern, candidate isolation, filter cookbook (12 patterns), scorer cookbook
- **Runnable examples (9/9 tests passing):** Strapi v5 / TypeScript / Jest, Zentra-compatible / Go with generics, PMAI / Python / FastAPI / pytest
- **Cross-platform install:** `npx skills add mturac/recsys-pipeline-architect`
- **Pattern source:** [xai-org/x-algorithm](https://github.com/xai-org/x-algorithm) (Apache 2.0)
