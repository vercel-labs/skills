# AGENTS.md

This file provides guidance to AI coding agents working on the `synk` CLI codebase.

## Project Overview

`synk` is the CLI for the open agent cognitive ecosystem. It supports multiple cognitive types: skills, agents, and prompts.

## Commands

| Command              | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `synk`               | Show banner with available commands                      |
| `synk init [name]`   | Create a new cognitive template                          |
| `synk add <pkg>`     | Install cognitives from git repos, URLs, or local paths  |
| `synk list`          | List installed cognitives (alias: `ls`)                  |
| `synk find`          | Search cognitives                                        |
| `synk remove`        | Remove cognitives                                        |
| `synk check`         | Check for available cognitive updates                    |
| `synk update`        | Update all cognitives to latest versions                 |

Aliases: `synk a`, `synk i`, `synk install` all work for `add`. `synk ls` works for `list`.

## Architecture

```
src/
├── cli.ts                          # Entry point + routing (~100 LOC)
│
├── commands/                       # Command implementations
│   ├── add.ts                      # Install cognitives (unified pipeline)
│   ├── init.ts                     # Scaffold cognitives
│   ├── list.ts                     # List installed cognitives
│   ├── remove.ts                   # Remove cognitives
│   ├── find.ts                     # Search cognitives
│   ├── check.ts                    # Check for updates
│   └── update.ts                   # Update cognitives
│
├── services/
│   ├── discovery/                  # Find cognitives in filesystem
│   │   ├── scanner.ts              # discoverCognitives, findCognitiveDirs
│   │   ├── parser.ts               # parseCognitiveMd, hasCognitiveMd
│   │   ├── plugin-manifest.ts      # getPluginSkillPaths
│   │   └── index.ts
│   ├── installer/                  # Install cognitives
│   │   ├── orchestrator.ts         # installCognitiveForAgent, installRemote
│   │   ├── file-ops.ts             # copyDirectory, createSymlink
│   │   ├── paths.ts                # getCanonicalDir, getInstallPath, sanitizeName
│   │   ├── listing.ts              # listInstalledCognitives, isCognitiveInstalled
│   │   └── index.ts
│   ├── lock/                       # Lock file management
│   │   ├── lock-file.ts            # readLockFile, writeLockFile, addCognitiveToLock
│   │   └── index.ts
│   ├── registry/                   # Agent registry
│   │   ├── agents.ts               # 40+ agent configs
│   │   ├── detection.ts            # detectInstalledAgents
│   │   ├── helpers.ts              # getCognitiveDir, isUniversalForType
│   │   └── index.ts
│   ├── source/                     # Source resolution
│   │   ├── parser.ts               # parseSource, getOwnerRepo
│   │   ├── git.ts                  # cloneRepo, cleanupTempDir
│   │   ├── mintlify.ts             # fetchMintlifySkill (legacy)
│   │   └── index.ts
│   └── telemetry/
│       └── index.ts                # track(), setVersion()
│
├── ui/                             # Presentation layer
│   ├── banner.ts                   # showLogo, showBanner, showHelp
│   ├── formatters.ts               # shortenPath, formatList, buildResultLines
│   ├── prompts.ts                  # selectAgentsInteractive, promptForAgents
│   └── search-multiselect.ts       # Custom @clack/prompts component
│
├── providers/                      # Remote skill providers
│   ├── index.ts
│   ├── types.ts
│   ├── registry.ts
│   ├── wellknown.ts
│   ├── huggingface.ts
│   └── mintlify.ts
│
├── core/                           # Shared types and constants
│   ├── types.ts
│   ├── constants.ts
│   └── index.ts
│
└── __tests__/                      # Tests
    ├── test-utils.ts
    ├── commands/
    │   ├── cli.test.ts
    │   ├── add.test.ts
    │   ├── add-prompt.test.ts
    │   ├── init.test.ts
    │   ├── list.test.ts
    │   └── remove.test.ts
    └── services/
        └── source-parser.test.ts

tests/                              # Integration tests
├── sanitize-name.test.ts
├── skill-matching.test.ts
├── source-parser.test.ts
├── installer-symlink.test.ts
├── list-installed.test.ts
├── skill-path.test.ts
├── cross-platform-paths.test.ts
├── full-depth-discovery.test.ts
├── plugin-manifest-discovery.test.ts
├── wellknown-provider.test.ts
├── xdg-config-paths.test.ts
└── dist.test.ts
```

## Update Checking System

### How `synk check` and `synk update` Work

1. Read `~/.agents/.skill-lock.json` for installed cognitives
2. For each cognitive, get `skillFolderHash` from lock file
3. POST to `https://add-skill.vercel.sh/check-updates` with:
   ```json
   {
     "skills": [{ "name": "...", "source": "...", "skillFolderHash": "..." }],
     "forceRefresh": true
   }
   ```
4. API fetches fresh content from GitHub, computes hash, compares
5. Returns list of cognitives with different hashes (updates available)

### Why `forceRefresh: true`?

Both `check` and `update` always send `forceRefresh: true`. This ensures the API fetches fresh content from GitHub rather than using its Redis cache.

**Without forceRefresh:** Users saw phantom "updates available" due to stale cached hashes. The fix was to always fetch fresh.

**Tradeoff:** Slightly slower (GitHub API call per skill), but always accurate.

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the cognitive folder).

If reading an older lock file version, it's wiped. Users must reinstall cognitives to populate the new format.

## Key Integration Points

| Feature          | Implementation                                    |
| ---------------- | ------------------------------------------------- |
| `synk add`       | `src/commands/add.ts` - full implementation       |
| `synk find`      | `src/commands/find.ts` - search cognitives        |
| `synk remove`    | `src/commands/remove.ts` - remove cognitives      |
| `synk check`     | `POST /check-updates` API                         |
| `synk update`    | `POST /check-updates` + reinstall per cognitive   |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add vercel-labs/agent-skills --list
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
```

## Code Style

This project uses Prettier for code formatting. **Always run `pnpm format` before committing changes** to ensure consistent formatting.

```bash
# Format all files
pnpm format

# Check formatting without fixing
pnpm prettier --check .
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

1. Add the agent definition to `src/services/registry/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
