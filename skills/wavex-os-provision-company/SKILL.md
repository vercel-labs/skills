---
name: wavex-os-provision-company
description: Drive a 2nd-or-later AI agent company through the WaveX OS 5-pillar wizard against an already-running install.
---

# wavex-os-provision-company

Provision an additional company on a WaveX OS install that's already running. Same wizard as first-run, but the user keeps their existing fleet alive — companies are isolated under `~/.wavex-os/instances/default/companies/<companyId>/`.

## When to use

- User already has `wavex-os` installed and a first company live
- User says "spin up another company" / "add a new tenant" / "I want to try a different roster shape"
- Use [wavex-os-init](../wavex-os-init/SKILL.md) instead if this is their first time

## Preconditions

```bash
curl -fsS http://localhost:3101/api/system/health > /dev/null   # server up
curl -fsS http://localhost:5173 > /dev/null                      # UI up
```

If either is down, the user needs to `pnpm dev` from the repo root first. Do not try to start it yourself unless asked.

Existing companies use disk + inference quota — confirm headroom by running [wavex-os-audit](../wavex-os-audit/SKILL.md) before adding another company.

## Procedure

1. **Open the wizard at a fresh draft state:**
   - Browser: `http://localhost:5173/wizard` → "Start new company"
   - Or POST a draft programmatically:
     ```bash
     curl -X POST http://localhost:3101/api/wizard-events \
       -H 'Content-Type: application/json' \
       -d '{"event":"start","companyName":"<name>"}'
     ```
   The server returns a draft `companyId` (UUID). Persist it — every later call needs it.

2. **Walk the 5 pillars + 3 phases.** Same shape as [wavex-os-init](../wavex-os-init/SKILL.md) but the user can copy answers from a prior company when the new one is structurally similar (same product stage + GTM motion → reuse Phase 3/4).

3. **Watch out for connector collisions.** Pillar 5 + Phase 2 may suggest the same OAuth tokens as an existing company. The vault stores per-company entries — re-pasting is safe but the credential concierge will warn.

4. **Finalize + sign.** A new `company.manifest.json` lands at:
   ```
   ~/.wavex-os/instances/default/companies/<companyId>/onboarding/company.manifest.json
   ```

5. **Activate** — same `POST /api/instance/<companyId>/activate` as first-run. See [wavex-os-activate-and-ignite](../wavex-os-activate-and-ignite/SKILL.md) for the post-activate sequence.

## Roster shape recommendations

The wizard picks a shape from Pillar 3 (product stage). Override only if the user pushes back:

| Pillar 3 answer | Default shape | When to override |
|---|---|---|
| pre_product | minimal_kernel (CEO + Chief of Staff) | Override if user has paying customers — they need a real fleet |
| live_few_customers | collapsed_6 | Rarely overridden |
| 10k_100k_mrr | hybrid (~12 agents) | Override → formal_9 if the user wants role specialization for compliance |
| 100k_plus | formal_9 | Override → custom only if the user has named a specific agent they need |

Solo founders get a further-collapsed 5-agent kernel regardless of stage — don't suggest expanding it without checking they have time to manage the extra agents.

## Success criteria

- `~/.wavex-os/instances/default/companies/<new-companyId>/onboarding/company.manifest.json` exists
- `manifest.sig` is present and the file passes `wavex-os audit --verify-signatures <companyId>`
- Mission Control at `/mission-control/<new-companyId>` loads independently of the existing company

## Common failure modes

- **Wizard refuses to open a new draft:** an unfinished draft from a prior session is still in the DB. List drafts: `curl http://localhost:3101/api/wizard-metrics`. Either resume it or hard-reset with `DELETE /api/instance/<draftId>/reset`.
- **Phase 3 swarm generation is empty:** roster matrix had no match for the pillar combo. Lower the roster shape one tier (formal_9 → hybrid).
- **Finalize hangs at Monte Carlo:** the simulator runs `pnpm diffeq:suite` in the background. If T2 inference is saturated by the existing fleet, this can take 90s. Be patient before retrying.

## Related skills

- [wavex-os-activate-and-ignite](../wavex-os-activate-and-ignite/SKILL.md) — what to do after Finalize.
- [wavex-os-mission-control](../wavex-os-mission-control/SKILL.md) — verify the new company is live.
