---
name: github-actions-ci
description: GitHub Actions for Next.js and TypeScript - lint test build cache and PR checks
---

# Instructions

## When to Use

- Use for PR CI: lint, typecheck, test, build, cache.
- Prefer `secure-dependencies` for audit/frozen lockfile policy.
- Prefer `monorepo-tooling` for turbo task graphs first.

Add or improve **GitHub Actions** for a **Next.js** + **pnpm** repo.

1. **Workflow permissions:** default `contents: read` at workflow or job level; elevate `id-token` or `packages` only where OIDC/npm publish needs it - least privilege.
2. **Concurrency:** `group: ${{ github.workflow }}-${{ github.ref }}` + `cancel-in-progress: true` on PR workflows to save minutes and avoid stale deploys.
3. Triggers: `pull_request` + `push` to `main`; optional `workflow_dispatch`.
4. **pnpm:** `pnpm/action-setup` + cache via `pnpm store path` or built-in cache; always **`pnpm install --frozen-lockfile`** in CI.
5. Jobs: `lint` → `typecheck` → `test` → `build` with `needs` where parallel is impossible; optional parallel **`audit`** job (`pnpm audit --audit-level=high` or org policy) - see `secure-dependencies`.
6. **Next build:** set `NODE_OPTIONS` only if required; artifact `next build` trace for failures optional.
7. **Fork PRs:** `pull_request_target` avoided unless user understands risk; default `pull_request`.
8. **Node version:** pin `22` or `20` LTS with `actions/setup-node` and match `engines` in `package.json`.
## Outcomes

- Workflow file path + YAML body or diff against existing workflow.

## Output Rules

Fenced `yaml` for workflow; mention required secrets by name only.

## Scope and boundaries

- **In scope:** CI YAML, cache, job graph.
- **Out of scope:** self-hosted runner fleet design, Kubernetes deploy.

## Safety

- Never echo `GITHUB_TOKEN` patterns; use `${{ secrets.* }}` placeholders.

## Troubleshooting

- **pnpm frozen-lockfile fails:** align CI with lockfile version from contributor.
- **OOM on build:** split build job memory or enable standalone output only if user wants.

## Related skills

- [`secure-dependencies`](../secure-dependencies/SKILL.md) - lockfile and audit in CI
- [`monorepo-tooling`](../monorepo-tooling/SKILL.md) - turbo pipelines in Actions
- [`dependency-migrations`](../dependency-migrations/SKILL.md) - major upgrade gates

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/github-actions-ci/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
