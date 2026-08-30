# Dependency and supply-chain hygiene (Node / pnpm)

Short reference for skills. Pair with `secure-dependencies` and `github-actions-ci`.

## Baselines

- **Lockfile always committed** (`pnpm-lock.yaml`, `package-lock.json`, or `yarn.lock`). CI must use `pnpm install --frozen-lockfile` (or npm `ci`).
- **Single registry** default (`https://registry.npmjs.org/`). Document mirrors if corporate.
- **Node LTS** for production builds: 20.x or 22.x; match `engines` in `package.json` to what you test in CI.

## Audits and automation

- Run **`pnpm audit`** (or `npm audit`) on every PR; treat **high** as merge blockers unless documented exception with expiry date.
- **GitHub Dependency review** (or equivalent) on PRs that touch lockfiles - blocks known-vulnerable versions.
- **Renovate or Dependabot** with grouped minor/patch updates reduces noise; major bumps stay manual with `dependency-migrations` skill.

## Install scripts and postinstall

- Malicious or compromised packages run **`preinstall` / `postinstall`**. Prefer **`ignore-scripts=true`** in `.npmrc` when feasible, then allowlist only packages that need lifecycle scripts (document each).
- **pnpm** `onlyBuiltDependencies` / `pnpm approve-builds` (pnpm 9+) - review native compile steps before approving.

## Names and typosquatting

- Prefer **scoped packages** (`@org/name`) for internal and well-known vendors.
- Before adding a new dependency: verify publisher, weekly downloads, repo URL, and that the name matches the import you intend.

## Secrets in packages

- Never put tokens in `package.json` scripts or `.npmrc` committed to git. Use CI secrets and local env only.
