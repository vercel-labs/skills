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

Aliases: `skills a` works for `add`. `skills i`, `skills install` (no args) restore from `skills-lock.json`. `skills ls` works for `list`. `skills experimental_install` restores from `skills-lock.json`. `skills experimental_sync` crawls `node_modules` for skills.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing and init
├── update.ts        # Update scope, checking, deletion prompts and reinstallation
├── update-source.ts # Source URLs and path-targeted update arguments
├── skill-relocation.ts # Resolve locked paths against discovered locations
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
└── dist.test.ts               # Tests for built distribution
```

## Update Checking System

### How `skills update` Works

`skills check` and `skills upgrade` are aliases of `skills update` in `src/cli.ts`; they also reinstall changed skills rather than only reporting available updates. The implementation lives in `src/update.ts`.

1. Resolve project, global, or both scopes from the options, interactive choice, and presence of `skills-lock.json`.
2. Read the project `skills-lock.json` and/or global `~/.agents/.skill-lock.json`. Git sources are grouped by repository and ref; well-known sources use their catalog digests.
3. For global GitHub skills, fetch the repository tree once per group with `fetchRepoTree` in `src/blob.ts`. Requests start anonymously, then use an explicit `GITHUB_TOKEN`/`GH_TOKEN`, then `gh api` without exporting the GitHub CLI credential.
4. Project updates clone the source and discover skills. Global checks also fall back to a clone when API access is unavailable or a locked path has moved. `src/skill-relocation.ts` resolves locations before prompting about deleted skills.
5. Compare folder tree SHAs for global GitHub tree-hash entries, or computed content hashes for project and other Git entries. Relocated or changed skills are queued for reinstallation; unsupported legacy entries get a manual reinstall hint.
6. Reinstall changed skills by invoking the current CLI entrypoint directly (`node <repo>/bin/cli.mjs add <source> ...`) to avoid nested npm exec/npx behavior. `src/update-source.ts` retains the source host, ref, and supported skill subpath.

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature                    | Implementation                                        |
| -------------------------- | ----------------------------------------------------- |
| `skills add`               | `src/add.ts` - full implementation                    |
| `skills experimental_sync` | `src/sync.ts` - crawl node_modules                    |
| `skills check`             | Alias of `skills update`, routed to `src/update.ts`   |
| `skills update`            | `src/update.ts` checking + reinstall via `skills add` |

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
