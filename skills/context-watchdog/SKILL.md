---
name: context-watchdog
description: "Monitor context window — Recursive Summary Compression (L1/L2/L3), YELLOW/RED zones, hallucination detection"
triggers: "Context explosion, compress, compression schedule, session break"
changelog: "2026-09-01 P0-1 — DAG wiring (parts 1-3): hierarchical summary DAG + check integration"
token_budget: 3200
---

## When to Use
Monitor context window — Recursive Summary Compression (L1/L2/L3), YELLOW/RED zones, hallucination detection.

## Rules
1. Compress at ORANGE (60%), never RED (80%). 2. Always start L1 (60-70%) before escalating. 3. First drift → force YELLOW + L1 immediately. 4. 3+ edits same file → STOP, summarize, commit, re-read. 5. Every 25 calls → `mem_save(topic_key=checkpoint/session-state)`. 6. Same point 2x or hallucination → force RED, break session.

## Budgets + Zones
| Model | Total | YELLOW 40% | ORANGE 60% | RED 80% |
|---|---|---|---|---|
| Sonnet4/GPT-4o/Haiku4 | 200K | >120K | >140K | >160K |
| Gemini 2.5 Pro | 1M | >600K | >700K | >800K |

| Zone | Action |
|---|---|
| GREEN <40% | Normal, L1 every ~8 msgs |
| YELLOW 40-60% | L1+L2, drop verbose |
| ORANGE 60-80% | L2 raw + L3 L1s, **compact at 70%** |
| RED >80% | `mem_save` → `session_summary` → new session |

## Drift + Force-RED
65% failures = drift: re-reads same content, re-states question, references unsaid → force YELLOW + L1. Force-RED: same point 2x · self-contradiction · "as I mentioned" referencing nothing.

## Anti-Patterns
Compress at RED (recovery > savings; rule 1) · Jump to L3 skipping L1 (destroys chain) · Summarize stale instead of pruning (compounds drift)

## Anti-Rationalization

| Rationalization | Red Flag | Verification |
|-----------------|----------|--------------|
| "Still under 60%, keep going" | Ignoring YELLOW at 40-60% | `context-watchdog-check.ps1 -CurrentTokens X -Budget Y` — if L1, run L1 now |
| "One more edit before compacting" | ORANGE 60-80% without L2+L3 | `Invoke-LcmEscalation` must return L2/L3 — escalate before next tool call |
| "Hallucination is just a glitch" | Same point 2× or "as I mentioned" unseen | Force RED → `mem_save` → `session_summary` → new session immediately |

## Red Flags
- Context rot: performance degrades before nominal limit (paper LCM) — measure via re-read of same file twice
- `git diff --stat` after L1 shows no file pruning → L1 was summarization, not compression

## Verification
- Post-L1: token count drops >20% and next tool call succeeds without re-read
- Post-L3: DAG node has lossless Pointer; `Get-LcmNode -Id <id>` resolves
## DAG Wiring (P0-1 — Hierarchical Summary DAG, parte 3/3)

**Escalation** delegates to `scripts/lcm-dag.ps1` + `scripts/context-watchdog-check.ps1`:
- `Invoke-LcmEscalation` thresholds aligned to zones: `NONE<40% L1 40-60 L2 60-80 L3>80` (compact at 70%).
- Auto-creates DAG node in `.learnings/lcm-dag.json` with lossless `Pointer` (L3). `PESTER_TEST=1` dry-runs.
- **3-boundary rule** (Zylos): call `context-watchdog-check.ps1` (a) before user output, (b) before `git push`/Write, (c) on Engram writes. Hook point for part 3: `session-checkpoint.ps1` at YELLOW/ORANGE.
- Storage: `.learnings/lcm-dag.json {nodes, edges, meta{cycle,budget}}` — per-cycle DAG (from `inter-track.json`).

## Reference
> docs/skills/context-watchdog/reference.md · docs/mejoras/2026-09-01-lcm-dag-design.md
## Refs
Cross-Refs: skill-graph | performance
