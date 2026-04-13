# AGENTS.md

This file provides guidance to AI coding agents working on the `skills` CLI codebase.

## Project Overview

`skills` is the CLI for the open agent skills ecosystem.

## Commands

| Command                       | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| `skills`                      | Show banner with available commands                              |
| `skills add <pkg>`            | Install skills from git repos, URLs, or local paths              |
| `skills remove [skills...]`   | Remove installed skills and scrub management metadata             |
| `skills enable [skills...]`   | Enable disabled skills (also accepts `--group` or `--all`)       |
| `skills disable [skills...]`  | Disable skills without removing them (`--group` or `--all`)      |
| `skills group <action>`       | Manage skill groups (create, delete, add, remove)                |
| `skills manager <action>`     | Manage the protected manager skill (set, show, clear)            |
| `skills experimental_install` | Restore skills from skills-lock.json                             |
| `skills experimental_sync`    | Sync skills from node_modules into agent dirs                    |
| `skills list`                 | List installed skills (alias: `ls`)                              |
| `skills update [skills...]`   | Update skills to latest versions                                 |
| `skills init [name]`          | Create a new SKILL.md template                                   |

Aliases: `skills a` works for `add`. `skills i`, `skills install` (no args) restore from `skills-lock.json`. `skills ls` works for `list`. `skills rm` / `skills r` works for `remove`. `skills experimental_install` restores from `skills-lock.json`. `skills experimental_sync` crawls `node_modules` for skills.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, init/check/update
├── cli.test.ts      # CLI tests
├── add.ts           # Core add command logic
├── add-prompt.test.ts # Add prompt behavior tests
├── add.test.ts      # Add command tests
├── constants.ts      # Shared constants
├── find.ts           # Find/search command
├── list.ts          # List installed skills command
├── list.test.ts     # List command tests
├── remove.ts         # Remove command implementation
├── remove.test.ts    # Remove command tests
├── management.ts     # Enable/disable, group, and manager command handlers
├── management.test.ts # Management command integration tests
├── management-state.ts # Management data model, group/manager helpers, lockfile scrubbing
├── management-filesystem.ts # Skill status detection (enabled/disabled/inconsistent/missing) and move helpers
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
├── mintlify.ts      # Mintlify skill fetching (legacy)
├── plugin-manifest.ts # Plugin manifest discovery support
├── prompts/         # Interactive prompt helpers
│   └── search-multiselect.ts
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   ├── mintlify.ts
│   └── wellknown.ts
├── init.test.ts     # Init command tests
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
├── management-filesystem.test.ts # Skill status detection and enable/disable filesystem ops
├── skill-lock.test.ts         # Global lock management state and v3→v4 migration tests
└── dist.test.ts               # Tests for built distribution
```

## Update Checking System

### How `skills check` and `skills update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. Filter to GitHub-backed skills that have both `skillFolderHash` and `skillPath`
3. For each skill, call `fetchSkillFolderHash(source, skillPath, token)`. Optional auth token is sourced from `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to improve rate limits.
4. `fetchSkillFolderHash` calls GitHub Trees API directly (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback)
5. Compare latest folder tree SHA with lock file `skillFolderHash`; mismatch means update available
6. `skills update` reinstalls changed skills by invoking the current CLI entrypoint directly (`node <repo>/bin/cli.mjs add <source-tree-url> -g -y`) to avoid nested npm exec/npx behavior

### Lock File Compatibility

The global lock file format is v4. The project lock file format is v2. Both include a `management` section for groups and `managerSkill`.

Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

Lockfile migrations are explicit: global v3→v4 and project v1→v2 preserve existing data and add an empty `management` block. Only invalid or unsupported versions are wiped.

## Key Integration Points

| Feature                    | Implementation                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| `skills add`               | `src/add.ts` - full implementation                                   |
| `skills remove`            | `src/remove.ts` - remove files + scrub lockfile/groups/manager       |
| `skills enable/disable`    | `src/management.ts` → `src/management-filesystem.ts` for moves      |
| `skills group`             | `src/management.ts` → `src/management-state.ts` for lockfile CRUD   |
| `skills manager`           | `src/management.ts` → lockfile `managerSkill` field                  |
| `skills experimental_sync` | `src/sync.ts` - crawl node_modules                                   |
| `skills check`             | `src/cli.ts` + `fetchSkillFolderHash` in `src/skill-lock.ts`        |
| `skills update`            | `src/cli.ts` direct hash compare + reinstall via `skills add`        |

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
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md and package keywords
