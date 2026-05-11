# AGENTS.md

This file provides guidance to AI coding agents working on the `agentart` CLI codebase.

## Project Overview

`agentart` is the CLI for the open agent skills ecosystem.

## Commands

| Command                         | Description                                         |
| ------------------------------- | --------------------------------------------------- |
| `agentart`                      | Show banner with available commands                 |
| `agentart add <pkg>`            | Install skills from git repos, URLs, or local paths |
| `agentart experimental_install` | Restore skills from agentart-lock.json              |
| `agentart experimental_sync`    | Sync skills from node_modules into agent dirs       |
| `agentart list`                 | List installed skills (alias: `ls`)                 |
| `agentart update [skills...]`   | Update skills to latest versions                    |
| `agentart init [name]`          | Create a new SKILL.md template                      |

Aliases: `agentart a` works for `add`. `agentart i`, `agentart install` (no args) restore from `agentart-lock.json`. `agentart ls` works for `list`. `agentart experimental_install` restores from `agentart-lock.json`. `agentart experimental_sync` crawls `node_modules` for skills.

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
├── agents.ts        # Agent definitions and detection
├── installer.ts     # Skill installation logic (symlink/copy) + listInstalledSkills
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Global lock file management (~/.agents/.skill-lock.json)
├── local-lock.ts    # Local lock file management (agentart-lock.json, checked in)
├── sync.ts          # Sync command - crawl node_modules for skills
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
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
└── dist.test.ts               # Tests for built distribution
```

## Update Checking System

### How `agentart check` and `agentart update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. Filter to GitHub-backed skills that have both `skillFolderHash` and `skillPath`
3. For each skill, call `fetchSkillFolderHash(source, skillPath, token)`. Optional auth token is sourced from `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token` to improve rate limits.
4. `fetchSkillFolderHash` calls GitHub Trees API directly (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback)
5. Compare latest folder tree SHA with lock file `skillFolderHash`; mismatch means update available
6. `agentart update` reinstalls changed skills by invoking the current Bun source entrypoint during development or the current compiled executable in binary builds

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature                      | Implementation                                                  |
| ---------------------------- | --------------------------------------------------------------- |
| `agentart add`               | `src/add.ts` - full implementation                              |
| `agentart experimental_sync` | `src/sync.ts` - crawl node_modules                              |
| `agentart check`             | `src/cli.ts` + `fetchSkillFolderHash` in `src/skill-lock.ts`    |
| `agentart update`            | `src/cli.ts` direct hash compare + reinstall via `agentart add` |

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Test locally
bun run dev add vercel-labs/agent-skills --list
bun run dev experimental_sync
bun run dev check
bun run dev update
bun run dev init my-skill

# Run all tests
bun run test

# Run specific test file(s)
bun run test tests/sanitize-name.test.ts
bun run test tests/skill-matching.test.ts tests/source-parser.test.ts

# Type check
bun run type-check

# Format code
bun run format

# Check formatting
bun run format:check

# Validate and sync agent metadata/docs
bun run validate:agents
bun run sync:agents
```

## Code Style

This project uses Prettier for code formatting. **Always run `bun run format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
bun run format

# Check formatting without fixing
bun run format:check
```

CI will fail if code is not properly formatted.

## Releasing

```bash
# 1. Bump version in package.json
# 2. Build the local platform executable
bun run build
# 3. Build release executables
bun run build:release
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `bun run validate:agents` to validate
3. Run `bun run sync:agents` to update README.md and package keywords
