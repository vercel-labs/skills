# Skills Management One-Pager

## What This Adds

The `skills` CLI gains a lightweight management layer for installed skills:

- Enable and disable skills without uninstalling them
- Organize skills into named groups
- Designate one protected `skills-manager` skill per scope
- Preserve management state across reinstall-like flows such as `add`, `update`, `experimental_install`, and `experimental_sync`

Project and global scope remain separate. The same commands work in both, with `-g` selecting global scope.

> **NOTE**
> In an ideal world, we wouldn't need to rename a SKILL.md file in order to disable it. Instead, we would set a flag in the frontmatter.
> However, this would require buy-in from harness authors and, ultimately, official support in the SKILL.md spec.

## Command Surface

The new command surface stays close to the current CLI style.

### Enable and disable individual skills

```bash
skills enable api-design
skills disable browser-testing
skills disable api-design browser-testing
```

### Enable and disable groups

```bash
skills enable --group ai
skills disable --group architecture frontend
```

### Enable and disable everything in a scope

```bash
skills enable --all
skills disable --all
```

### Create and delete groups

```bash
skills group create ai architecture
skills group delete architecture
```

### Add and remove skills from groups

```bash
skills group add ai --skill api-design browser-testing
skills group remove ai --skill browser-testing
```

### Designate the protected manager skill

```bash
skills manager set find-skills
skills manager show
skills manager clear
```

### Global scope examples

```bash
skills disable api-design -g
skills group create ai -g
skills manager set find-skills -g
```

## List Output

Normal `skills list` keeps the current format and only adds status markers:

```text
[+] api-design ~/dev-projects/skills/.agents/skills/api-design
  Agents: Claude Code, Codex, Cursor, GitHub Copilot, OpenCode

[-] browser-testing ~/dev-projects/skills/.agents/skills/browser-testing
  Agents: Claude Code, Codex, Cursor, GitHub Copilot, OpenCode
```

`skills list --groups` adds a group-centric view:

```text
ai (5/5 enabled)
  [+] ai-gateway
  [+] ai-sdk

architecture (3/5 enabled)
  [+] request-refactor-plan
  [-] openapi-spec-generation

UNGROUPED SKILLS (1/2 enabled)
  [+] deployments-cicd
  [-] email
```

## Core Design Decisions

### Disabled state is derived from the filesystem

Disabled skills are represented by renaming:

- `SKILL.md` -> enabled
- `SKILL.disabled.md` -> disabled

The lockfile does not store an explicit enabled/disabled flag.

### Groups are stored in lockfiles

Both scope-specific lockfiles store:

- Group membership
- The designated `skills-manager` skill

Project and global state are fully separate.

### Groups are collections, not stateful entities

Groups do not store their own enabled/disabled flag.

A group is effectively "enabled" when all of its member skills are enabled.

### One protected `skills-manager` skill per scope

Each scope can mark one skill as the `skills-manager` skill.

That skill:

- Cannot be disabled directly
- Is skipped by bulk disable operations
- Cannot be added to groups

### Lifecycle commands preserve management state

Commands like `add`, `update`, `experimental_install`, and `experimental_sync` should not wipe out groups or the protected manager designation.

If a skill was disabled before an in-place reinstall, it should still be disabled afterward.

## Key Tradeoffs

### Why derive disabled state from filenames?

Pros:

- Matches how harnesses discover skills today
- Avoids duplicate sources of truth
- Keeps runtime behavior simple

Tradeoff:

- A lockfile-only restore into an empty environment cannot recreate disabled state by itself

### Why keep project and global fully separate?

Pros:

- Fits the CLI’s existing scope model
- Avoids surprising cross-project behavior
- Keeps group names and manager designation local to the chosen scope

Tradeoff:

- Users manage two namespaces instead of one shared global catalog

### Why best-effort bulk operations?

Pros:

- Large commands remain useful even if a few targets are invalid
- Better UX for group-wide and `--all` operations

Tradeoff:

- Commands need clear per-item reporting and non-zero exits when partial failures occur

## Bottom Line

This design adds a practical management layer without changing the existing mental model of install, update, restore, and remove.

Users can keep many skills installed, organize them into groups, and control which ones are active, while the CLI preserves that intent across normal lifecycle operations.
