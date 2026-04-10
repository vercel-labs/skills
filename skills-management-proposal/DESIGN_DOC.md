# Skill Management Design for `skills`

## Summary

This document proposes a first-class skill management layer for the `skills` CLI that adds:

- Scope-aware enable/disable operations for installed skills
- User-defined skill groups
- A single protected `skills-manager` skill per scope
- Management-aware listing and lifecycle behavior

The design keeps the current install/update/remove model intact and layers management state on top of it.

The key decisions are:

- Disabled state is derived from filenames, not stored in lockfiles
- A disabled skill is represented by renaming `SKILL.md` to `SKILL.disabled.md`
- Groups are multi-membership collections of skill names
- Project and global scopes remain completely separate
- Group membership and the designated `skills-manager` skill are stored in both lockfiles
- Lifecycle commands must preserve group membership and disabled state when reinstalling an existing skill in place
- Removing a skill must fully scrub it from the relevant lockfile, including group membership and `skills-manager` designation

## Context

The `skills` CLI already supports installation, discovery, update checks, removal, local project restore, and node_modules sync. What it lacks is a lightweight way to control which already-installed skills are active without uninstalling them, and a way to organize installed skills into reusable collections.

That gap matters because harnesses typically frontload skill metadata into the prompt. Users need a way to keep many skills installed while keeping only a chosen working set active.

## Current System Inventory

### Existing Commands

| Command | Aliases | Purpose | Lockfile Relationship |
| --- | --- | --- | --- |
| `skills add <source>` | `a`, `install`, `i` | Install skills from repo/path/well-known source | Writes global lock for global installs, writes project lock for project installs |
| `skills remove [skills...]` | `rm`, `r` | Remove installed skills | Currently removes from global lock only; project lock cleanup must be added |
| `skills list` | `ls` | List installed skills | Reads filesystem and global lock plugin metadata |
| `skills find [query]` | `search`, `f`, `s` | Search remote skills | No lockfile mutation |
| `skills check` | none | Check for updates | Reads global lock only |
| `skills update` | `upgrade` | Reinstall updated global skills | Reads global lock only |
| `skills experimental_install` | none | Restore project skills from `skills-lock.json` | Reads project lock only |
| `skills experimental_sync` | none | Sync node_modules skills into project scope | Reads and writes project lock |
| `skills init [name]` | none | Scaffold a `SKILL.md` | No lockfile mutation |

### Existing Flags

The current CLI surface already includes the following relevant flags:

- `add`: `-g`, `-a`, `-s`, `-l`, `-y`, `--copy`, `--all`, `--full-depth`
- `remove`: `-g`, `-a`, `-y`, `--all`
- `list`: `-g`, `-a`, `--json`
- `experimental_sync`: `-a`, `-y`, `-f`

This design keeps the existing scope convention:

- Project scope is the default
- Global scope is selected with `-g` / `--global`

### Existing Storage Model

There are currently two persistent lockfiles:

#### Project lock

- Path: `<cwd>/skills-lock.json`
- Current version: `1`
- Purpose: reproducible project restore
- Current contents: `skills` map with source metadata and `computedHash`

#### Global lock

- Path: `~/.agents/.skill-lock.json` or `$XDG_STATE_HOME/skills/.skill-lock.json`
- Current version: `3`
- Purpose: global install tracking and update checks
- Current contents: `skills` map with source metadata, timestamps, `skillFolderHash`, optional `pluginName`, plus global-only fields like `dismissed` and `lastSelectedAgents`

### Existing Install Model

Installed skills are materialized in a canonical skill directory and may also appear in agent-specific directories:

- Project canonical path: `<cwd>/.agents/skills/<skill>`
- Global canonical path: `~/.agents/skills/<skill>` or XDG equivalent
- Universal agents share the canonical directory
- Non-universal agents either symlink to the canonical directory or get copied files when `--copy` is used or symlinks fail

This matters because enable/disable must work for both:

- Symlinked installs, where changing the canonical copy is usually sufficient
- Copied installs, where every materialized copy must be renamed separately

## Goals

- Let users enable and disable installed skills without uninstalling them
- Let users define named groups of skills
- Support both project and global management with separate state
- Preserve management state across reinstall-like lifecycle commands
- Keep `skills list` familiar and low-friction
- Keep the design orthogonal to existing `add`, `remove`, `update`, `experimental_install`, and `experimental_sync` behavior

## Non-Goals

- Agent-specific enable/disable state in v1
- Group-level stored enabled/disabled state
- Automatic group assignment during fresh install
- Changing how `check` and `update` decide what is updatable
- Replacing the existing install layout

## Final Design Decisions

### 1. Disabled State

Disabled state is derived from filenames:

- Enabled: `SKILL.md`
- Disabled: `SKILL.disabled.md`

No lockfile field stores enabled/disabled state.

This keeps the runtime source of truth aligned with what harnesses actually load.

### 2. Group Model

Groups are named collections of skill names.

- A skill may belong to zero, one, or many groups
- Group membership is scope-local
- A group has no independent enabled/disabled flag
- A group is considered "enabled" when all of its installed members are enabled

### 3. Scope Model

Project and global management are independent.

- The same group name may exist in both scopes
- Membership is not shared across scopes
- Each scope may have a different `skills-manager` skill

### 4. Protected `skills-manager` Skill

Each scope may designate at most one special skill as `skills-manager`.

Rules:

- It cannot be disabled
- It cannot be added to any group
- Bulk disable operations skip it
- Explicit attempts to disable it fail with a clear error

### 5. Bulk Failure Behavior

Bulk commands are best-effort:

- Successful targets are applied
- Invalid or missing targets are reported individually
- Protected `skills-manager` skips in bulk are reported as skips, not failures
- Any true failures produce a non-zero exit code

## Proposed Command Surface

This design uses the Option 1 command family.

### Enable and disable skills

```bash
skills enable foo bar
skills disable foo bar
```

### Enable and disable groups

```bash
skills enable --group ai architecture
skills disable --group ai architecture
```

### Enable and disable all skills in a scope

```bash
skills enable --all
skills disable --all
```

### Create and delete groups

```bash
skills group create ai architecture
skills group delete ai architecture
```

### Add and remove skills from a group

```bash
skills group add ai --skill foo bar
skills group remove ai --skill foo bar
```

### Manage the protected manager skill

```bash
skills manager set find-skills
skills manager show
skills manager clear
```

### Scope selection

Every management command supports scope selection the same way existing install/remove/list commands do:

```bash
skills disable foo -g
skills group create ai -g
skills manager set find-skills -g
```

### Selector rules

`enable` and `disable` accept exactly one selector type per invocation:

- Positional skill names
- `--group <groups...>`
- `--all`

Mixed selectors are rejected. For example:

- `skills disable foo --group ai` is invalid
- `skills disable --group ai --all` is invalid

This keeps command behavior easy to reason about.

## List UX

### Default `skills list`

The existing layout stays the same. The only change is a status prefix before the skill name.

Enabled:

```text
[+] api-design ~/dev-projects/skills/.agents/skills/api-design
  Agents: Claude Code, Codex, Cursor, GitHub Copilot, OpenCode
```

Disabled:

```text
[-] browser-testing ~/dev-projects/skills/.agents/skills/browser-testing
  Agents: Claude Code, Codex, Cursor, GitHub Copilot, OpenCode
```

Notes:

- The command keeps the current structure, headings, path rendering, and agent lines
- Existing plugin-based grouping in normal list output stays intact
- The only new default signal is `[+]` or `[-]`

### `skills list --groups`

This new mode shows group-centric output:

```text
ai (5/5 enabled)
  [+] ai-gateway
  [+] ai-generation-persistence
  [+] ai-sdk
  [+] develop-ai-functions-example
  [+] ai-architecture-patterns

architecture (3/5 enabled)
  [+] nodejs-backend-patterns
  [-] openapi-spec-generation
  [+] request-refactor-plan
  [-] typescript-advanced-types
  [+] ai-architecture-patterns

UNGROUPED SKILLS (1/4 enabled)
  [-] two-factor-authentication-best-practices
  [+] deployments-cicd
  [-] drizzle-orm
  [-] email
```

Ordering:

- Groups are listed alphabetically
- Skills within each group are listed alphabetically
- `UNGROUPED SKILLS` is always last

Empty groups are shown:

```text
ai (0/0 enabled)
```

### Extended status handling

The two main steady states are:

- `[+]` enabled
- `[-]` disabled

Two additional drift states are useful for diagnostics:

- `[!]` inconsistent across copies or invalid on disk
- `[?]` referenced by management metadata but missing on disk

`[!]` and `[?]` are primarily relevant to `skills list --groups`, where lockfile metadata may outlive manual filesystem edits.

## Runtime State Model

### Canonical status derivation

Per installed skill directory:

- `SKILL.md` present and `SKILL.disabled.md` absent => enabled
- `SKILL.disabled.md` present and `SKILL.md` absent => disabled
- Both present or neither present => invalid/inconsistent

### Scope-wide skill status

Management commands operate on a skill across the full selected scope, not per agent.

To do that safely, the CLI must enumerate every concrete installed copy of a skill in the selected scope:

- Canonical directory
- Agent-specific copies created by `--copy`
- Agent-specific fallback copies created when symlinks failed

Symlink aliases should be deduplicated by `realpath` so a single underlying directory is not renamed twice.

### Why no stored disabled flag

Disabled state intentionally lives in the filesystem because harnesses already key off the presence of `SKILL.md`.

This has one important consequence:

- In-place reinstall/update operations can preserve disabled state by snapshotting current filenames and restoring them afterward
- A clean restore into an empty scope cannot reconstruct disabled state from lockfiles alone

That tradeoff is accepted in this design.

## Lockfile Changes

### Project lockfile

Bump project lock version from `1` to `2`.

Proposed shape:

```json
{
  "version": 2,
  "skills": {
    "api-design": {
      "source": "vercel-labs/skills",
      "sourceType": "github",
      "computedHash": "abc123"
    }
  },
  "management": {
    "groups": {
      "ai": ["api-design", "browser-testing"]
    },
    "managerSkill": "find-skills"
  }
}
```

### Global lockfile

Bump global lock version from `3` to `4`.

Proposed shape:

```json
{
  "version": 4,
  "skills": {
    "api-design": {
      "source": "vercel-labs/skills",
      "sourceType": "github",
      "sourceUrl": "https://github.com/vercel-labs/skills",
      "skillFolderHash": "tree-sha",
      "installedAt": "2026-04-07T00:00:00.000Z",
      "updatedAt": "2026-04-07T00:00:00.000Z"
    }
  },
  "dismissed": {},
  "lastSelectedAgents": ["codex"],
  "management": {
    "groups": {
      "ai": ["api-design", "browser-testing"]
    },
    "managerSkill": "find-skills"
  }
}
```

### Management schema rules

- `management.groups` keys are stored sorted alphabetically
- Group member arrays are sorted alphabetically and deduplicated
- `managerSkill` is optional
- Group names are case-insensitive at the CLI boundary and stored canonically as lowercase CLI-friendly identifiers
- Skill names in groups are stored by canonical skill name as used in the lockfile

### Migration behavior

The current implementation wipes older lockfile versions. That is too destructive for this feature.

This design should add explicit migrations:

- Project `v1` -> `v2` by preserving `skills` and adding empty `management`
- Global `v3` -> `v4` by preserving `skills`, `dismissed`, and `lastSelectedAgents`, then adding empty `management`

Only invalid or unsupported lockfiles should be reset.

## Command Semantics

### `skills enable`

Supported forms:

- `skills enable foo bar`
- `skills enable --group ai architecture`
- `skills enable --all`

Behavior:

- Expands the selector to concrete skill names in the selected scope
- Ignores duplicates after expansion
- Skips the `skills-manager` skill in bulk if it is already enabled
- Renames `SKILL.disabled.md` -> `SKILL.md` in every concrete installed copy
- Reports missing or inconsistent copies as failures

### `skills disable`

Supported forms:

- `skills disable foo bar`
- `skills disable --group ai architecture`
- `skills disable --all`

Behavior:

- Expands the selector to concrete skill names in the selected scope
- Explicitly targeting the `skills-manager` skill fails
- Bulk operations skip the `skills-manager` skill and report the skip
- Renames `SKILL.md` -> `SKILL.disabled.md` in every concrete installed copy
- Reports missing or inconsistent copies as failures

### `skills group create`

Supported form:

```bash
skills group create ai architecture
```

Behavior:

- Creates one or more empty groups in the selected scope
- Fails only for invalid group names or already-existing groups
- Empty groups are first-class and remain until explicitly deleted

### `skills group delete`

Supported form:

```bash
skills group delete ai architecture
```

Behavior:

- Deletes the named groups from the selected scope
- Does not uninstall skills
- Does not change skill enabled/disabled state
- Deleting a group only removes membership metadata

### `skills group add`

Supported form:

```bash
skills group add ai --skill foo bar
```

Behavior:

- Requires the target group to already exist
- Adds one or more installed skills to the group
- Disabled skills may be grouped
- The `skills-manager` skill is rejected
- Missing or unknown skills are reported individually
- Duplicate membership is ignored

### `skills group remove`

Supported form:

```bash
skills group remove ai --skill foo bar
```

Behavior:

- Removes one or more skills from the named group
- If the group becomes empty, it remains as an empty group
- Missing skills are reported individually

### `skills manager set`

Supported form:

```bash
skills manager set find-skills
```

Behavior:

- Requires the target skill to exist in the selected scope
- Ensures the target skill ends in an enabled state
- If the skill currently belongs to groups in the selected scope, it is removed from those groups and the command reports that cleanup
- Replaces any previous `managerSkill` in the selected scope

Rationale:

- The command is explicit
- Auto-removing the skill from groups avoids a tedious two-step workflow
- The cleanup is local, deterministic, and easy to report

### `skills manager show`

Behavior:

- Prints the designated `managerSkill` for the selected scope
- If none is set, prints a clear "not set" message
- If the lockfile points at a skill that is missing on disk, prints the name plus a warning

### `skills manager clear`

Behavior:

- Clears the `managerSkill` field in the selected scope
- Does not touch groups
- Does not change enabled/disabled state

## Lifecycle Interactions

### `skills add`

Fresh installs do not infer groups.

However, when `add` reinstalls a skill that already exists in the selected scope, it must preserve:

- Existing group membership from the relevant lockfile
- Existing `skills-manager` designation if the reinstalled skill is the manager skill
- Existing disabled state by snapshotting the current on-disk filename state before replacement and restoring it afterward

This allows `skills add` to behave sensibly as both an install and a reinstall mechanism.

### `skills update`

`update` remains global-only and source-driven exactly as today.

For each updated skill:

- Existing global management metadata is preserved
- If the skill was disabled before update, it is disabled again after update completes
- If the skill is the global `skills-manager`, it remains protected and enabled

### `skills experimental_install`

`experimental_install` remains project-only.

Behavior:

- Group metadata and `managerSkill` come from the project lockfile
- If reinstalling over an existing disabled skill directory, disabled state is preserved
- If restoring into an empty project from lockfile only, disabled state cannot be recreated because it is intentionally not stored in the lockfile

### `skills experimental_sync`

`experimental_sync` should follow the same preservation rule as other reinstall-like commands in project scope:

- Preserve existing group membership
- Preserve existing `managerSkill`
- Preserve disabled state when syncing over an existing installed skill

### `skills remove`

`remove` must be updated so that it becomes the authoritative scrub operation for both scopes.

For every successfully removed skill:

- Delete installed files from canonical and agent-specific locations
- Remove the skill entry from the relevant lockfile
- Remove the skill from all groups in the relevant scope
- Clear `managerSkill` if it pointed to the removed skill

Important correction:

- Project-scope remove must also mutate `skills-lock.json`
- This is currently missing from the codebase and should be fixed as part of this work

## Handling Missing or Manually Deleted Skills

This document intentionally does not auto-prune stale management metadata during read-only commands.

Chosen behavior:

- Preserve metadata by default
- Surface the inconsistency to the user
- Let explicit commands clean it up

Details:

- `skills list` continues to show installed skills only
- `skills list --groups` may show `[?] <skill> (missing)` when a group references a skill that no longer exists on disk
- Group enabled counts exclude missing skills from the enabled numerator but include them in the total denominator
- A warning footer should recommend cleanup

Example:

```text
ai (4/5 enabled)
  [+] api-design
  [+] browser-testing
  [+] data-loader
  [+] prompt-refactor
  [?] stale-skill (missing)
```

Cleanup path:

- `skills remove stale-skill` in the relevant scope should still scrub lockfile metadata even if the files are already gone

This is preferable to silent auto-pruning because it avoids surprising data loss and keeps management writes explicit.

## JSON Output

`skills list --json` should gain management-aware fields.

Proposed per-skill JSON shape:

```json
{
  "name": "api-design",
  "path": "/abs/path/.agents/skills/api-design",
  "scope": "project",
  "agents": ["Codex", "Cursor"],
  "status": "enabled",
  "groups": ["ai", "architecture"],
  "isManager": false
}
```

`skills list --groups --json` can return a grouped structure:

```json
{
  "groups": {
    "ai": [
      { "name": "api-design", "status": "enabled" }
    ]
  },
  "ungrouped": [
    { "name": "email", "status": "disabled" }
  ],
  "managerSkill": "find-skills",
  "warnings": []
}
```

## Implementation Plan

### Phase 1: Lockfile and state helpers

- Add read/write helpers for `management.groups` and `management.managerSkill`
- Add explicit lockfile migrations
- Add sorted deterministic writing for groups and members
- Add helper APIs for:
  - resolving group membership
  - resolving `managerSkill`
  - scrubbing a removed skill from management state

### Phase 2: Status detection and filesystem helpers

- Add a helper to detect enabled, disabled, inconsistent, and missing states
- Add a helper to enumerate all concrete installed copies for a skill in a scope
- Deduplicate symlink aliases with `realpath`
- Add rename helpers for enable/disable operations

### Phase 3: New commands

- Add `enable`
- Add `disable`
- Add `group create`
- Add `group delete`
- Add `group add`
- Add `group remove`
- Add `manager set`
- Add `manager show`
- Add `manager clear`

### Phase 4: Integrate with existing flows

- Update `list` and `--json`
- Add `list --groups`
- Update `remove` to scrub project and global management state
- Update `add`, `update`, `experimental_install`, and `experimental_sync` to preserve management state across reinstalls

### Phase 5: Tests

- Lockfile migration tests
- Group CRUD tests for both scopes
- Manager skill tests for both scopes
- Enable/disable tests for:
  - canonical installs
  - symlink installs
  - copy installs
  - mixed and invalid states
- `list` and `list --groups` output tests
- Reinstall preservation tests for:
  - `add`
  - `update`
  - `experimental_install`
  - `experimental_sync`
- Remove cleanup tests for:
  - project lockfile
  - global lockfile
  - group scrubbing
  - manager clearing
- Missing/manual deletion edge-case tests

## Open Tradeoff to Revisit Later

The biggest tradeoff in this design is the decision to derive disabled state entirely from filenames instead of storing it in lockfiles.

That buys:

- Very simple runtime semantics
- Direct compatibility with harnesses that load `SKILL.md`
- No duplicated source of truth

It costs:

- No portable disabled-state restore from an otherwise empty lockfile-only install

If portable disabled state later becomes a strong requirement, the clean extension point is to add explicit disabled metadata in a future lockfile version. That is intentionally out of scope for this design.

## Recommendation

Proceed with this design as a management-focused extension to the existing CLI.

It introduces meaningful new control without changing the mental model of how skills are installed, restored, or updated. It also keeps the prompt-window problem front and center: users can keep many skills installed while only activating the ones they want loaded by their harness.
