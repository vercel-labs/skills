# skill-cui

Standalone terminal UI for the `skills` CLI.

```bash
npx skill-cui
npx skill-cui --no-confirmation
npm install -g skill-cui
skill-cui
```

Use it to list project/global skills, filter by agent, update, remove, move, search, and install skills from a guided terminal interface.

The guided experience includes stable long-list navigation, bounded headers for narrow terminals, confirmation prompts for destructive actions, and selected-skill context from structured `skills list --json` output where available.

## How standalone mode works

`skill-cui` invokes the public `npx skills` command and parses structured output where available. It intentionally does not import private internals from the `skills` package, so it can run through `npx` without a previous local installation.

The package ships a small local terminal UI helper under `lib/` for boxes, colors, input, confirmation, and selection. This keeps the standalone package self-contained and avoids taking a runtime dependency on an unmaintained external TUI package.

Standalone search requires keywords because open interactive search belongs to `npx skills find` itself.

## Safety

Destructive actions ask for confirmation by default. Use `--no-confirmation` only in trusted workflows where you want to skip CUI confirmation prompts. In guided prompts, <kbd>Esc</kbd> cancels the current action.

## Attribution

`skill-cui` is published from the [`smota/skills`](https://github.com/smota/skills) fork as a standalone CUI package for the open `skills` CLI ecosystem. It is based on the upstream [`vercel-labs/skills`](https://github.com/vercel-labs/skills) project and keeps upstream attribution visible while exposing this fork's standalone package entry point. Package metadata uses the GitHub handle `smota` for fork/author attribution.

## Local development

From the repository root:

```bash
node packages/skill-cui/bin/skill-cui.mjs --help
node packages/skill-cui/bin/skill-cui.mjs Exit
node packages/skill-cui/bin/skill-cui.mjs "List all skills"
node packages/skill-cui/bin/skill-cui.mjs "Filter by agent" codex
```

Before publishing, validate the package contents:

```bash
cd packages/skill-cui
npm pack --dry-run --json
```
