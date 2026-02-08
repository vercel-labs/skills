# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`skills` is the CLI for the open agent skills ecosystem — it installs, discovers, and manages agent skills across 40+ AI coding agents (Claude Code, Cursor, Copilot, Cline, etc.). Published to npm as `skills`.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build (generates licenses + bundles with obuild)
pnpm dev <cmd>        # Run CLI in dev mode (e.g., pnpm dev add owner/repo)
pnpm test             # Run all tests (vitest)
pnpm test tests/foo.test.ts  # Run a specific test file
pnpm type-check       # TypeScript type checking (tsc --noEmit)
pnpm format           # Format code with Prettier
pnpm format:check     # Check formatting without fixing
```

## Architecture

**Entry point:** `bin/cli.mjs` → bundled `dist/cli.mjs` (built from `src/cli.ts`)

**Command modules:** `cli.ts` routes to dedicated handlers:
- `add.ts` — core install command (the largest module); parses sources, clones repos, discovers skills, prompts for selection, installs
- `remove.ts` — skill removal
- `list.ts` — list installed skills
- `find.ts` — search/discovery with interactive selection

**Core modules:**
- `agents.ts` — definitions for 40+ agents (skills directories, detection logic)
- `installer.ts` — installation logic with symlink-preferred/copy-fallback modes
- `skills.ts` — recursive skill discovery and SKILL.md frontmatter parsing
- `source-parser.ts` — parses GitHub shorthand (`owner/repo`), git URLs, local paths
- `skill-lock.ts` — lock file (`~/.agents/.skill-lock.json`) for tracking installs and updates
- `git.ts` — git clone operations
- `providers/` — pluggable remote skill providers (HuggingFace, Mintlify, well-known registry)

**Key patterns:**
- Skills are defined by `SKILL.md` files with YAML frontmatter (parsed with `gray-matter`)
- Installation prefers symlinks from a canonical `.agents/skills/` directory; falls back to copying
- All dependencies are devDependencies — bundled by obuild into a single output file
- Path security: `sanitizeName()` prevents traversal attacks; `isPathSafe()` validates paths within base dir

## Code Style

- Prettier with single quotes, semicolons, 100 char width, trailing commas ES5
- Pre-commit hook (husky + lint-staged) auto-formats staged `.ts` files
- CI checks formatting — always run `pnpm format` before committing
- ESModules only (`"type": "module"`)
- TypeScript strict mode with `noUncheckedIndexedAccess`

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
