# Skill Name Collision Protection

Resolves: [#353](https://github.com/vercel-labs/skills/issues/353), [#606](https://github.com/vercel-labs/skills/issues/606)

## Problem

Three related failures in the skills CLI:

1. **Name squatting (#353, security)**: A SKILL.md with `name: bird` inside directory `bird-co/` is accepted. An attacker can shadow a legitimate skill by claiming its `name` in frontmatter while residing in a differently-named directory. First-match-wins deduplication in `discoverSkills()` makes discovery order determine which version wins.

2. **Lock file collision (#606)**: The lock file (`~/.agents/.skill-lock.json`) keys entries by skill name only (`Record<string, SkillLockEntry>`). Two skills from different sources with the same name silently overwrite each other's lock entry.

3. **Silent overwrite on disk**: `cleanAndCreateDirectory()` in `installer.ts` deletes and recreates the target directory without checking whether an existing skill from a different source already occupies that path.

## Design

Three independent changes, each shippable as a separate commit:

### Change A: Validate `name` vs `basename(dir)` in discovery

**File**: `src/skills.ts` — `parseSkillMd()` (~lines 28-63)

**Logic**: After extracting `name` from frontmatter, compare `sanitizeName(name)` against `sanitizeName(basename(skillDir))`. Reject on mismatch.

```
parseSkillMd(skillDir):
  frontmatter = parseFrontmatter(content)
  name = frontmatter.name
  dirName = basename(skillDir)

  if sanitizeName(name) !== sanitizeName(dirName):
    warn("Skill '{name}' in directory '{dirName}' — name mismatch, skipping")
    return null
```

**Exception**: If the SKILL.md is at the root of the source (depth 0 relative to the clone/source directory), skip validation. This handles repos with a single SKILL.md at root where the directory name is the repo name, not the skill name. Depth 0 is determined by comparing `skillDir === basePath` where `basePath` is the root passed to `discoverSkills()`. The `basePath` parameter already exists in the function signature.

**Effect**: The #353 attack scenario is killed at discovery. `skills/attacker/bird-co/SKILL.md` with `name: bird` is rejected because `sanitizeName("bird") !== sanitizeName("bird-co")`.

**Backward compat**: Legitimate skills where name matches dirname (the vast majority) are unaffected. Skills where they don't match stop being discovered — this is intentionally breaking as a security fix.

### Change B: Source-aware lock key

**Files**: `src/skill-lock.ts`, `src/local-lock.ts`, `src/add.ts`

**Current state**: Lock file keys are `skills["react-best-practices"]`. One key per name. Two sources with the same skill name overwrite each other.

**New key format**: `source::name`

```json
{
  "version": 4,
  "skills": {
    "vercel-labs/agent-skills::react-best-practices": {
      "source": "vercel-labs/agent-skills",
      "sourceType": "github",
      "skillFolderHash": "abc123"
    },
    "acme/skills::react-best-practices": {
      "source": "acme/skills",
      "sourceType": "github",
      "skillFolderHash": "def456"
    }
  }
}
```

**Details**:
- Separator `::` — does not appear in source identifiers or sanitized skill names
- Bump lock version to **4** — existing behavior in `readSkillLock()` wipes older versions; users reinstall (same pattern as v2 to v3 migration)
- `addSkillToLock(source, skillName, entry)` receives source as a separate parameter and composes the key internally
- `removeSkillFromLock(source, skillName)` same adjustment
- Lookup helpers extract the name part (after `::`) for collision checks
- `skills check` and `skills update` iterate `lock.skills` — key changes but entry structure is unchanged

**Migration strategy**: Version bump = old lock file wiped. This is the established project pattern (v2 to v3 did the same). No migration code needed.

### Change C: Fail-closed before install

**File**: `src/add.ts` — installation loop (~line 1483), before calling `installSkillForAgent()`

**Logic**: Before installing each skill, query the lock file for existing entries with the same sanitized name from a different source.

```
for each skill in selectedSkills:
  existingEntries = find all lock entries where name_part(key) == sanitizeName(skill.name)
  conflicting = filter entries where source != currentSource

  if conflicting is not empty:
    show interactive prompt:
      "Skill 'react-best-practices' already installed from vercel-labs/agent-skills."
      Options:
        1. Overwrite (replace existing)
        2. Skip this skill
        3. Cancel

    if overwrite: remove old lock entry, proceed with install
    if skip: skip this skill
    if cancel: abort entire operation
```

**`--yes` flag behavior**: When running non-interactively (`--yes`), default to **skip** (safe default, never silently overwrite). This is the "fail-closed" behavior requested in #353.

**Interaction with Change A**: If A is implemented, name squatting (name != dirname) is blocked at discovery. C catches the residual case: two legitimate skills from different sources with the same name and matching dirnames.

**Interaction with Change B**: The conflict lookup examines the name part of `source::name` keys. Implemented via a helper function that abstracts key format, so C works regardless of whether B is deployed.

## Files Changed

| Change | File | Estimated lines | Complexity |
|--------|------|----------------|------------|
| A | `src/skills.ts` | ~15 | Low |
| B | `src/skill-lock.ts` | ~40 | Medium |
| B | `src/local-lock.ts` | ~20 | Low |
| B | `src/add.ts` (lock calls) | ~10 | Low |
| C | `src/add.ts` (install loop) | ~40 | Medium |

Total: ~125 lines across 4 files.

## Test Plan

### Change A
- Test: SKILL.md with `name: foo` in directory `foo/` — accepted
- Test: SKILL.md with `name: foo` in directory `bar/` — rejected with warning
- Test: SKILL.md with `name: foo` at source root (depth 0) — accepted regardless of dirname
- Test: Name matching is case-insensitive and sanitization-aware (`Foo Bar` in `foo-bar/` — accepted)

### Change B
- Test: Two skills with same name from different sources get distinct lock keys
- Test: Lock file with version < 4 is wiped on read
- Test: `removeSkillFromLock` with source+name removes correct entry
- Test: `skills check` / `skills update` iterate correctly over new key format

### Change C
- Test: Installing skill with name conflict from different source — prompt shown
- Test: Selecting "overwrite" replaces old entry and installs new skill
- Test: Selecting "skip" leaves existing skill untouched
- Test: Selecting "cancel" aborts entire operation
- Test: `--yes` flag with conflict — defaults to skip (no overwrite)
- Test: Installing skill with same name from same source — no conflict (normal update)

## Out of Scope

- **Agent-level command collision**: How agents (Claude Code, Cursor, etc.) expose skills as slash commands is outside the skills CLI's control.
- **Automatic namespacing**: No `--namespace` or `--prefix` flag. The interactive prompt in Change C handles disambiguation.
- **Registry-side deduplication**: The skills.sh website (#226) is a separate system.
- **Lock file migration**: Following project convention, version bump wipes old lock. No migration code.
