---
name: wavex-os-debug-healing
description: Walk the 3-layer WaveX OS self-healing flow when an agent is stuck — 401 fallback, OAuth refresh, worker restart.
---

# wavex-os-debug-healing

When a WaveX agent stops making progress, the failure is almost always at one of three layers. This skill walks them in order — cheapest probe first.

The reference implementation lives at [`packages/healing/`](https://github.com/aimerdoux/wavex-os/tree/main/packages/healing) and the architecture is in [`docs/SELF_HEALING.md`](https://github.com/aimerdoux/wavex-os/blob/main/docs/SELF_HEALING.md). **Don't modify those files** — they're a FROZEN path. This skill diagnoses; it doesn't patch the healing layer itself.

## When to use

- Mission Control `/health-orb` returned RED or YELLOW with a healing-related `reason`
- User reports "agent X stopped commenting" / "fleet is silent" / "spinner stuck"
- After a Claude Max token rotation
- After a long sleep/wake cycle on macOS

## Don't pre-emptively use this

The three layers below are **self**-healing. They run on their own schedule. If you're seeing a transient failure that's <2 minutes old, wait — the next heartbeat (every 5 min) usually clears it. Only walk this skill when the issue persists across a heartbeat.

## The three layers

| Layer | What heals | Probe | Auto-recovery cadence |
|---|---|---|---|
| L1 | 401 from Claude API → fall back to Sonnet via wrapper | Per-call (synchronous in `claude-anthropic-direct.sh`) | Immediate |
| L2 | OAuth token expired → refresh via keychain + concurrency lock | Out-of-band, idempotent | On next heartbeat |
| L3 | Worker process wedged → SIGTERM → SIGKILL → restart | launchd `recovery-on-boot` + 12h `recovery-12h` | Boot + every 12h |

## Procedure

1. **Confirm which layer is implicated.**

   ```bash
   curl -fsS http://localhost:3101/api/mission-control/<companyId>/health-orb | jq
   ```
   The `reason` field is the entry point:
   - mentions `401` / `unauthorized` → Layer 1
   - mentions `oauth` / `invalid_grant` / `refresh` → Layer 2
   - mentions `worker` / `unresponsive` / `heartbeat_missed` → Layer 3
   - mentions none of the above → not a healing issue; check [wavex-os-audit](../wavex-os-audit/SKILL.md)

2. **Layer 1 — 401 fallback:**

   Tail the wrapper log:
   ```bash
   tail -n 200 ~/.wavex-os/logs/wrapper.log | grep -E '401|fallback|sonnet'
   ```
   You should see lines like `[wrapper] 401 from opus, falling back to sonnet`. If you see 401s **without** a fallback line, the wrapper isn't catching them — the script may have been overwritten. The canonical version is in `scripts/wrappers/claude-anthropic-direct.sh` (FROZEN).

3. **Layer 2 — OAuth refresh:**

   ```bash
   security find-generic-password -s "claude.cli.oauth" -w 2>/dev/null | head -c 8 && echo "... (token present)"
   ```
   If empty, the keychain entry is gone — user must `claude` login again. If present, look at:
   ```bash
   tail -n 200 ~/.wavex-os/logs/healing.log | grep -E 'refresh|invalid_grant'
   ```
   `invalid_grant` repeated → token actually revoked upstream; user must re-login. Concurrency lock contention shows as `lock_held_by=<pid>` — usually clears within 60s.

4. **Layer 3 — Worker restart:**

   ```bash
   launchctl list | grep wavex
   ps aux | grep -E 'wavex|claude' | grep -v grep
   ```
   A worker stuck in uninterruptible sleep won't show up in `launchctl` as failed but will be in `ps`. If you can identify a wedged PID:
   ```bash
   # The healing layer's worker-restart does this on a schedule;
   # nudging it manually is fine if the user is in front of you.
   launchctl kickstart -k gui/$(id -u)/com.wavex-os.recovery-on-boot
   ```
   Then wait ~30s and recheck `/health-orb`.

5. **If all three layers report clean but the fleet is still stalled:** this is *not* a healing failure. Probable causes:
   - Token budget exhausted — check `GET /api/observability/<companyId>/budget`
   - No work in the queue — agents have nothing to do; create an issue via the dashboard
   - Paperclip handoff lost — see [wavex-os-activate-and-ignite](../wavex-os-activate-and-ignite/SKILL.md) for re-handoff

## Success criteria

- `/health-orb` returns GREEN (or YELLOW with a reason unrelated to healing)
- The next heartbeat (≤5 min) produces a new comment or KPI snapshot in `/activity`

## What NOT to do

- **Do not `rm -rf` anything under `~/.wavex-os/`** — the System Reliability agent will page. Use `paperclipai worktree:cleanup` for artifacts and Mission Control's reset endpoint for company state.
- **Do not edit `packages/healing/`, `scripts/wrappers/`, or `templates/launchd/`** — FROZEN paths.
- **Do not bypass the wrapper by calling `claude` directly with `ANTHROPIC_API_KEY`.** The wrapper is what makes 401-fallback work.

## Related skills

- [wavex-os-audit](../wavex-os-audit/SKILL.md) — for non-healing diagnostics.
- [wavex-os-mission-control](../wavex-os-mission-control/SKILL.md) — to verify recovery landed.
