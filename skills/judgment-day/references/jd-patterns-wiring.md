# JD Patterns Wiring — Zylos 2/3/4/5 via jd-verifier.ps1

Mechanical wiring for Zylos judge patterns. Pattern 6 (IRM) is future — no model infra.

## P2 — Online Runtime Verifier (76–162ms, small judge)
- P1 fast-path: `scripts/jd-verifier.ps1 -Zone <AMARILLA|ROJA> -FastPath` before deciding dual-judge. Zone is a param: AMARILLA fast-lane or ROJA pre-check, both valid.
- Runs `bin/fast.exe --gate --json` if exists; `passed && elapsedMs≤162` → `VERIFY-OK mechanical (Xms)`.
- Else → `ESCALATE dual-judge` (fail, over budget, timeout 5s, or parse failure).
- Missing exe → `WARN: bin/fast.exe not found` (stderr) + `ESCALATE`, exit 1 (not crash); `-Json` sets `fastPath.passed=false`.
- Override for tests/CI: `JD_FAST_EXE=/path/to/stub.ps1` honored ONLY when `PESTER_TEST=1`; otherwise always `bin/fast.exe`; `.ps1` stubs run via `pwsh -File`.
- Timeout: 5s via `System.Diagnostics.Process` (`WaitForExit(5000)` → `Kill()` → `ESCALATE` + warn `timeout`).

## P3 — Self-Consistency / Self-Critique
- Always emitted: `SELF-CONSISTENCY: profiles A/B = majority-of-2 (diverge → tie-break by higher severity)`.
- P2 synthesize: two blind `code-review-agent` profiles vote; majority-of-2, severity tie-break.

## P4 — Reflexion (grounded only)
- Re-judge capped at 2 rounds; ` -Rounds >2` → `ASK-USER (Reflexion cap)`, exit 2.
- Never intrinsic loop — grounded on diff/tests only.

## P5 — Constitutional / RLAIF
- `-RepeatFinding` → `CONSTITUTIONAL → register via immune-system (.agents/skills/immune-system)`.
- `gap >1.5` severity → permanent constitution entry.

## Exit Codes
- `0` VERIFY-OK, `1` ESCALATE, `2` rounds-cap ASK-USER.
- `-Json` emits `{verifier, zone, fastPath:{ran,passed,elapsedMs,decision}, rounds:{value,capped}, constitutional, timestamp}`.

## Rejected Alternatives
- Signature/hash allowlist for fast.exe — REJECT: WDAC already enforces hash policy at OS level.
