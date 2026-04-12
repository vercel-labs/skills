# Fork: @zot24/skills

This is a fork of [vercel-labs/skills](https://github.com/vercel-labs/skills/) (upstream package: `skills`).

## Installation

```bash
npx @zot24/skills add vercel-labs/agent-skills
```

## Why This Fork?

This fork adds declarative batch skill installation via TOML manifests, enabling:
- Team-wide skill synchronization
- Reproducible skill installations in CI/CD
- Multi-location installation for monorepos

It also changes telemetry from opt-out to opt-in (set `ENABLE_TELEMETRY=1` to enable).

## Fork Features

### Manifest Files (`--from-file`)

Install multiple skills from a TOML manifest file:

```bash
npx @zot24/skills add --from-file skills.toml
npx @zot24/skills add -f skills.toml -g -y
```

#### Manifest Format

Create a `skills.toml` file:

```toml
[[skills]]
source = "vercel-labs/agent-skills"
name = "frontend-design"
version = "1.0.0"

[[skills]]
source = "vercel-labs/agent-skills"
name = "code-review"

[[skills]]
source = "other-org/custom-skills"
name = "my-skill"
version = "2.0.0"
```

Each `[[skills]]` entry requires:
- `source`: Repository in `owner/repo` format or full git URL
- `name`: Name of the skill to install

Optional fields:
- `version`: Semantic version (e.g., `1.0.0`) - defaults to latest
- `locations`: Array of installation locations (see below)

### Multi-Location Installation

The `locations` array allows installing a skill to multiple directories:

```toml
[[skills]]
source = "vercel-labs/agent-skills"
name = "frontend-design"
locations = ["global", "packages/frontend", "packages/admin"]
```

Supported values:
- `"global"` - Install to user home directory
- `"project"` - Install to current working directory
- Custom relative paths (e.g., `"packages/my-app"`)

When `locations` is not specified, falls back to `--global` flag or interactive prompt.

### Lock File

A `-lock.toml` file is generated alongside the manifest (e.g., `skills-lock.toml`):

```toml
lockVersion = 1

[[skills]]
source = "vercel-labs/agent-skills"
name = "frontend-design"
version = "1.0.0"
resolvedRef = "a1b2c3d4e5f6789abc0123456789def012345678"
installedAt = "2026-01-16T12:00:00.000Z"
```

Use `--no-lock` to skip lock file generation.

### Reproducible Installations (`--frozen`)

```bash
# First, generate a lock file
npx @zot24/skills add --from-file skills.toml

# Then use --frozen for exact reproducibility
npx @zot24/skills add --from-file skills.toml --frozen
```

Frozen mode:
- Uses exact commit SHAs from the lock file
- Fails if any manifest skill is missing from the lock file
- Does not update the lock file

Useful for CI/CD pipelines and ensuring identical skill versions across machines.
