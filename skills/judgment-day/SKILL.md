---
name: judgment-day
description: "Dual adversarial review orchestrator — 2 profile-scoped code-review-agent instances, verdict synthesis"
triggers: "Judgment day, JD, dual review, juzgar, adversarial review, LLM-as-judge, judge patterns, online verifier"
changelog: "2026-09-01 R2-4 — add Zylos 6-pattern taxonomy + small/large judge guidance (KB r2-zylos-llm-judge); 2026-09-01 wiring jd-verifier.ps1 (p2/p4/p5 enforcement)"
token_budget: 4200
---

## When to Use
Dual adversarial code review — 2× `code-review-agent`, blind, verdict synthesis. ROJA-zone only.

## Rules

1. ROJA only — skip AMARILLA/VERDE
2. Blind separation — no cross-contamination
3. Max 2 re-judge → ASK user
4. Identical profiles → force second "security"
5. FIX/BLOCKER → `external-auditor`
6. Block push ROJA until JD clearance

## Protocol

### P0: Zone Filter
`review-rules.jsonc` → strip JSONC (3-pass: `//`, `/* */`). ROJA→dual, AMARILLA→single, VERDE→skip.

### P1: Profiles → 2× code-review-agent
Parse `jd_profile_selector` (ordered, first-match): `match=path|basename|fallback`. Missing→"architect". Identical→`[profile, "security"]`. 2 parallel, each `"## Profile Focus\n{instructions}"`. Blind. 120s timeout, retry once.
P1 fast-path: `scripts/jd-verifier.ps1 -Zone <AMARILLA|ROJA> -FastPath` before deciding dual-judge → VERIFY-OK or ESCALATE; wiring `references/jd-patterns-wiring.md`.

### P2: Synthesize

| Scenario | Verdict |
|----------|---------|
| Both CLEAN | APPROVED |
| Same root-cause (file ±5 lines) | Confirmed |
| Different findings | Triage → fix → re-judge |
| Re-judge | Max 2 rounds (diff delta only) |
P2 synthesize: `SELF-CONSISTENCY: profiles A/B = majority-of-2 (diverge → tie-break by higher severity)` per `scripts/jd-verifier.ps1`.

### P3: Calibration
FIX/BLOCKER → `external-auditor` on diff. Gap >1.5 severity → `immune-system` permanent fix.

## Judge Patterns Taxonomy (R2-4 — Zylos 2026-04-10, 6 patterns)

| # | Pattern | Latency/Cost | When (JD mapping) |
|---|---------|--------------|-------------------|
| 1 | Offline eval | async, large judge OK | This skill (ROJA dual blind) |
| 2 | Online runtime verifier | 76–162ms budget, small judge (Luna-2 3–8B, Prometheus 7B, Lynx 8B ≈97% cheaper at 0.88–0.95 acc) | ROJA hotfix fast-path (optional, not default) |
| 3 | Self-consistency / self-critique | Best-of-N + majority vote, cheapest, strongest in code/math | Our 2-profile blind → implicit majority-of-2 |
| 4 | Reflexion | Only with external grounding (tests, git diff, retrieval) — intrinsic "check your work" degrades reasoning | Re-judge delta (max 2 rounds) already grounded on diff |
| 5 | Constitutional / RLAIF | training-time; runtime = generate→critique against constitution→revise | Gap >1.5 → immune-system (constitution for ROJA repeats) |
| 6 | Inference-time reward model | ranker over N samples, gated before output | Future: pre-push reward ranker (not yet wired) |

> **3-boundary rule** (Zylos): judges before (a) user output, (b) irreversible exec (`git push`/Write), (c) memory writes. Gate covers (a)+(b); (c) future.

**Small vs Large:** large for ROJA, small distilled inline.

## Anti-Rationalization

| Rationalization | Red Flag | Verification |
|-----------------|----------|--------------|
| "One reviewer is enough for ROJA" | Single perspective on ROJA diff | Must run 2× blind code-review-agent — any less is AMARILLA pattern |
| "Re-judge 3rd time will pass" | Re-judge count >2 | Max 2 → ASK user (rule 3); >2 means synthesis failed, not review |
| "External auditor not needed" | FIX/BLOCKER without `external-auditor` | `external-auditor` on diff before APPROVED (rule 5) |

## Red Flags
- Profiles not blind (second sees first's output) → cross-contamination, verdict invalid
- Verdict without `review-rules.jsonc` zone filter → zone misclassification

## Verification
- Synthesize table: Both CLEAN or Same root-cause (±5 lines) → Confirmed; else Triage→fix→re-judge
- `BLOCKER` without `.breaker-cleared` → gate blocks push until clearance

## Pipeline
`review-pipeline` Phase 2b for ROJA. Pre-commit #9: warn ROJA without JD.

## Output
```
JD-{target} | Profiles: {A}/{B} | 4R | Confirmed:N | JDGMNT: APPROVED/ESCALATED | CALIB: OK/GAP
```
---

## Reference Materials
→ docs/skills/judgment-day/reference.md · wiring `references/jd-patterns-wiring.md`

---
## Refs
Cross-Refs: code-review-agent | testing-strategy
