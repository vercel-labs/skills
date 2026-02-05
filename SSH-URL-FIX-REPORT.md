# SSH URL Lockfile Tracking Fix Report

**Date:** 2026-02-05
**Repository:** https://github.com/marknorgren/skills-fork
**Branch:** `fix/ssh-url-lockfile-tracking`
**Commit:** `0adf336`

## Bug Summary

| Field | Value |
|-------|-------|
| File | `src/source-parser.ts` |
| Function | `getOwnerRepo()` |
| Lines | 10-35 |
| Bug | Returns `null` for SSH URLs (only handled HTTP/HTTPS) |
| Impact | SSH installs work but aren't tracked in lockfile |

## Root Cause

The `getOwnerRepo()` function only parsed HTTP/HTTPS URLs:

```typescript
// Only handle HTTP(S) URLs
if (!parsed.url.startsWith('http://') && !parsed.url.startsWith('https://')) {
  return null;  // <-- SSH URLs returned null here
}
```

SSH URLs like `git@github.com:owner/repo.git` were returned as `null`, causing:
- No `source` field in lockfile entries
- `skills check` unable to track these skills
- `skills update` unable to update these skills

## Fix Applied

Added SSH URL pattern matching before the HTTP check:

```typescript
// Handle SSH URLs: git@host:owner/repo.git
const sshMatch = parsed.url.match(/^git@[^:]+:(.+)$/);
if (sshMatch) {
  let path = sshMatch[1]!;
  path = path.replace(/\.git$/, '');
  if (path.includes('/')) {
    return path;
  }
  return null;
}
```

## Test Coverage

Added 5 new test cases in `tests/source-parser.test.ts`:

| Test | Input | Expected Output |
|------|-------|-----------------|
| SSH format extracts owner/repo | `git@github.com:owner/repo.git` | `owner/repo` |
| SSH without .git suffix | `git@github.com:owner/repo` | `owner/repo` |
| SSH with GitLab | `git@gitlab.com:owner/repo.git` | `owner/repo` |
| SSH with custom host | `git@git.example.com:team/project.git` | `team/project` |
| SSH with GitLab subgroups | `git@gitlab.com:group/subgroup/repo.git` | `group/subgroup/repo` |

All 286 tests pass.

## Validation Results

### Before Fix
```
skills add git@github.com:anthropics/skills.git -g
# Lockfile entry:
# "source": null  ← BUG
```

### After Fix
```
skills add git@github.com:anthropics/skills.git -g
# Lockfile entry:
# "source": "anthropics/skills"  ← FIXED
```

### Lockfile Comparison

| Install Method | `source` | `sourceType` | `skillFolderHash` |
|----------------|----------|--------------|-------------------|
| HTTPS | `anthropics/skills` | `github` | `a38aa7fa...` |
| SSH (after fix) | `anthropics/skills` | `git` | `""` |

## Known Limitations

The fix resolves lockfile tracking. However, `skills check` and `skills update` still have limitations for SSH-installed skills:

1. **sourceType:** SSH URLs are parsed as `type: 'git'` (fallback), not `type: 'github'`
2. **skillFolderHash:** Not fetched for non-GitHub sourceTypes
3. **Result:** `skills check` outputs "No GitHub skills to check" for SSH installs

This is a separate issue in `parseSource()` that would require additional changes to recognize SSH URLs as GitHub/GitLab sources.

## Testing Your Fork

```bash
# Install from fork
npm install -g github:marknorgren/skills-fork#fix/ssh-url-lockfile-tracking

# Or clone and link
git clone -b fix/ssh-url-lockfile-tracking git@github.com:marknorgren/skills-fork.git
cd skills-fork
pnpm install && pnpm build
pnpm link --global

# Test SSH install
skills add git@github.com:anthropics/skills.git -g -y

# Verify lockfile has source field
cat ~/.agents/.skill-lock.json | jq '.skills["template-skill"].source'
# Should output: "anthropics/skills"
```

## Files Changed

- `src/source-parser.ts` - Added SSH URL parsing in `getOwnerRepo()`
- `tests/source-parser.test.ts` - Added 5 test cases for SSH URLs

## Recommendation

This fix should be submitted upstream to `vercel-labs/skills`. The additional enhancement to make `parseSource()` recognize SSH URLs as GitHub/GitLab types (for full `skills check` support) could be a follow-up PR.
