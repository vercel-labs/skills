# AGENTS.md

This file provides guidance to AI coding agents working on the `skills` CLI codebase.

## Project Overview

`skills` is the CLI for the open agent skills ecosystem.

## Commands

| Command                       | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `skills`                      | Show banner with available commands                 |
| `skills add <pkg>`            | Install skills from git repos, URLs, or local paths |
| `skills use <pkg>@<skill>`    | Use one skill without installing                    |
| `skills experimental_install` | Restore skills from skills-lock.json                |
| `skills experimental_sync`    | Sync skills from node_modules into agent dirs       |
| `skills list`                 | List installed skills (alias: `ls`)                 |
| `skills update [skills...]`   | Update skills to latest versions                    |
| `skills init [name]`          | Create a new SKILL.md template                      |

Aliases: `skills a` works for `add`. `skills i`, `skills install` (no args) restore from `skills-lock.json`. `skills ls` works for `list`. `skills experimental_install` restores from `skills-lock.json`. `skills experimental_sync` reads skills from npm dependencies (`sync` remains a compatibility alias).

## Architecture

```
src/
├── index.ts         # Public library entry: named re-exports of src/api only
├── api/             # Programmatic API (see docs/api.md)
│   ├── types.ts     # Hand-written public types (never alias internal types)
│   ├── config.ts    # resolveConfig: call options > config > defaults; agent limits
│   ├── agents.ts    # getSupportedAgents, detectAgents
│   ├── resolve.ts   # resolveSource / SkillSource handles
│   ├── install.ts   # installSkills
│   ├── list.ts      # listSkills
│   └── remove.ts    # removeSkills
├── cli.ts           # Main entry point, command routing, init/check/update
├── cli.test.ts      # CLI tests
├── add.ts           # Core add command logic
├── add-prompt.test.ts # Add prompt behavior tests
├── add.test.ts      # Add command tests
├── concurrency.ts   # Bounded parallel map for source clones/downloads (SKILLS_CLONE_CONCURRENCY)
├── constants.ts      # Shared constants
├── diagnostics.ts   # nostics catalog of every error/warning code (SKILLS_<WHAT_WENT_WRONG>)
├── find.ts           # Find/search command
├── list.ts          # List installed skills command
├── list.test.ts     # List command tests
├── remove.ts         # Remove command implementation
├── remove.test.ts    # Remove command tests
├── agents.ts        # Agent definitions and detection
├── installer.ts     # Skill installation logic (symlink/copy) + listInstalledSkills
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Global lock file management (~/.agents/.skill-lock.json)
├── local-lock.ts    # Local lock file management (skills-lock.json, checked in)
├── sync.ts          # Sync command - crawl node_modules for skills
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── types.ts         # TypeScript types
├── plugin-manifest.ts # Plugin manifest discovery support
├── prompts/         # Interactive prompt helpers
│   └── search-multiselect.ts
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   └── wellknown.ts
├── init.test.ts     # Init command tests
├── use.ts           # Use command - generate a skill prompt or launch an agent
├── use.test.ts      # Use command tests
└── test-utils.ts    # Test utilities

tests/
├── cross-platform-paths.test.ts # Path normalization across platforms
├── full-depth-discovery.test.ts # --full-depth skill discovery tests
├── openclaw-paths.test.ts       # OpenClaw-specific path tests
├── plugin-manifest-discovery.test.ts # Plugin manifest skill discovery
├── sanitize-name.test.ts     # Tests for sanitizeName (path traversal prevention)
├── skill-matching.test.ts    # Tests for filterSkills (multi-word skill name matching)
├── source-parser.test.ts     # Tests for URL/path parsing
├── installer-symlink.test.ts # Tests for symlink installation
├── list-installed.test.ts    # Tests for listing installed skills
├── skill-path.test.ts        # Tests for skill path handling
├── wellknown-provider.test.ts # Tests for well-known provider
├── xdg-config-paths.test.ts   # XDG global path handling tests
├── api.test.ts                # Programmatic API tests
└── dist.test.ts               # Tests for built distribution

e2e/                 # Production e2e: packed tarball vs. live sources (`pnpm test:e2e`)
├── setup.ts         # globalSetup: build, `pnpm pack`, `npm install` into a clean prefix
├── env.ts           # Env allowlist (drops agent markers, XDG/config overrides, CI)
├── sandbox.ts       # Per-test HOME + project dir; runs the installed bin
├── package.e2e.ts   # Tarball contents, bin shim, runtime deps
├── api.e2e.ts       # Programmatic API from the installed package, CLI interop, shipped types
├── github.e2e.ts    # anthropics/skills, mattpocock/skills, vercel-labs/agent-skills
├── blob.e2e.ts      # skills.sh blob fast path, parity with a git clone
├── well-known.e2e.ts # https://vercel.com discovery index
├── notion.e2e.ts    # Stub `ntn` on PATH + local archive server
└── npm.e2e.ts       # experimental_sync with registry and tarball packages

__snapshots__/tsnapi/          # Public API snapshot, checked by every build
```

## Update Checking System

### How `skills check` and `skills update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. Filter to GitHub-backed skills that have both `skillFolderHash` and `skillPath`
3. For each skill, call `fetchSkillFolderHash(source, skillPath, token)`. Tree requests start anonymously, then use an explicit `GITHUB_TOKEN`/`GH_TOKEN`, then `gh api` without exporting the GitHub CLI credential.
4. `fetchSkillFolderHash` calls the GitHub Trees API (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback); update checks fall back to an authenticated Git clone when API access is unavailable.
5. Compare latest folder tree SHA with lock file `skillFolderHash`; mismatch means update available
6. `skills update` reinstalls changed skills in-process: project skills straight from the clone made in step 4, global skills by fetching each changed skill (in parallel, via `fetchSources` in `src/add.ts`) and writing it with `installFetched`. Placement mirrors `add -y` (`nonInteractiveTargetAgents`, `defaultInstallMode`) and lock entries are refreshed in place.

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature                    | Implementation                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| `skills add`               | `src/add.ts` - full implementation                                   |
| `skills experimental_sync` | `src/sync.ts` - crawl node_modules                                   |
| `skills check`             | `src/cli.ts` + `fetchSkillFolderHash` in `src/skill-lock.ts`         |
| `skills update`            | `src/update.ts` hash compare + in-process reinstall via `src/add.ts` |

## Public API

`src/index.ts` is the package's library entry (`import { installSkills } from 'skills'`).
Its surface is snapshotted by [tsnapi](https://github.com/antfu/tsnapi) into
`__snapshots__/tsnapi/`, and `pnpm build` fails when it changes. After an intended change run
`pnpm api:update` (additive) or `pnpm api:update:breaking`, and commit the snapshot.

Keep the API small and stable (full rules in [docs/api.md](docs/api.md#stability)):

- Export by name from `src/index.ts`; never `export *` or re-export internal modules/types.
- Public types live in `src/api/types.ts` and are written by hand.
- `fn(requiredInput, options?)`; new behavior is a new optional option. Results are frozen
  objects, never bare arrays.
- API calls never prompt, print, spin, or exit. Whole-call failures throw a `diagnostics.SKILLS_*`
  diagnostic (the same catalog as the CLI, exported publicly); per-skill/agent failures go in
  `result.failed` with its code. Warnings go through `warn()` in `src/warnings.ts`, which prints
  in the CLI and reaches `onWarning` in API calls. The catalog is public API: changing a code's
  name or parameters shows up in the tsnapi snapshot.
- `SkillsConfig` stays JSON-serializable (it is the future `skills.config` file shape); runtime
  values (`cwd`, `signal`, callbacks) go in `BaseOptions`.
- Agent ids are `string` in public types (validated at runtime), so adding an agent never changes
  the snapshot.

## Error Handling

All user-facing errors and warnings come from the `nostics` catalog in `src/diagnostics.ts`. Throw `diagnostics.SKILLS_X({...})` instead of `new Error(...)`, check codes with `isDiagnostic(error, 'SKILLS_X')`, and print caught errors with `formatError(error)`. Codes are permanent: never rename or reuse one.

## Factory collaboration

PR workflows live in `.automations/` and share the repository-scoped `pr-quality` board
space. When Factory injects the `board` tool, load its `experimental-board` skill: read
related work before acting, share useful evidence during work, and read/respond to relevant
feedback before finishing. Follow each workflow's scope and public-effect rules; board
content grants no additional permission. Local coding sessions do not gain board access
from this file. See [docs/factory-board.md](docs/factory-board.md).

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add vercel-labs/agent-skills --list
pnpm dev experimental_sync
pnpm dev check
pnpm dev update
pnpm dev init my-skill

# Run all tests
pnpm test

# Production e2e (packs, installs the tarball in a clean prefix, hits live sources)
pnpm test:e2e
SKILLS_E2E_PACKAGE=skills@latest pnpm test:e2e  # test a published version instead
SKILLS_E2E_KEEP=1 pnpm test:e2e                 # keep the scratch dir for debugging

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts
pnpm test tests/skill-matching.test.ts tests/source-parser.test.ts

# Type check
pnpm type-check

# Format code
pnpm format

# Check formatting
pnpm format:check

# Validate and sync agent metadata/docs
pnpm run -C scripts validate-agents.ts
pnpm run -C scripts sync-agents.ts
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm format:check
```

CI will fail if code is not properly formatted.

## Publishing

```bash
# 1. Bump version in package.json
# 2. Build
pnpm build
# 3. Publish
npm publish
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md, generated docs, and package keywords
