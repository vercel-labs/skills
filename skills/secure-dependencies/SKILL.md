---
name: secure-dependencies
description: Lockfiles, audits, install-script risk, and CI dependency review for Node and pnpm - reduce supply-chain surprises
---

# Instructions

Improve **dependency hygiene** and **supply-chain** posture for a **Node** repo (prefer **pnpm**).

1. Confirm **lockfile is committed** and CI uses **frozen install** (`pnpm install --frozen-lockfile`).
2. Add or verify **audit on PR** (`pnpm audit --audit-level=high` or org standard); document exit code policy.
3. Enable **dependency review** on lockfile PRs when on GitHub - link to org setting if missing.
4. **Lifecycle scripts:** evaluate `ignore-scripts` / pnpm **trusted dependency builds**; list packages that truly need `postinstall`.
5. **New deps:** require justification, scoped name when possible, link to repo + last release date.
6. Pair with **`dependency-migrations`** for majors - never stack unrelated major bumps.

## Outcomes

- Markdown policy section + optional `.npmrc` / workflow snippet titles (user pastes content).

## Output Rules

suggest-shell: give exact commands; user runs them. No `curl | sh` from untrusted URLs.

## Scope and boundaries

- **In scope:** npm/pnpm/yarn lockfiles, audit, CI gates, install-script policy.
- **Out of scope:** SLSA full provenance, custom binary signing.

## Safety

- Do not add registry auth tokens to files; use CI secrets.

## Troubleshooting

- **Audit noise in monorepos:** run `pnpm audit --prod` to prioritize runtime deps when dev-only tooling drowns signal; still review dev tooling for supply-chain risk periodically.
- **False positives:** document CVE ID + reason for allowlist entry with owner and review date.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/secure-dependencies/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
