---
name: skill-graph
description: "Sparse loading — resolve only relevant skills + dependencies, digest per context budget"
triggers: "sparse loading, skill resolution, relevant skills, which skill, skill-graph"
changelog: docs/ciclos/cycle28-20260815.md
token_budget: 2300
---

## When to Use
Sparse loading — resolve only relevant skills + dependencies

## RESOLVE
```powershell
.\scripts\skill-graph.ps1 -Task "<task>" [-Expand N] [-Format Json|Csv]
```
Match keywords→triggers (fuzzy, min 3 chars). Expand BFS 1-hop deps. Output: matched + deps.

Ex: `"security audit"` → security-scanner + best-practices. `"implement feature"` → sdd-tasks + sdd-design + sdd-spec.

## Output Format
### JSON (default)
```json
{ "matched": ["security-scanner", "best-practices"],
  "deps": ["lean-context"],
  "skill_count": 2, "dep_count": 1,
  "expand_chain": ["security-scanner", "best-practices"] }
```
### CSV (`-Format Csv`)
```
matched,dep_count,expand_chain
security-scanner;best-practices,1,security-scanner>best-practices
```
Use JSON for programmatic consumption; CSV for human review or spreadsheets.

## BFS Expansion Example
`-Expand 2` resolves 2 hops deep:
```
hop 0: "performance"        → perf-profiling
hop 1: perf-profiling       → [command-wrapper, lean-context]
hop 2: command-wrapper      → [bash-safe]
```
`-Expand 1` (default) stops at direct deps only. Expand >3 is rarely needed.

---

> See [reference.md](docs/skills/skill-graph/reference.md) for extended details, examples, and detailed patterns.
## Anti-Rationalization

| Rationalization | Red Flag | Verification |
|-----------------|----------|--------------|
| "Load all skills upfront" | Importing 93 skills in every prompt | Resolve only relevant skills + dependencies via skill-graph sparse loading |
| "Dependencies don't matter" | Using skill without its deps | `skill-graph` must resolve deps first — unresolved skill fails at runtime |
| "Graph is static" | Reusing stale skill-graph | `skill-registry` scan + engram persist when skills change |

## Red Flags
- Skill used without `skill-graph` resolution → missing deps, silent failure
- Circular dependency in skill graph → same error 2× pattern (micro loop)

## Verification
- `cross-ref-check.ps1` → `SKILL.md... OK` + `INDEX count` matches registry
- `ctx_search(source: "<skill>")` returns expected indexed sections

## Refs
Cross-Refs: skill-registry | cross-project-forge
