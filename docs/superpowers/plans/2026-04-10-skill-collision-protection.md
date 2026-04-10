# Skill Name Collision Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent skill name collisions across sources by validating name-directory consistency, making lock keys source-aware, and blocking silent overwrites.

**Architecture:** Three independent changes — (A) validate frontmatter `name` matches directory basename during discovery, (B) use `source::name` composite keys in lock files, (C) fail-closed prompt before overwriting a skill from a different source. Each change is a separate commit.

**Tech Stack:** TypeScript, Vitest, @clack/prompts

---

### Task 1: Change A — Validate name vs directory in discovery

**Files:**
- Modify: `src/skills.ts:28-63` (parseSkillMd)
- Modify: `src/skills.ts:108-225` (discoverSkills — pass validation flag)
- Create: `tests/name-dir-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/name-dir-validation.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSkillMd, discoverSkills } from '../src/skills.ts';

describe('name-directory validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skills-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('parseSkillMd with validateNameMatchesDir', () => {
    it('accepts skill when name matches directory', async () => {
      const skillDir = join(tempDir, 'bird');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A bird skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('bird');
    });

    it('rejects skill when name does not match directory', async () => {
      const skillDir = join(tempDir, 'bird-co');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A fake bird skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).toBeNull();
    });

    it('accepts when sanitized names match despite case/special chars', async () => {
      const skillDir = join(tempDir, 'foo-bar');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: Foo Bar\ndescription: A skill\n---\n# Foo'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).not.toBeNull();
    });

    it('accepts skill without validation flag (default behavior)', async () => {
      const skillDir = join(tempDir, 'bird-co');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'));
      expect(result).not.toBeNull();
    });
  });

  describe('discoverSkills name validation', () => {
    it('skips skills with name-directory mismatch in subdirectories', async () => {
      // Legitimate skill
      const legitDir = join(tempDir, 'skills', 'bird');
      await mkdir(legitDir, { recursive: true });
      await writeFile(
        join(legitDir, 'SKILL.md'),
        '---\nname: bird\ndescription: Legit bird\n---\n# Bird'
      );

      // Attacker skill: name "bird" but in directory "bird-co"
      const attackDir = join(tempDir, 'skills', 'bird-co');
      await mkdir(attackDir, { recursive: true });
      await writeFile(
        join(attackDir, 'SKILL.md'),
        '---\nname: bird\ndescription: Fake bird\n---\n# Bird'
      );

      const skills = await discoverSkills(tempDir);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('bird');
      expect(skills[0]!.description).toBe('Legit bird');
    });

    it('allows root-level SKILL.md regardless of directory name', async () => {
      await writeFile(
        join(tempDir, 'SKILL.md'),
        '---\nname: my-cool-skill\ndescription: Root skill\n---\n# Root'
      );

      const skills = await discoverSkills(tempDir);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('my-cool-skill');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test run tests/name-dir-validation.test.ts`
Expected: FAIL — `validateNameMatchesDir` option does not exist yet, and `discoverSkills` does not skip mismatched skills.

- [ ] **Step 3: Add `validateNameMatchesDir` to `parseSkillMd`**

In `src/skills.ts`, modify the `parseSkillMd` function. First, add the import for `sanitizeName` and `basename`:

```typescript
// At top of file, add sanitizeName import
import { sanitizeName } from './installer.ts';
```

Then modify `parseSkillMd`:

```typescript
export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean; validateNameMatchesDir?: boolean }
): Promise<Skill | null> {
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { data } = parseFrontmatter(content);

    if (!data.name || !data.description) {
      return null;
    }

    // Ensure name and description are strings (YAML can parse numbers, booleans, etc.)
    if (typeof data.name !== 'string' || typeof data.description !== 'string') {
      return null;
    }

    // Validate that frontmatter name matches directory name (prevents name squatting)
    if (options?.validateNameMatchesDir) {
      const dirName = basename(dirname(skillMdPath));
      if (sanitizeName(data.name) !== sanitizeName(dirName)) {
        return null;
      }
    }

    // Skip internal skills unless:
    // 1. INSTALL_INTERNAL_SKILLS=1 is set, OR
    // 2. includeInternal option is true (e.g., when user explicitly requests a skill)
    const isInternal = data.metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
      return null;
    }

    return {
      name: data.name,
      description: data.description,
      path: dirname(skillMdPath),
      rawContent: content,
      metadata: data.metadata,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Pass `validateNameMatchesDir: true` in discovery subdirectory paths**

In `src/skills.ts`, modify `discoverSkills` to pass the validation flag when parsing skills found in subdirectories (NOT at root level).

In the priority search dirs loop (~line 196), change:
```typescript
let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
```
to:
```typescript
let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), {
  ...options,
  validateNameMatchesDir: true,
});
```

In the recursive fallback loop (~line 215), change:
```typescript
let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
```
to:
```typescript
let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), {
  ...options,
  validateNameMatchesDir: true,
});
```

The root-level case at line 140 stays unchanged (no validation for root SKILL.md).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test run tests/name-dir-validation.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 6: Run existing tests to verify no regressions**

Run: `pnpm test run`
Expected: All existing tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/skills.ts tests/name-dir-validation.test.ts
git commit -m "fix(security): validate skill name matches directory basename (#353)

Reject SKILL.md files where the frontmatter name does not match the
containing directory name (after sanitization). This prevents name
squatting where an attacker places name: bird in a bird-co/ directory.

Root-level SKILL.md files are exempt since the directory name is the
repo name, not the skill name."
```

---

### Task 2: Change B — Source-aware lock keys in global lock

**Files:**
- Modify: `src/skill-lock.ts`
- Modify: `src/cli.ts:282` (CURRENT_LOCK_VERSION constant)
- Create: `tests/source-aware-lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/source-aware-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  makeLockKey,
  parseLockKey,
  findEntriesBySkillName,
  addSkillToLock,
  removeSkillFromLockByName,
  getSkillFromLockByName,
  readSkillLock,
} from '../src/skill-lock.ts';

describe('source-aware lock keys', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lock-test-'));
    originalEnv = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('makeLockKey / parseLockKey', () => {
    it('creates composite key with :: separator', () => {
      expect(makeLockKey('owner/repo', 'my-skill')).toBe('owner/repo::my-skill');
    });

    it('parses composite key back into source and name', () => {
      const { source, skillName } = parseLockKey('owner/repo::my-skill');
      expect(source).toBe('owner/repo');
      expect(skillName).toBe('my-skill');
    });

    it('handles source with multiple slashes', () => {
      const key = makeLockKey('git@github.com:owner/repo.git', 'skill');
      const { source, skillName } = parseLockKey(key);
      expect(source).toBe('git@github.com:owner/repo.git');
      expect(skillName).toBe('skill');
    });
  });

  describe('addSkillToLock with source-aware keys', () => {
    it('stores skill under source::name key', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc123',
      });

      const lock = await readSkillLock();
      expect(lock.skills['owner/repo::my-skill']).toBeDefined();
      expect(lock.skills['my-skill']).toBeUndefined();
    });

    it('allows same skill name from different sources', async () => {
      await addSkillToLock('react-tips', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'abc',
      });

      await addSkillToLock('react-tips', {
        source: 'owner2/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner2/repo.git',
        skillFolderHash: 'def',
      });

      const lock = await readSkillLock();
      expect(lock.skills['owner1/repo::react-tips']).toBeDefined();
      expect(lock.skills['owner2/repo::react-tips']).toBeDefined();
      expect(lock.skills['owner1/repo::react-tips']!.skillFolderHash).toBe('abc');
      expect(lock.skills['owner2/repo::react-tips']!.skillFolderHash).toBe('def');
    });
  });

  describe('findEntriesBySkillName', () => {
    it('finds all entries matching a skill name regardless of source', async () => {
      await addSkillToLock('react-tips', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'abc',
      });

      await addSkillToLock('react-tips', {
        source: 'owner2/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner2/repo.git',
        skillFolderHash: 'def',
      });

      await addSkillToLock('other-skill', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'ghi',
      });

      const lock = await readSkillLock();
      const matches = findEntriesBySkillName(lock, 'react-tips');
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.entry.source).sort()).toEqual(['owner1/repo', 'owner2/repo']);
    });

    it('returns empty array when no matches', async () => {
      const lock = await readSkillLock();
      const matches = findEntriesBySkillName(lock, 'nonexistent');
      expect(matches).toHaveLength(0);
    });
  });

  describe('removeSkillFromLockByName', () => {
    it('removes all entries matching skill name', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const removed = await removeSkillFromLockByName('my-skill');
      expect(removed).toBe(true);

      const lock = await readSkillLock();
      expect(Object.keys(lock.skills)).toHaveLength(0);
    });
  });

  describe('getSkillFromLockByName', () => {
    it('returns entry when skill exists', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const entry = await getSkillFromLockByName('my-skill');
      expect(entry).not.toBeNull();
      expect(entry!.source).toBe('owner/repo');
    });

    it('returns null when skill does not exist', async () => {
      const entry = await getSkillFromLockByName('nonexistent');
      expect(entry).toBeNull();
    });
  });

  describe('version bump', () => {
    it('creates lock file with version 4', async () => {
      await addSkillToLock('test', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const lock = await readSkillLock();
      expect(lock.version).toBe(4);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test run tests/source-aware-lock.test.ts`
Expected: FAIL — `makeLockKey`, `parseLockKey`, `findEntriesBySkillName`, `removeSkillFromLockByName`, `getSkillFromLockByName` do not exist.

- [ ] **Step 3: Implement source-aware lock keys in `skill-lock.ts`**

Modify `src/skill-lock.ts`:

1. Bump version:
```typescript
const CURRENT_VERSION = 4; // Bumped from 3 to 4 for source-aware lock keys
```

2. Add key helpers after the `CURRENT_VERSION` constant:
```typescript
const LOCK_KEY_SEPARATOR = '::';

export function makeLockKey(source: string, skillName: string): string {
  return `${source}${LOCK_KEY_SEPARATOR}${skillName}`;
}

export function parseLockKey(key: string): { source: string; skillName: string } {
  const sepIndex = key.lastIndexOf(LOCK_KEY_SEPARATOR);
  if (sepIndex === -1) {
    // Legacy key (plain skill name) — treat as unknown source
    return { source: '', skillName: key };
  }
  return {
    source: key.substring(0, sepIndex),
    skillName: key.substring(sepIndex + LOCK_KEY_SEPARATOR.length),
  };
}

export function findEntriesBySkillName(
  lock: SkillLockFile,
  skillName: string
): Array<{ key: string; entry: SkillLockEntry }> {
  return Object.entries(lock.skills)
    .filter(([key]) => parseLockKey(key).skillName === skillName)
    .map(([key, entry]) => ({ key, entry }));
}
```

3. Modify `addSkillToLock` to use composite key:
```typescript
export async function addSkillToLock(
  skillName: string,
  entry: Omit<SkillLockEntry, 'installedAt' | 'updatedAt'>
): Promise<void> {
  const lock = await readSkillLock();
  const now = new Date().toISOString();
  const key = makeLockKey(entry.source, skillName);

  const existingEntry = lock.skills[key];

  lock.skills[key] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeSkillLock(lock);
}
```

4. Add name-based lookup/remove helpers (keep the old ones for backward compat but add new ones):
```typescript
export async function removeSkillFromLockByName(skillName: string): Promise<boolean> {
  const lock = await readSkillLock();
  const matches = findEntriesBySkillName(lock, skillName);

  if (matches.length === 0) {
    return false;
  }

  for (const { key } of matches) {
    delete lock.skills[key];
  }

  await writeSkillLock(lock);
  return true;
}

export async function getSkillFromLockByName(skillName: string): Promise<SkillLockEntry | null> {
  const lock = await readSkillLock();
  const matches = findEntriesBySkillName(lock, skillName);
  return matches.length > 0 ? matches[0]!.entry : null;
}
```

5. Update the existing `removeSkillFromLock` and `getSkillFromLock` to delegate:
```typescript
export async function removeSkillFromLock(skillName: string): Promise<boolean> {
  return removeSkillFromLockByName(skillName);
}

export async function getSkillFromLock(skillName: string): Promise<SkillLockEntry | null> {
  return getSkillFromLockByName(skillName);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test run tests/source-aware-lock.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Update version constant in `cli.ts`**

In `src/cli.ts`, change line 282:
```typescript
const CURRENT_LOCK_VERSION = 4; // Bumped from 3 to 4 for source-aware lock keys
```

- [ ] **Step 6: Run all tests to verify no regressions**

Run: `pnpm test run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/skill-lock.ts src/cli.ts tests/source-aware-lock.test.ts
git commit -m "fix: use source-aware lock keys to prevent skill collisions (#606)

Lock file keys change from 'skill-name' to 'source::skill-name'.
This allows skills with the same name from different sources to
coexist in the lock file without overwriting each other.

Lock version bumped to 4 (existing lock files are wiped on read,
following the established v2->v3 migration pattern)."
```

---

### Task 3: Change B (continued) — Source-aware keys in local lock

**Files:**
- Modify: `src/local-lock.ts`
- Create: `tests/source-aware-local-lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/source-aware-local-lock.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  addSkillToLocalLock,
  removeSkillFromLocalLock,
  readLocalLock,
} from '../src/local-lock.ts';

describe('source-aware local lock keys', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'local-lock-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores skill under source::name key', async () => {
    await addSkillToLocalLock(
      'my-skill',
      {
        source: 'owner/repo',
        sourceType: 'github',
        computedHash: 'abc123',
      },
      tempDir
    );

    const lock = await readLocalLock(tempDir);
    expect(lock.skills['owner/repo::my-skill']).toBeDefined();
    expect(lock.skills['my-skill']).toBeUndefined();
  });

  it('allows same skill name from different sources', async () => {
    await addSkillToLocalLock(
      'react-tips',
      { source: 'owner1/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );

    await addSkillToLocalLock(
      'react-tips',
      { source: 'owner2/repo', sourceType: 'github', computedHash: 'def' },
      tempDir
    );

    const lock = await readLocalLock(tempDir);
    expect(lock.skills['owner1/repo::react-tips']).toBeDefined();
    expect(lock.skills['owner2/repo::react-tips']).toBeDefined();
  });

  it('removes skill by name regardless of source', async () => {
    await addSkillToLocalLock(
      'my-skill',
      { source: 'owner/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );

    const removed = await removeSkillFromLocalLock('my-skill', tempDir);
    expect(removed).toBe(true);

    const lock = await readLocalLock(tempDir);
    expect(Object.keys(lock.skills)).toHaveLength(0);
  });

  it('creates lock file with version 2', async () => {
    await addSkillToLocalLock(
      'test',
      { source: 'owner/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );

    const lock = await readLocalLock(tempDir);
    expect(lock.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test run tests/source-aware-local-lock.test.ts`
Expected: FAIL — local lock still uses plain name as key, version is 1.

- [ ] **Step 3: Implement source-aware keys in `local-lock.ts`**

Modify `src/local-lock.ts`:

1. Bump version:
```typescript
const CURRENT_VERSION = 2; // Bumped from 1 to 2 for source-aware lock keys
```

2. Import the key helpers from skill-lock.ts:
```typescript
import { makeLockKey, parseLockKey } from './skill-lock.ts';
```

3. Modify `addSkillToLocalLock` to use composite key:
```typescript
export async function addSkillToLocalLock(
  skillName: string,
  entry: LocalSkillLockEntry,
  cwd?: string
): Promise<void> {
  const lock = await readLocalLock(cwd);
  const key = makeLockKey(entry.source, skillName);
  lock.skills[key] = entry;
  await writeLocalLock(lock, cwd);
}
```

4. Modify `removeSkillFromLocalLock` to search by name part:
```typescript
export async function removeSkillFromLocalLock(skillName: string, cwd?: string): Promise<boolean> {
  const lock = await readLocalLock(cwd);

  const keysToRemove = Object.keys(lock.skills).filter(
    (key) => parseLockKey(key).skillName === skillName
  );

  if (keysToRemove.length === 0) {
    return false;
  }

  for (const key of keysToRemove) {
    delete lock.skills[key];
  }

  await writeLocalLock(lock, cwd);
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test run tests/source-aware-local-lock.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `pnpm test run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/local-lock.ts tests/source-aware-local-lock.test.ts
git commit -m "fix: source-aware keys in local lock file

Same source::name key format as global lock. Local lock version
bumped to 2."
```

---

### Task 4: Change C — Fail-closed collision detection before install

**Files:**
- Modify: `src/add.ts:1483-1508` (install loop — add collision check before it)
- Create: `tests/collision-detection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/collision-detection.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  addSkillToLock,
  readSkillLock,
  findEntriesBySkillName,
} from '../src/skill-lock.ts';

describe('collision detection', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'collision-test-'));
    originalEnv = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects collision when same skill name exists from different source', async () => {
    await addSkillToLock('react-tips', {
      source: 'owner1/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner1/repo.git',
      skillFolderHash: 'abc',
    });

    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');
    const currentSource = 'owner2/repo';
    const conflicting = matches.filter((m) => m.entry.source !== currentSource);

    expect(conflicting).toHaveLength(1);
    expect(conflicting[0]!.entry.source).toBe('owner1/repo');
  });

  it('no collision when same skill name exists from same source', async () => {
    await addSkillToLock('react-tips', {
      source: 'owner1/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner1/repo.git',
      skillFolderHash: 'abc',
    });

    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');
    const currentSource = 'owner1/repo';
    const conflicting = matches.filter((m) => m.entry.source !== currentSource);

    expect(conflicting).toHaveLength(0);
  });

  it('no collision when no existing skill with that name', async () => {
    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');

    expect(matches).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test run tests/collision-detection.test.ts`
Expected: PASS — these tests use already-implemented `findEntriesBySkillName` from Task 2. This validates the building blocks before we integrate into add.ts.

- [ ] **Step 3: Integrate collision detection into the add flow**

In `src/add.ts`, add the import for `findEntriesBySkillName` and `readSkillLock`:

At the import from `./skill-lock.ts` (around line 50), add `findEntriesBySkillName` and the async `readSkillLock`:

```typescript
import {
  addSkillToLock,
  fetchSkillFolderHash,
  getGitHubToken,
  isPromptDismissed,
  dismissPrompt,
  findEntriesBySkillName,
  readSkillLock,
} from './skill-lock.ts';
```

Then, before the installation loop (before line 1483 `for (const skill of selectedSkills)`), add the collision check. Note: `normalizedSource` is computed later at line 1541 — move or duplicate that computation here, or compute `currentSource` inline:

```typescript
    // Check for name collisions with skills from different sources
    const currentSource = getOwnerRepo(parsed) || parsed.url;
    const lock = await readSkillLock();
    const skillsToSkip = new Set<string>();

    for (const skill of selectedSkills) {
      const skillName = getSkillDisplayName(skill);
      const matches = findEntriesBySkillName(lock, skillName);
      const conflicting = matches.filter((m) => m.entry.source !== currentSource);

      if (conflicting.length > 0) {
        const existingSource = conflicting[0]!.entry.source;

        if (options.yes) {
          // Non-interactive mode: skip (fail-closed)
          p.log.warn(
            `Skill "${skillName}" already installed from ${existingSource}. Skipping (use interactive mode to overwrite).`
          );
          skillsToSkip.add(skill.name);
          continue;
        }

        const action = await p.select({
          message: `Skill "${skillName}" is already installed from ${existingSource}. What would you like to do?`,
          options: [
            { value: 'skip', label: 'Skip this skill' },
            { value: 'overwrite', label: `Overwrite with version from ${currentSource}` },
            { value: 'cancel', label: 'Cancel entire installation' },
          ],
        });

        if (p.isCancel(action) || action === 'cancel') {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        if (action === 'skip') {
          skillsToSkip.add(skill.name);
          continue;
        }

        // action === 'overwrite': remove old lock entry, proceed with install
        for (const match of conflicting) {
          delete lock.skills[match.key];
        }
        await writeSkillLock(lock);
      }
    }

    // Filter out skipped skills
    const installableSkills = selectedSkills.filter((s) => !skillsToSkip.has(s.name));

    if (installableSkills.length === 0) {
      spinner.stop('No skills to install');
      return;
    }
```

Also add `writeSkillLock` to the imports from `./skill-lock.ts`.

Then update the install loop to use `installableSkills` instead of `selectedSkills`:

Change line 1483:
```typescript
    for (const skill of installableSkills) {
```

And update the telemetry and lock update sections further down to also use `installableSkills` instead of `selectedSkills` (the `successfulSkillNames` check at lines 1582-1619 and 1623-1649).

- [ ] **Step 4: Run all tests**

Run: `pnpm test run`
Expected: All tests PASS.

- [ ] **Step 5: Run type check**

Run: `pnpm type-check`
Expected: No errors.

- [ ] **Step 6: Format**

Run: `pnpm format`

- [ ] **Step 7: Commit**

```bash
git add src/add.ts tests/collision-detection.test.ts
git commit -m "fix: fail-closed on skill name collision from different source (#353)

Before installing, check the lock file for existing skills with the
same name from a different source. In interactive mode, prompt the
user to skip, overwrite, or cancel. In non-interactive mode (--yes),
default to skip for safety (fail-closed).

This prevents silent overwrites of legitimate skills by malicious
or accidental name collisions."
```

---

### Task 5: Final validation

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test run`
Expected: All tests PASS, including new tests in `tests/name-dir-validation.test.ts`, `tests/source-aware-lock.test.ts`, `tests/source-aware-local-lock.test.ts`, `tests/collision-detection.test.ts`.

- [ ] **Step 2: Run type check**

Run: `pnpm type-check`
Expected: No errors.

- [ ] **Step 3: Run format check**

Run: `pnpm format:check`
Expected: All files formatted.

- [ ] **Step 4: Verify git log shows three clean commits**

Run: `git log --oneline -5`
Expected: Three commits for changes A, B (global + local), and C.
