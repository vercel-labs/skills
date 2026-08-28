---
name: wavex-os-init
description: Install WaveX OS and walk a user through the 5-pillar wizard to provision their first AI agent company on localhost.
---

# wavex-os-init

Install WaveX OS on a user's machine and drive the first-run wizard to a signed `company.manifest.json`. This is the canonical entry point — the user goes from empty machine to an activated 5–35 agent fleet running under their Claude Max OAuth.

## When to use

- User says "set up wavex-os" / "install wavex" / "start a new agent company"
- User has Node 20+ and a Claude Max subscription but nothing else
- User has run `wavex-os` before but wants to provision a *new* company on the same install — in that case use [wavex-os-provision-company](../wavex-os-provision-company/SKILL.md) instead

## Preconditions

Verify before starting:

```bash
node --version          # must be >= 20.10
which claude            # must resolve to a Claude CLI binary
claude --version        # confirms OAuth-capable build
```

If `claude` is missing, point the user at https://docs.anthropic.com/claude/code (Claude Code installs the CLI). Do **not** ask the user for an `ANTHROPIC_API_KEY` — WaveX uses Claude Max OAuth via the system keychain.

## Procedure

1. **Install the CLI globally:**
   ```bash
   npm install -g wavex-os-installer
   ```

2. **Run the doctor first** — this is non-destructive and catches setup issues before the wizard:
   ```bash
   wavex-os doctor
   ```
   Resolve any red checks before continuing. Common failures:
   - Port `5173` or `3101` in use → kill the conflicting process or set `WAVEX_UI_PORT` / `WAVEX_API_PORT`
   - Keychain missing Claude OAuth — user must run `claude` once and complete login

3. **Launch the wizard:**
   ```bash
   wavex-os init
   ```
   This opens `http://localhost:5173` in the browser. The wizard runs entirely on localhost — no telemetry, no remote inference.

4. **Walk the 5 pillars + 3 phases:**
   | Step | What the user does |
   |---|---|
   | Pillar 1 — Who | One paragraph in plain text describing what they're building. T2 enrichment infers 10 fields. User reviews + corrects. |
   | Pillar 2 — Setup | Confirms Claude CLI + plan tier (defaults Max 5×). |
   | Pillar 3 — Product state | pre-product / live / 10K-100K MRR / etc. Drives roster shape. |
   | Pillar 4 — GTM motion | Lead sources × sales motion. Shapes the KPI tree. |
   | Pillar 5 — Comms | Telegram / Slack / email destination for board signals. |
   | Phase 2 — Connectors | Decision matrix proposes integrations; user accepts or skips per-connector. |
   | Phase 3 — Swarm | Reactflow org chart of the proposed roster. User can swap templates per slot. |
   | Phase 4 — Workflow | Initial workload + bundle allocation per agent. |
   | Finalize | Click *Finalize + sign*. Monte Carlo simulation runs. Signed `company.manifest.json` lands on disk. |

5. **Activate the fleet:** click *Activate fleet →* once the signature lands. This is the last point before agents go live.

## Success criteria

- `~/.wavex-os/instances/default/companies/<companyId>/onboarding/company.manifest.json` exists and has a sibling `manifest.sig`
- Mission Control loads at `http://localhost:5173/mission-control/<companyId>` with the KPI scoreboard populated
- `GET http://localhost:3101/api/instance/<companyId>/redundancy` returns 200

## Common failure modes

- **Pillar 1 enrichment hangs:** T2 inference call timed out. Check `claude` is callable: `claude -p "hello"`. If that fails, fix Claude CLI first.
- **Connector concierge can't save credentials:** the vault keychain entry was rejected. Re-run `wavex-os doctor` — the keychain section will show what's wrong.
- **Activate fails with `manifest.sig invalid`:** the manifest was edited after signing. Re-finalize from the wizard.

## Related skills

- After init, drive a second company through with [wavex-os-provision-company](../wavex-os-provision-company/SKILL.md).
- For diagnostics: [wavex-os-audit](../wavex-os-audit/SKILL.md).
- For post-activate work: [wavex-os-activate-and-ignite](../wavex-os-activate-and-ignite/SKILL.md).
