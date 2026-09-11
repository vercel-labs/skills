import { dirname, join, relative, sep } from 'path';
import { fetchRepoTree, getSkillFolderHashFromTree } from './blob.ts';
import { cleanupTempDir, cloneRepo, getGitTreeHash } from './git.ts';
import { computeSkillFolderHash, readLocalLock, type LocalSkillLockEntry } from './local-lock.ts';
import { getGitHubToken, readSkillLock, type SkillLockEntry } from './skill-lock.ts';
import { discoverSkills } from './skills.ts';
import { checkWellKnownForUpdates, type WellKnownUpdateItem } from './update.ts';
import { buildLocalCloneSource } from './update-source.ts';

export type SkillUpdateScope = 'project' | 'global';

export interface AvailableSkillUpdate {
  name: string;
  scope: SkillUpdateScope;
  source: string;
  sourceType: string;
}

export interface SkillUpdateCheckProgress {
  checked: number;
  total: number;
  current: string | null;
}

export interface SkillUpdateCheckResult {
  updates: AvailableSkillUpdate[];
  checkedCount: number;
  totalCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface CheckAvailableSkillUpdatesOptions {
  scope: SkillUpdateScope | 'all';
  cwd?: string;
  onProgress?: (progress: SkillUpdateCheckProgress) => void;
}

interface ProjectCandidate {
  name: string;
  source: string;
  cloneSource: string;
  entry: LocalSkillLockEntry;
}

interface GlobalCandidate {
  name: string;
  source: string;
  entry: SkillLockEntry;
}

interface WellKnownCandidate {
  name: string;
  source: string;
  digest: string;
}

const UPDATE_CHECK_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(UPDATE_CHECK_CONCURRENCY, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function sourceGroupKey(source: string, ref?: string): string {
  return JSON.stringify([source, ref || '']);
}

function toSkillPath(repoDir: string, skillDirectory: string): string {
  return join(relative(repoDir, skillDirectory), 'SKILL.md').split(sep).join('/');
}

function createProgressReporter(
  total: number,
  onProgress?: (progress: SkillUpdateCheckProgress) => void
): (name: string) => void {
  let checked = 0;
  onProgress?.({ checked, total, current: null });
  return (name: string): void => {
    checked++;
    onProgress?.({ checked, total, current: name });
  };
}

function addUpdate(
  updates: AvailableSkillUpdate[],
  candidate: { name: string; source: string; entry: { sourceType: string } },
  scope: SkillUpdateScope
): void {
  updates.push({
    name: candidate.name,
    scope,
    source: candidate.source,
    sourceType: candidate.entry.sourceType,
  });
}

async function checkWellKnownCandidates(
  candidates: WellKnownCandidate[],
  scope: SkillUpdateScope,
  updates: AvailableSkillUpdate[],
  reportChecked: (name: string) => void
): Promise<number> {
  const groups = new Map<string, WellKnownCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.source) || [];
    group.push(candidate);
    groups.set(candidate.source, group);
  }

  const failures = await mapWithConcurrency([...groups], async ([source, items]) => {
    const checkItems: WellKnownUpdateItem[] = items.map((item) => ({
      name: item.name,
      digest: item.digest,
    }));
    const result = await checkWellKnownForUpdates(source, checkItems);
    if (result.status === 'changed') {
      const changed = new Set(result.changedSkills);
      for (const item of items) {
        if (changed.has(item.name)) {
          updates.push({
            name: item.name,
            scope,
            source: item.source,
            sourceType: 'well-known',
          });
        }
      }
    }
    for (const item of items) reportChecked(item.name);
    return result.status === 'error' ? items.length : 0;
  });

  return failures.reduce((total, count) => total + count, 0);
}

async function checkProjectUpdates(
  options: CheckAvailableSkillUpdatesOptions
): Promise<SkillUpdateCheckResult> {
  const lock = await readLocalLock(options.cwd);
  const candidates: ProjectCandidate[] = [];
  const wellKnown: WellKnownCandidate[] = [];
  let skippedCount = 0;

  for (const [name, entry] of Object.entries(lock.skills)) {
    if (entry.sourceType === 'local' || entry.sourceType === 'node_modules') {
      skippedCount++;
      continue;
    }
    if (entry.sourceType === 'well-known' && entry.sourceUrl && entry.wellKnownDigest) {
      wellKnown.push({ name, source: entry.sourceUrl, digest: entry.wellKnownDigest });
      continue;
    }
    const cloneSource = buildLocalCloneSource(entry);
    if (!entry.skillPath || !cloneSource) {
      skippedCount++;
      continue;
    }
    candidates.push({
      name,
      source: entry.sourceUrl || entry.source,
      cloneSource,
      entry,
    });
  }

  const totalCount = candidates.length + wellKnown.length;
  const reportChecked = createProgressReporter(totalCount, options.onProgress);
  const updates: AvailableSkillUpdate[] = [];
  const wellKnownFailures = checkWellKnownCandidates(wellKnown, 'project', updates, reportChecked);
  const groups = new Map<string, ProjectCandidate[]>();

  for (const candidate of candidates) {
    const key = sourceGroupKey(candidate.cloneSource, candidate.entry.ref);
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  const groupFailures = await mapWithConcurrency([...groups.values()], async (items) => {
    const first = items[0]!;
    let tempDir: string | null = null;
    let reportedCount = 0;
    let failedCount = 0;
    try {
      tempDir = await cloneRepo(first.cloneSource, first.entry.ref);
      const discovered = await discoverSkills(tempDir, undefined, { fullDepth: true });
      const directoriesByPath = new Map(
        discovered.map((skill) => [toSkillPath(tempDir!, skill.path), skill.path])
      );

      for (const candidate of items) {
        const directory = directoriesByPath.get(candidate.entry.skillPath!);
        if (!directory) {
          failedCount++;
          reportChecked(candidate.name);
          reportedCount++;
          continue;
        }
        const latestHash = await computeSkillFolderHash(directory);
        if (latestHash !== candidate.entry.computedHash) {
          addUpdate(updates, candidate, 'project');
        }
        reportChecked(candidate.name);
        reportedCount++;
      }
    } catch {
      const remaining = items.slice(reportedCount);
      failedCount += remaining.length;
      for (const candidate of remaining) reportChecked(candidate.name);
    } finally {
      if (tempDir) await cleanupTempDir(tempDir);
    }
    return failedCount;
  });
  const failedCount =
    (await wellKnownFailures) + groupFailures.reduce((total, count) => total + count, 0);

  return {
    updates: updates.sort((a, b) => a.name.localeCompare(b.name)),
    checkedCount: totalCount,
    totalCount,
    failedCount,
    skippedCount,
  };
}

async function checkGlobalUpdates(
  options: CheckAvailableSkillUpdatesOptions
): Promise<SkillUpdateCheckResult> {
  const lock = await readSkillLock();
  const candidates: GlobalCandidate[] = [];
  const wellKnown: WellKnownCandidate[] = [];
  let skippedCount = 0;

  for (const [name, entry] of Object.entries(lock.skills)) {
    if (entry.sourceType === 'well-known' && entry.sourceBaseUrl && entry.wellKnownDigest) {
      wellKnown.push({ name, source: entry.sourceBaseUrl, digest: entry.wellKnownDigest });
      continue;
    }
    if (!entry.skillPath || !entry.skillFolderHash) {
      skippedCount++;
      continue;
    }
    candidates.push({ name, source: entry.source, entry });
  }

  const totalCount = candidates.length + wellKnown.length;
  const reportChecked = createProgressReporter(totalCount, options.onProgress);
  const updates: AvailableSkillUpdate[] = [];
  const wellKnownFailures = checkWellKnownCandidates(wellKnown, 'global', updates, reportChecked);
  const groups = new Map<string, GlobalCandidate[]>();

  for (const candidate of candidates) {
    const key = sourceGroupKey(candidate.source, candidate.entry.ref);
    const group = groups.get(key) || [];
    group.push(candidate);
    groups.set(key, group);
  }

  const groupFailures = await mapWithConcurrency([...groups.values()], async (items) => {
    const first = items[0]!;
    let completed = false;
    let failedCount = 0;

    if (first.entry.sourceType === 'github') {
      try {
        const tree = await fetchRepoTree(first.source, first.entry.ref, getGitHubToken);
        if (tree) {
          for (const candidate of items) {
            const latestHash = getSkillFolderHashFromTree(tree, candidate.entry.skillPath!);
            if (latestHash && latestHash !== candidate.entry.skillFolderHash) {
              addUpdate(updates, candidate, 'global');
            } else if (!latestHash) {
              failedCount++;
            }
            reportChecked(candidate.name);
          }
          completed = true;
        }
      } catch {
        // Fall back to a credential-aware Git clone below.
      }
    }

    if (completed) return failedCount;

    let tempDir: string | null = null;
    let reportedCount = 0;
    try {
      const cloneSource = first.entry.sourceUrl || first.source;
      tempDir = await cloneRepo(cloneSource, first.entry.ref);
      const discovered = await discoverSkills(tempDir, undefined, { fullDepth: true });
      const discoveredPaths = new Set(discovered.map((skill) => toSkillPath(tempDir!, skill.path)));

      for (const candidate of items) {
        const skillPath = candidate.entry.skillPath!;
        if (!discoveredPaths.has(skillPath)) {
          failedCount++;
          reportChecked(candidate.name);
          reportedCount++;
          continue;
        }
        const usesGitTreeHash =
          candidate.entry.sourceType === 'github' &&
          /^[0-9a-f]{40}$/i.test(candidate.entry.skillFolderHash);
        const latestHash = usesGitTreeHash
          ? await getGitTreeHash(tempDir, skillPath)
          : await computeSkillFolderHash(join(tempDir, dirname(skillPath)));
        if (latestHash && latestHash !== candidate.entry.skillFolderHash) {
          addUpdate(updates, candidate, 'global');
        } else if (!latestHash) {
          failedCount++;
        }
        reportChecked(candidate.name);
        reportedCount++;
      }
    } catch {
      const remaining = items.slice(reportedCount);
      failedCount += remaining.length;
      for (const candidate of remaining) reportChecked(candidate.name);
    } finally {
      if (tempDir) await cleanupTempDir(tempDir);
    }
    return failedCount;
  });
  const failedCount =
    (await wellKnownFailures) + groupFailures.reduce((total, count) => total + count, 0);

  return {
    updates: updates.sort((a, b) => a.name.localeCompare(b.name)),
    checkedCount: totalCount,
    totalCount,
    failedCount,
    skippedCount,
  };
}

export async function checkAvailableSkillUpdates(
  options: CheckAvailableSkillUpdatesOptions
): Promise<SkillUpdateCheckResult> {
  if (options.scope === 'global') return checkGlobalUpdates(options);
  if (options.scope === 'project') return checkProjectUpdates(options);

  const progress = {
    project: { checked: 0, total: 0, current: null as string | null },
    global: { checked: 0, total: 0, current: null as string | null },
  };
  const reportProgress =
    (scope: SkillUpdateScope) =>
    (value: SkillUpdateCheckProgress): void => {
      progress[scope] = value;
      options.onProgress?.({
        checked: progress.project.checked + progress.global.checked,
        total: progress.project.total + progress.global.total,
        current: value.current,
      });
    };

  const [project, global] = await Promise.all([
    checkProjectUpdates({ ...options, scope: 'project', onProgress: reportProgress('project') }),
    checkGlobalUpdates({ ...options, scope: 'global', onProgress: reportProgress('global') }),
  ]);
  const checkedCount = project.checkedCount + global.checkedCount;
  const totalCount = project.totalCount + global.totalCount;

  return {
    updates: [...project.updates, ...global.updates].sort(
      (a, b) => a.name.localeCompare(b.name) || a.scope.localeCompare(b.scope)
    ),
    checkedCount,
    totalCount,
    failedCount: project.failedCount + global.failedCount,
    skippedCount: project.skippedCount + global.skippedCount,
  };
}
