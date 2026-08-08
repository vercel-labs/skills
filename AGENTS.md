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

### How `skills check` and `skills update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. Filter to GitHub-backed skills that have both `skillFolderHash` and `skillPath`
3. For each skill, call `fetchSkillFolderHash(source, skillPath, token)`. Tree requests start anonymously, then use an explicit `GITHUB_TOKEN`/`GH_TOKEN`, then `gh api` without exporting the GitHub CLI credential.
4. `fetchSkillFolderHash` calls the GitHub Trees API (`/git/trees/<branch>?recursive=1` for `main`, then `master` fallback); update checks fall back to an authenticated Git clone when API access is unavailable.
5. Compare latest folder tree SHA with lock file `skillFolderHash`; mismatch means update available
6. `skills update` reinstalls changed skills by invoking the current CLI entrypoint directly (`node <repo>/bin/cli.mjs add <source-tree-url> -g -y`) to avoid nested npm exec/npx behavior

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature                    | Implementation                                                |
| -------------------------- | ------------------------------------------------------------- |
| `skills add`               | `src/add.ts` - full implementation                            |
| `skills experimental_sync` | `src/sync.ts` - crawl node_modules                            |
| `skills check`             | `src/cli.ts` + `fetchSkillFolderHash` in `src/skill-lock.ts`  |
| `skills update`            | `src/cli.ts` direct hash compare + reinstall via `skills add` |

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

## Installing (this fork)

This fork is **not published to npm**. The global `skills` command is symlinked to
the local checkout (see [Fork Notes](#fork-notes)), so "installing" means building
the repo and letting the symlink pick it up:

```bash
pnpm install   # first time, or after dependency changes
pnpm build     # rebuild dist/; the symlinked `skills` reflects it immediately
```

Do not run `npm publish` — there is no publish path for this fork.

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md and package keywords

## Fork Notes

This repository is a fork of `vercel-labs/skills`. The fork is hosted at `bermudi/skills-cli` and `origin` is configured to point to that fork, while `upstream` points to `vercel-labs/skills`.

### Custom changes

This fork keeps exactly two features on top of upstream:

#### 1. `disable-model-invocation` frontmatter field

When `disable-model-invocation: true` is set in a `SKILL.md` frontmatter, the skill is hidden from the agent's system prompt and users must explicitly invoke it via `/skill:name`.

Key changes:

- `src/types.ts` — adds `disableModelInvocation?: boolean` to the `Skill` interface
- `src/skills.ts` — parses `disable-model-invocation` in `parseSkillMd`
- `src/blob.ts` — carries the field through the blob install path
- `src/installer.ts` — surfaces the field on `InstalledSkill` and `listInstalledSkills`
- `src/list.ts` — includes the field in `--json` output only when `true`
- `tests/skill-matching.test.ts` — adds tests for the new field

#### 2. File-based `--debug` logging (never breaks the TUI)

Debug output goes to a file instead of stderr so the Clack pretty TUI stays intact.

- Default: `$XDG_STATE_HOME/skills/debug.log` else `~/.local/state/skills/debug.log`
- Overrides (first wins): `--debug=/path` (rel to cwd), `SKILLS_DEBUG_FILE`, `SKILLS_DEBUG` when it looks like a path (`/` or `\` or ends with `.log`), else default
- Escape hatch: `SKILLS_DEBUG=stderr` (or `SKILLS_DEBUG_FILE=stderr`) restores stderr
- First write: `mkdir -p`, `>5MB` rotate to `debug.log.1`, header with ISO time, args, version (`bermudi fork`), cwd
- Every `debug()`/`debugFs()`/`debugApi()` appends with `[HH:MM:SS.mmm] [debug:ns]` and redaction (Bearer tokens, `ghp_`/`gho_`/`github_pat_`, `token=`, `GITHUB_TOKEN=`), sync for `process.exit` safety
- Exit: single `Debug log: ...` line to stderr

Key changes:

- `src/debug.ts` (new, ~303 lines) — file sink, rotation, redaction, header, `getLogFilePath`/`getDisplayLogPath`/`setDebugFile`/`isStderrMode`/`isDebugEnabled`/`enableDebug`/`isDebugFlag`
- `src/cli.ts` — parses `--debug`/`--verbose`/`-d` (including `--debug=/path`), propagates via `SKILLS_DEBUG_FILE` to `update` child, banner/version show `bermudi fork`, prints `Debug log: ...` at exit; added `Global Options` to help
- Instrumented call sites: `src/skills.ts` (`hasSkillMd`, `parseSkillMd`, `findSkillDirs`, `discoverSkills` timing), `src/blob.ts` (tree fetches), `src/git.ts` (clone), `src/source-parser.ts` (API), `src/installer.ts` (FS ops), `src/local-lock.ts`/`src/skill-lock.ts`/`src/sync.ts`/`src/telemetry.ts`/`src/find.ts`
- `src/debug.test.ts` (new) — unit tests for log path resolution/rotation; `src/cli.test.ts` — integration tests asserting output goes to file not stderr and `--json` stays pure; `src/test-utils.ts` — uses `spawnSync` for uniform stdout/stderr capture

### Syncing with upstream

To pull the latest `vercel-labs/skills` changes and rebuild the installed CLI:

```bash
git fetch upstream
git rebase upstream/main
pnpm install
pnpm build
```

If the rebase rewrites `main`, push the updated branch to the fork with force-lease:

```bash
git push --force-with-lease origin main
```

The global `skills` command is directly symlinked to the local entrypoint at `~/.local/bin/skills -> /home/daniel/build/skills-CLI/bin/cli.mjs`, so after `pnpm build` the installed CLI reflects the current code immediately. It is not installed through npm or pnpm's global package store.

### Backup branches

- `backup/main` holds the pre-rebase merge history from `668aad7`.
- `backup/pre-trim-2026-08-08` holds the state before trimming to two features (had store-only + debug). Delete once the trimmed history is stable.

```bash
git branch -D backup/main backup/pre-trim-2026-08-08
```
