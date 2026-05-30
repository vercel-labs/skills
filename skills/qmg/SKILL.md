---
name: qmg
title: Quantum Memory Graph (QMG)
description: "Quantum-enhanced long-term memory for AI agents. #1 on LongMemEval (98.6% R@5). Chunked gte-large retrieval with optional QAOA+CVaR quantum subgraph optimization."
tags: [memory, retrieval, quantum, rag, embeddings, long-memory, AI-agents]
metadata:
  hermes:
    tags: [memory, retrieval, quantum, rag, embeddings, long-memory]
    homepage: https://clawhub.ai/dustin-a11y/quantum-memory
---

# Quantum Memory Graph (QMG)

Quantum-enhanced long-term memory for AI agents. **#1 on LongMemEval** — the standard benchmark for long-term memory retrieval.

Uses chunked gte-large embeddings for state-of-the-art semantic retrieval, with optional QAOA+CVaR quantum subgraph optimization for graph-based reasoning tasks.

## Features

- **#1 on LongMemEval** — 98.6% R@5, 99.4% R@10, 0.9426 NDCG
- **Chunked retrieval** — 500-char blocks with 100-char overlap, mean-of-top-3 per session
- **QAOA+CVaR optimization** — 12.8% edge over greedy on graph/PCE tasks
- **GPU accelerated** — runs on NVIDIA GB10 (DGX Spark)
- **Cascade recall** — personal graph → archive fallback
- **Per-agent isolation** — each agent gets their own isolated memory graph

## How It Works

1. **Session chunking** — split conversations into overlapping 500-char blocks
2. **Embedding** — encode chunks with gte-large (1024-dim sentence transformer)
3. **Scoring** — per-session score = mean of top-3 chunk cosine similarities
4. **Refinement** — optional QAOA+CVaR subgraph optimization on top-14 candidates

## Performance

| Metric | Score |
|--------|:-----:|
| R@1 | 90.6% |
| **R@5** | **98.6%** |
| R@10 | 99.4% |
| NDCG@10 | 0.9426 |

*Benchmark: LongMemEval-S (500 questions, 18,464 sessions), May 28 2026*

## Quick Start

```python
pip install quantum-memory-graph
```

```python
from quantum_memory_graph import MemoryGraph

mg = MemoryGraph()
mg.store("Project Alpha uses React frontend with TypeScript.")

# Recall — chunked semantic retrieval
results = mg.retrieve("What is Project Alpha's tech stack?", top_k=5)
```

Or run as a FastAPI server:

```bash
quantum-memory-graph serve
# Endpoints: /store, /recall, /stats
```

## Requirements

- Python 3.10+
- sentence-transformers
- numpy
- (optional) qiskit for QAOA on real hardware

## Links

- **ClawHub**: https://clawhub.ai/dustin-a11y/quantum-memory
- **GitHub**: https://github.com/Dustin-a11y/quantum-memory-graph
- **PyPI**: https://pypi.org/project/quantum-memory-graph/

## License

MIT
