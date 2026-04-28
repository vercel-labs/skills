import { readFile, readdir, lstat, readlink, rm, mkdir, symlink } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, relative, resolve } from 'path';
import { platform } from 'os';

export interface NpmSkill {
  packageName: string;
  skillName: string;
  skillPath: string;
  targetName: string;
  name: string;
  description: string;
}

export function sanitizePackageName(packageName: string): string {
  return packageName.replace(/^@/, '').replace(/\//g, '-').toLowerCase();
}

export function createTargetName(packageName: string, skillName?: string): string {
  const sanitized = sanitizePackageName(packageName);
  return skillName ? `npm-${sanitized}-${skillName}` : `npm-${sanitized}`;
}

// --- Package dependency reading ---

export async function getPackageDeps(cwd: string): Promise<string[] | null> {
  try {
    const content = await readFile(join(cwd, 'package.json'), 'utf-8');
    const data = JSON.parse(content);
    return Object.keys({ ...data.dependencies, ...data.devDependencies });
  } catch {
    return null;
  }
}

// --- Workspace support ---

export function searchForWorkspaceRoot(current: string): string {
  const ROOT_FILES = ['pnpm-workspace.yaml', 'lerna.json'];

  let dir = current;
  while (true) {
    if (ROOT_FILES.some((f) => existsSync(join(dir, f)))) return dir;
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      if (pkg.workspaces) return dir;
    } catch {
      // no package.json or invalid JSON
    }
    const parent = dirname(dir);
    if (parent === dir) return current;
    dir = parent;
  }
}

export async function getWorkspacePackageRoots(root: string): Promise<string[]> {
  const patterns: string[] = [];

  try {
    const content = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf-8');
    const { parse } = await import('yaml');
    const data = parse(content);
    if (Array.isArray(data?.packages)) {
      patterns.push(...data.packages);
    }
  } catch {
    // no pnpm-workspace.yaml
  }

  try {
    const content = await readFile(join(root, 'package.json'), 'utf-8');
    const data = JSON.parse(content);
    if (Array.isArray(data.workspaces)) {
      patterns.push(...data.workspaces);
    }
  } catch {
    // no package.json
  }

  if (patterns.length === 0) return [];

  const results: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;

    const cleanPattern = pattern.replace(/\/\*{1,2}$/, '');
    const parentDir = join(root, cleanPattern);

    if (cleanPattern === pattern) {
      if (existsSync(parentDir)) results.push(parentDir);
    } else {
      try {
        const entries = await readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            results.push(join(parentDir, entry.name));
          }
        }
      } catch {
        // directory doesn't exist
      }
    }
  }

  return results;
}

// --- Pattern matching for include/exclude ---

const patternCache = new Map<string, RegExp>();

function escapeRegexChar(char: string): string {
  return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function getPatternRegex(pattern: string): RegExp {
  const cached = patternCache.get(pattern);
  if (cached) return cached;

  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegexChar(char);
    }
  }
  source += '$';

  const regex = new RegExp(source);
  patternCache.set(pattern, regex);
  return regex;
}

export function matchesPattern(name: string, pattern: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return name === pattern;
  return getPatternRegex(pattern).test(name);
}

export function filterNpmSkills(
  skills: NpmSkill[],
  include?: string[],
  exclude?: string[]
): { skills: NpmSkill[]; excludedCount: number } {
  let result = skills;

  if (include && include.length > 0) {
    result = result.filter((skill) =>
      include.some((pattern) => matchesPattern(skill.packageName, pattern))
    );
  }

  if (exclude && exclude.length > 0) {
    result = result.filter(
      (skill) => !exclude.some((pattern) => matchesPattern(skill.packageName, pattern))
    );
  }

  return { skills: result, excludedCount: skills.length - result.length };
}

// --- Symlink helpers ---

export async function createSkillSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    if (resolvedTarget === resolvedLinkPath) return true;

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        const resolvedExisting = resolve(dirname(linkPath), existingTarget);
        if (resolvedExisting === resolvedTarget) return true;
        await rm(linkPath);
      } else {
        await rm(linkPath, { recursive: true });
      }
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'ELOOP'
      ) {
        try {
          await rm(linkPath, { force: true });
        } catch {
          // if we can't remove it, symlink creation will fail below
        }
      }
    }

    const linkDir = dirname(linkPath);
    await mkdir(linkDir, { recursive: true });

    const relativePath = relative(linkDir, target);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;
    await symlink(relativePath, linkPath, symlinkType);
    return true;
  } catch {
    return false;
  }
}

// --- Stale cleanup ---

export async function cleanupStaleNpmSkills(
  skillsDir: string,
  validTargetNames: Set<string>,
  dryRun: boolean = false
): Promise<Array<{ targetName: string; path: string; success: boolean }>> {
  const results: Array<{ targetName: string; path: string; success: boolean }> = [];

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    return results;
  }

  const staleEntries = entries.filter(
    (entry) => entry.startsWith('npm-') && !validTargetNames.has(entry)
  );

  for (const entry of staleEntries) {
    const entryPath = join(skillsDir, entry);
    if (dryRun) {
      results.push({ targetName: entry, path: entryPath, success: true });
      continue;
    }
    try {
      await rm(entryPath, { recursive: true, force: true });
      results.push({ targetName: entry, path: entryPath, success: true });
    } catch {
      results.push({ targetName: entry, path: entryPath, success: false });
    }
  }

  return results;
}
