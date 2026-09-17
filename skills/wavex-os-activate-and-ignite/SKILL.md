---
name: wavex-os-activate-and-ignite
description: Activate a signed WaveX OS company manifest into the runtime and kick off the ignition phase that seeds first tasks.
---

# wavex-os-activate-and-ignite

The two-step transition from "wizard finished" to "fleet is doing work." Activate bridges the signed manifest into the DB (and optionally a running Paperclip instance). Ignite seeds first-task issues, creates the Goal, and fires the CEO + Chief of Staff kickoff probe so the fleet has something to chew on.

## When to use

- User just finished the wizard and clicked *Finalize + sign*, and now wants the fleet running
- A previously-activated company never produced any agent activity (ignite never ran or got partial)
- After importing a manifest from another machine

If the user hasn't completed the wizard yet, use [wavex-os-init](../wavex-os-init/SKILL.md) or [wavex-os-provision-company](../wavex-os-provision-company/SKILL.md) first.

## Preconditions

1. **Signed manifest exists:**
   ```bash
   COMPANY_ID="<id>"
   test -f ~/.wavex-os/instances/default/companies/$COMPANY_ID/onboarding/company.manifest.json
   test -f ~/.wavex-os/instances/default/companies/$COMPANY_ID/onboarding/manifest.sig
   ```
   Both must exist. No sig → wizard wasn't finalized.

2. **Server healthy:**
   ```bash
   curl -fsS http://localhost:3101/api/system/health | jq -r .status   # "healthy"
   ```

3. **Decide whether to hand off to Paperclip.** Set `PAPERCLIP_HANDOFF_URL` env var before activate if yes:
   ```bash
   export PAPERCLIP_HANDOFF_URL="http://localhost:3100"
   ```
   Without this, agents still activate in the WaveX DB but won't get the Paperclip runtime (heartbeats, board, KPI rollups). For most users you want the handoff.

## Procedure

1. **Activate:**
   ```bash
   curl -X POST "http://localhost:3101/api/instance/$COMPANY_ID/activate" \
     -H 'Content-Type: application/json' | jq
   ```
   Expected response:
   ```json
   {
     "ok": true,
     "companiesRowId": "...",
     "agentsInserted": <n>,
     "paperclipHandoff": { "ok": true, "agentsMirrored": <n> }   // present if handoff was configured
   }
   ```
   `agentsInserted` should match the roster size from Phase 3. If it's smaller, the bridge skipped some slots — see Common failures.

2. **Ignite:**
   ```bash
   curl -X POST "http://localhost:3101/api/instance/$COMPANY_ID/ignite" \
     -H 'Content-Type: application/json' | jq
   ```
   Expected:
   ```json
   {
     "ok": true,
     "goalIssueId": "...",
     "kickoffTasksSeeded": <n>,
     "heartbeatOffsetsStaggered": true
   }
   ```
   Ignite is idempotent — re-running on an already-ignited company is safe; it'll report `kickoffTasksSeeded: 0`.

3. **Verify the fleet has signs of life within ~6 minutes (one heartbeat cycle):**
   ```bash
   sleep 360
   curl -fsS "http://localhost:3101/api/mission-control/$COMPANY_ID/activity" | jq '.[0:3]'
   ```
   Expect at least one comment, KPI snapshot, or run event in the last 6 minutes.

## Success criteria

- `activate` returned `ok: true` with `agentsInserted` equal to roster size
- `ignite` returned `ok: true` with a non-empty `goalIssueId`
- `/api/mission-control/<companyId>/activity` shows agent-generated events within one heartbeat
- `/api/mission-control/<companyId>/health-orb` is GREEN or YELLOW (not RED)

## Common failure modes

- **`activate` returns `manifest.sig invalid`:** the manifest was edited after signing (sometimes by trying to "fix a typo" in the JSON). Re-finalize from the wizard.
- **`agentsInserted < roster size`:** a slot-to-template mapping is missing in `packages/wavex-os-server/src/bridge/catalog.ts` (`SLOT_TO_TEMPLATE`). Not user-fixable; this is a maintainer issue. File a bug with the unmapped slot name.
- **Paperclip handoff returns `ok: false`:** `PAPERCLIP_HANDOFF_URL` points at a Paperclip instance that's down or unreachable. Activate still completed in WaveX DB; you can retry handoff later by re-POSTing activate (it's idempotent for the handoff portion).
- **Ignite seeds 0 tasks even on a fresh company:** workflow manifest didn't pin initial workload to any agent. Check `~/.wavex-os/instances/default/companies/<id>/onboarding/workflow_manifest.json` — `initial_workload` should be non-empty per agent.
- **No activity 6 minutes after ignite:** check [wavex-os-debug-healing](../wavex-os-debug-healing/SKILL.md). The agents are spawned but the wrapper or OAuth may be failing.

## Re-running on an already-active company

Both endpoints are idempotent:
- `activate` on a live company → no-ops or only mirrors new agents
- `ignite` on a live company → no-ops if Goal + kickoff already exist

This is the supported way to recover from "I think the fleet didn't fully start." Don't try to "reset" first unless [wavex-os-audit](../wavex-os-audit/SKILL.md) shows a deeper problem.

## Related skills

- [wavex-os-mission-control](../wavex-os-mission-control/SKILL.md) — verify the fleet is producing real work after ignite.
- [wavex-os-debug-healing](../wavex-os-debug-healing/SKILL.md) — if activity stays silent past one heartbeat.
