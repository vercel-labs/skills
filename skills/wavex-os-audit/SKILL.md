---
name: wavex-os-audit
description: Run WaveX OS diagnostics — disk, RAM, ports, launchd jobs, service health, and Claude CLI prerequisites — in one shot.
---

# wavex-os-audit

Run the two diagnostic CLIs WaveX OS ships with and interpret their output. Use this whenever something is misbehaving, before opening an issue, or before walking a user through any other wavex-os skill.

## When to use

- User reports "wavex is slow / agents stalled / nothing's happening"
- Pre-flight before [wavex-os-init](../wavex-os-init/SKILL.md) or [wavex-os-provision-company](../wavex-os-provision-company/SKILL.md)
- Mission Control shows a RED health orb
- After a macOS update (launchd plists sometimes get unloaded)

## The two CLIs and how they differ

| CLI | Scope |
|---|---|
| `wavex-os doctor` | Environment prerequisites: Node version, Claude CLI presence + OAuth, keychain access, free ports. Run *before* installing or starting. |
| `wavex-os audit` | Runtime state: disk %, RAM %, launchd job status, service health, inference burn, recent crashes. Run *while* a fleet is supposed to be running. |

Running both is cheap. Default to running both when unsure.

## Procedure

1. **Doctor (env prerequisites):**
   ```bash
   wavex-os doctor
   ```
   Exit code 0 → all green. Non-zero → at least one prerequisite is failing; the report names which.

2. **Audit (runtime state):**
   ```bash
   wavex-os audit
   ```
   Reports per-resource state. Codes:
   - GREEN: < 70% utilization, all services healthy
   - YELLOW: 70–90% — heads-up, no automatic action
   - RED: > 90% — the platform-level resource sweeper will throttle spawns; operator gets paged

3. **Cross-check service health via HTTP if the local server is up:**
   ```bash
   curl -fsS http://localhost:3101/api/system/health | jq
   ```
   This is the same probe the fleet uses internally. If it 404s, the wavex-os-server isn't running — start it with `pnpm dev:core` from the repo root.

4. **If a launchd job is wedged:**
   ```bash
   launchctl list | grep wavex
   launchctl print gui/$(id -u)/com.wavex-os.<jobname>
   ```
   The plist source is in `templates/launchd/`. Re-render with `pnpm tuning:map` if anything in the template changed.

## Success criteria

- `wavex-os doctor` exits 0
- `wavex-os audit` reports all GREEN, or YELLOW with a concrete plan for what to free up
- `/api/system/health` returns `{ status: "healthy" }`

## Common failure modes

- **Doctor reports "Claude CLI OAuth missing":** user has the binary but never logged in. Run `claude` once and complete the OAuth dance.
- **Audit reports disk RED but you just provisioned:** WaveX caches Monte Carlo runs + worktree artifacts in `~/.wavex-os/`. Safe to clean: `paperclipai worktree:cleanup` (do **not** `rm -rf` — the System Reliability agent enforces this).
- **Audit reports inference burn RED:** the tier-router is hitting Anthropic at API rates instead of OAuth. Check `WAVEX_INFERENCE_MODE` env var; should be `oauth` in dev.
- **launchd shows status `78`:** the plist references a path that doesn't exist (often after a checkout move). Re-render templates.

## Output to relay to the user

When summarizing audit results, lead with the worst-state resource and a one-line fix, not a full dump. Full output is in the user's terminal already.

## Related skills

- If audit surfaces self-healing failures: [wavex-os-debug-healing](../wavex-os-debug-healing/SKILL.md).
- If audit is clean but the wizard still won't start: [wavex-os-init](../wavex-os-init/SKILL.md) preconditions.
