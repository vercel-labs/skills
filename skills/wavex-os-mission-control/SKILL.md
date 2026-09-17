---
name: wavex-os-mission-control
description: Query a live WaveX OS fleet — KPIs, bottlenecks, decision queue, recent activity, budget — via the local HTTP API.
---

# wavex-os-mission-control

Read-only inspector for a running WaveX OS fleet. All endpoints are local (`http://localhost:3101`) and return JSON; no auth required in dev (`WAVEX_AUTH_MODE=dev`).

## When to use

- User asks "what's my fleet doing right now?" / "show me KPIs" / "why is the dashboard yellow?"
- You need to verify a claim before reporting it (an agent said "shipped" — check `/decision-queue` and `/activity` for the actual outcome)
- Before/after running [wavex-os-debug-healing](../wavex-os-debug-healing/SKILL.md), to confirm the issue cleared

## Preconditions

```bash
curl -fsS http://localhost:3101/api/system/health | jq -r .status   # expect "healthy"
```

All endpoints take a `:companyId` path parameter. If the user didn't give one, list active companies:

```bash
ls ~/.wavex-os/instances/default/companies/
```

## Endpoint reference

All paths are under `http://localhost:3101`.

| Endpoint | Returns | When to use |
|---|---|---|
| `GET /api/mission-control/:companyId/headline` | One-sentence fleet status | Start here. Tells you which deeper endpoint to query next. |
| `GET /api/mission-control/:companyId/health-orb` | `{ color, reason }` (GREEN/YELLOW/RED) | "Why is the dashboard yellow?" |
| `GET /api/mission-control/:companyId/tab-counts` | Counts per UI tab (queue, alerts, etc.) | Spot which tab has unread items |
| `GET /api/mission-control/:companyId/decision-queue` | Items awaiting board / operator approval | "Anything waiting for me?" |
| `GET /api/mission-control/:companyId/activity` | Recent run / comment / KPI events | "What happened in the last hour?" |
| `GET /api/mission-control/:companyId/scope-tree` | Org chart + agent state | Spot which agent is stalled |
| `GET /api/observability/:companyId/mission-control` | Aggregated KPI scoreboard | Headline KPI movement |
| `GET /api/observability/:companyId/budget` | Token budget vs. consumed | "Are we within burn?" |
| `GET /api/observability/:companyId/bottlenecks` | Bottleneck-scored work items | "What's blocking forward motion?" |
| `GET /api/instance/:companyId/redundancy` | Slot-by-slot redundancy state | Single point of failure check |
| `POST /api/mission-control/:companyId/ask` | Ask the fleet a question via the CoS | Operator-style natural-language query |

## Procedure for "give me a fleet summary"

```bash
COMPANY_ID="<id>"

echo "--- Headline ---"
curl -fsS "http://localhost:3101/api/mission-control/$COMPANY_ID/headline" | jq -r .text

echo "--- Health orb ---"
curl -fsS "http://localhost:3101/api/mission-control/$COMPANY_ID/health-orb" | jq

echo "--- Pending decisions ---"
curl -fsS "http://localhost:3101/api/mission-control/$COMPANY_ID/decision-queue" | jq 'length as $n | "\($n) pending"'

echo "--- Budget ---"
curl -fsS "http://localhost:3101/api/observability/$COMPANY_ID/budget" | jq '{tokensUsed, tokensBudget, percent: (.tokensUsed/.tokensBudget*100)}'

echo "--- Top bottlenecks (top 3) ---"
curl -fsS "http://localhost:3101/api/observability/$COMPANY_ID/bottlenecks" | jq '.items[:3]'
```

## Success criteria

- Every endpoint above returns 200 + non-empty JSON
- The summary you give the user reflects what those endpoints actually returned (do not paraphrase, do not invent numbers)
- If anything is RED, you've already followed the `reason` field to the relevant deeper endpoint

## Verify-before-claim

WaveX agents are themselves required to attach independent probes to any "shipped/delivered/applied" claim (see `packages/onboarding-ui/public/agent-templates/_shared/SKILL_VERIFY_BEFORE_CLAIM.md`). When you're inspecting the fleet on behalf of a user, you're operating under the same rule: if you say "the fleet is healthy", paste the actual `/health-orb` response. If you say "no pending decisions", paste the `/decision-queue` count.

## Common failure modes

- **404 on an `:companyId` route:** the company exists on disk but never activated. Check `~/.wavex-os/instances/default/companies/<id>/` for a `company.manifest.json` + `manifest.sig`; if present, run [wavex-os-activate-and-ignite](../wavex-os-activate-and-ignite/SKILL.md).
- **`/headline` returns "no recent activity":** the fleet was activated but never ignited, or heartbeats are paused. Check `launchctl list | grep wavex` for paused jobs.
- **`/bottlenecks` empty:** could be genuinely unblocked OR the bottleneck-digest launchd job hasn't run yet (it's 12-hourly). Trigger manually: `POST /api/system/health/run-now`.

## Related skills

- [wavex-os-debug-healing](../wavex-os-debug-healing/SKILL.md) — if `/health-orb` is RED with a healing-related reason.
- [wavex-os-audit](../wavex-os-audit/SKILL.md) — if the server itself isn't responding.
