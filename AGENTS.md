# AGENTS.md

This file provides guidance to AI coding agents working on the `agents` CLI codebase.

## Project Overview

`agents` is the CLI for the open agent distribution ecosystem.

## Commands

| Command                       | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `agents`                      | Show banner with available commands                 |
| `agents add <pkg>`            | Install agents from git repos, URLs, or local paths |
| `agents experimental_install` | Restore agents from agents-lock.json                |
| `agents experimental_sync`    | Sync agents from node_modules into target dirs      |
| `agents list`                 | List installed agents (alias: `ls`)                 |
| `agents check`                | Check for available agent updates                   |
| `agents update`               | Update all agents to latest versions                |
| `agents init [name]`          | Create a new AGENT.md template                      |

Aliases: `agents a` works for `add`. `agents i`, `agents install` (no args) restore from `agents-lock.json`. `agents ls` works for `list`. `agents experimental_install` restores from `agents-lock.json`. `agents experimental_sync` crawls `node_modules` for agents.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, init/check/update
├── cli.test.ts      # CLI tests
├── add.ts           # Core add command logic
├── add.test.ts      # Add command tests
├── list.ts          # List installed agents command
├── list.test.ts     # List command tests
├── targets.ts       # Target definitions and detection
├── installer.ts     # Agent installation logic (symlink/copy) + listInstalledAgents
├── agents.ts        # Agent discovery and parsing
├── agent-lock.ts    # Global lock file management (~/.agents/.agent-lock.json)
├── local-lock.ts    # Local lock file management (agents-lock.json, checked in)
├── sync.ts          # Sync command - crawl node_modules for agents
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── types.ts         # TypeScript types
├── providers/       # Remote agent providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   └── mintlify.ts
├── init.test.ts     # Init command tests
└── test-utils.ts    # Test utilities

tests/
├── sanitize-name.test.ts     # Tests for sanitizeName (path traversal prevention)
├── agent-matching.test.ts    # Tests for filterAgents (multi-word agent name matching)
├── source-parser.test.ts     # Tests for URL/path parsing
├── installer-symlink.test.ts # Tests for symlink installation
├── list-installed.test.ts    # Tests for listing installed agents
├── agent-path.test.ts        # Tests for agent path handling
├── wellknown-provider.test.ts # Tests for well-known provider
└── dist.test.ts              # Tests for built distribution
```

## Update Checking System

### How `agents check` and `agents update` Work

1. Read `~/.agents/.agent-lock.json` for installed agents
2. For each agent, get `agentFolderHash` from lock file
3. POST to `https://add-agent.vercel.sh/check-updates` with:
   ```json
   {
     "agents": [{ "name": "...", "source": "...", "agentFolderHash": "..." }],
     "forceRefresh": true
   }
   ```
4. API fetches fresh content from GitHub, computes hash, compares
5. Returns list of agents with different hashes (updates available)

### Why `forceRefresh: true`?

Both `check` and `update` always send `forceRefresh: true`. This ensures the API fetches fresh content from GitHub rather than using its Redis cache.

**Without forceRefresh:** Users saw phantom "updates available" due to stale cached hashes. The fix was to always fetch fresh.

**Tradeoff:** Slightly slower (GitHub API call per agent), but always accurate.

### Lock File Compatibility

The lock file format is v3. Key field: `agentFolderHash` (GitHub tree SHA for the agent folder).

If reading an older lock file version, it's wiped. Users must reinstall agents to populate the new format.

## Key Integration Points

| Feature                    | Implementation                              |
| -------------------------- | ------------------------------------------- |
| `agents add`               | `src/add.ts` - full implementation          |
| `agents experimental_sync` | `src/sync.ts` - crawl node_modules          |
| `agents check`             | `POST /check-updates` API                   |
| `agents update`            | `POST /check-updates` + reinstall per agent |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add vercel-labs/agents --list
pnpm dev experimental_sync
pnpm dev check
pnpm dev update
pnpm dev init my-agent

# Run all tests
pnpm test

# Run specific test file(s)
pnpm test tests/sanitize-name.test.ts
pnpm test tests/agent-matching.test.ts tests/source-parser.test.ts

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

## Adding a New Target

1. Add the target definition to `src/targets.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
