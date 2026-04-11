import { lstat, mkdir, readlink, realpath, rename, rm, stat, symlink } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { agents, isUniversalAgent } from './agents.ts';
import { getCanonicalPath, getCanonicalSkillsDir, sanitizeName } from './installer.ts';
import type { AgentType } from './types.ts';

export type SkillEntryStatus = 'enabled' | 'disabled' | 'inconsistent' | 'missing';
export type ConcreteSkillEntryStatus = Exclude<SkillEntryStatus, 'missing'>;
export type InstalledSkillEntryKind = 'canonical' | 'alias' | 'copy';

export interface SkillEntryPaths {
  enabledPath: string;
  disabledPath: string;
}

export interface InstalledSkillEntry extends SkillEntryPaths {
  kind: InstalledSkillEntryKind;
  status: ConcreteSkillEntryStatus;
  currentPath?: string;
  agentType?: AgentType;
  symlinkTargetPath?: string;
}

export interface InstalledSkillSnapshot {
  name: string;
  status: SkillEntryStatus;
  canonical?: InstalledSkillEntry;
  agentEntries: InstalledSkillEntry[];
}

interface SkillPathInspection {
  exists: boolean;
  hasSkillFile: boolean;
}

export async function getSkillEntryStatus(paths: SkillEntryPaths): Promise<SkillEntryStatus> {
  const [enabled, disabled] = await Promise.all([
    inspectSkillPath(paths.enabledPath),
    inspectSkillPath(paths.disabledPath),
  ]);

  if (enabled.hasSkillFile && !disabled.exists) {
    return 'enabled';
  }

  if (disabled.hasSkillFile && !enabled.exists) {
    return 'disabled';
  }

  if (!enabled.exists && !disabled.exists) {
    return 'missing';
  }

  return 'inconsistent';
}

export async function getInstalledSkillSnapshot(
  skillName: string,
  options: { global?: boolean; cwd?: string } = {}
): Promise<InstalledSkillSnapshot> {
  const cwd = options.cwd || process.cwd();
  const isGlobal = options.global ?? false;
  const sanitizedSkillName = sanitizeName(skillName);

  const canonicalSkillsRoot = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalEnabledPath = getCanonicalPath(sanitizedSkillName, { global: isGlobal, cwd });
  const canonicalDisabledPath = join(getDisabledSkillsDir(canonicalSkillsRoot), sanitizedSkillName);

  const canonical = await inspectInstalledSkillEntry({
    kind: 'canonical',
    enabledPath: canonicalEnabledPath,
    disabledPath: canonicalDisabledPath,
  });

  const agentEntries: InstalledSkillEntry[] = [];
  const resolvedCanonicalRoot = await realpath(canonicalSkillsRoot).catch(
    () => canonicalSkillsRoot
  );
  const seenRoots = new Set<string>([resolvedCanonicalRoot]);

  for (const [agentType, agent] of Object.entries(agents) as [
    AgentType,
    (typeof agents)[AgentType],
  ][]) {
    if (isUniversalAgent(agentType)) {
      continue;
    }

    const rawSkillsRoot = isGlobal ? agent.globalSkillsDir : join(cwd, agent.skillsDir);
    if (!rawSkillsRoot) {
      continue;
    }

    const skillsRoot = await realpath(rawSkillsRoot).catch(() => rawSkillsRoot);

    if (seenRoots.has(skillsRoot)) {
      continue;
    }
    seenRoots.add(skillsRoot);

    const entry = await inspectInstalledSkillEntry({
      kind: 'agent',
      agentType,
      enabledPath: join(skillsRoot, sanitizedSkillName),
      disabledPath: join(getDisabledSkillsDir(skillsRoot), sanitizedSkillName),
      canonicalEnabledPath,
      canonicalDisabledPath,
    });

    if (entry) {
      agentEntries.push(entry);
    }
  }

  const statuses = [
    ...(canonical ? [canonical.status] : []),
    ...agentEntries.map((entry) => entry.status),
  ];

  let status: SkillEntryStatus = 'missing';
  if (statuses.length > 0) {
    status = statuses.every((entryStatus) => entryStatus === 'enabled')
      ? 'enabled'
      : statuses.every((entryStatus) => entryStatus === 'disabled')
        ? 'disabled'
        : 'inconsistent';
  }

  return {
    name: sanitizedSkillName,
    status,
    canonical,
    agentEntries,
  };
}

export async function setInstalledSkillState(
  skillName: string,
  targetState: 'enabled' | 'disabled',
  options: { global?: boolean; cwd?: string } = {}
): Promise<InstalledSkillSnapshot> {
  const snapshot = await getInstalledSkillSnapshot(skillName, options);

  if (snapshot.status === 'missing') {
    throw new Error(`Cannot move "${skillName}" because it is missing on disk.`);
  }

  if (snapshot.status === 'inconsistent') {
    throw new Error(`Cannot move "${skillName}" because its installed state is inconsistent.`);
  }

  const entries = [...(snapshot.canonical ? [snapshot.canonical] : []), ...snapshot.agentEntries];
  const canonicalTargetPath =
    targetState === 'enabled' ? snapshot.canonical?.enabledPath : snapshot.canonical?.disabledPath;

  for (const entry of entries.filter((candidate) => candidate.kind !== 'alias')) {
    if (entry.status === targetState) {
      continue;
    }

    await moveConcreteEntry(entry, targetState);
  }

  for (const entry of entries.filter((candidate) => candidate.kind === 'alias')) {
    if (!canonicalTargetPath) {
      throw new Error(`Cannot move "${skillName}" because its canonical target is missing.`);
    }

    if (entry.status === targetState) {
      continue;
    }

    await recreateAliasEntry(entry, targetState, canonicalTargetPath);
  }

  return getInstalledSkillSnapshot(skillName, options);
}

async function inspectSkillPath(path: string): Promise<SkillPathInspection> {
  const exists = await lstat(path)
    .then(() => true)
    .catch(() => false);

  const hasSkillFile = await stat(`${path}/SKILL.md`)
    .then(() => true)
    .catch(() => false);

  return { exists, hasSkillFile };
}

async function inspectInstalledSkillEntry(options: {
  kind: 'canonical' | 'agent';
  enabledPath: string;
  disabledPath: string;
  agentType?: AgentType;
  canonicalEnabledPath?: string;
  canonicalDisabledPath?: string;
}): Promise<InstalledSkillEntry | undefined> {
  const status = await getSkillEntryStatus({
    enabledPath: options.enabledPath,
    disabledPath: options.disabledPath,
  });

  if (status === 'missing') {
    return undefined;
  }

  const currentPath = await getCurrentPath(options.enabledPath, options.disabledPath);
  const currentStat = currentPath ? await lstat(currentPath).catch(() => null) : null;
  const isSymlink = currentStat?.isSymbolicLink() ?? false;

  if (options.kind === 'canonical') {
    return {
      kind: 'canonical',
      status: isSymlink ? 'inconsistent' : status,
      enabledPath: options.enabledPath,
      disabledPath: options.disabledPath,
      currentPath,
    };
  }

  if (isSymlink && currentPath) {
    const symlinkTargetPath = await resolveSymlinkTarget(currentPath);
    const expectedTarget =
      status === 'enabled' ? options.canonicalEnabledPath : options.canonicalDisabledPath;

    return {
      kind: 'alias',
      status: expectedTarget && symlinkTargetPath === expectedTarget ? status : 'inconsistent',
      enabledPath: options.enabledPath,
      disabledPath: options.disabledPath,
      currentPath,
      agentType: options.agentType,
      symlinkTargetPath,
    };
  }

  return {
    kind: 'copy',
    status,
    enabledPath: options.enabledPath,
    disabledPath: options.disabledPath,
    currentPath,
    agentType: options.agentType,
  };
}

async function getCurrentPath(
  enabledPath: string,
  disabledPath: string
): Promise<string | undefined> {
  if (await pathExists(enabledPath)) {
    return enabledPath;
  }

  if (await pathExists(disabledPath)) {
    return disabledPath;
  }

  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch(() => false);
}

async function resolveSymlinkTarget(linkPath: string): Promise<string | undefined> {
  try {
    const linkTarget = await readlink(linkPath);
    return resolve(dirname(linkPath), linkTarget);
  } catch {
    return undefined;
  }
}

function getDisabledSkillsDir(skillsRoot: string): string {
  return join(dirname(skillsRoot), 'disabled_skills');
}

async function moveConcreteEntry(
  entry: InstalledSkillEntry,
  targetState: 'enabled' | 'disabled'
): Promise<void> {
  const sourcePath = targetState === 'enabled' ? entry.disabledPath : entry.enabledPath;
  const destinationPath = targetState === 'enabled' ? entry.enabledPath : entry.disabledPath;

  await mkdir(dirname(destinationPath), { recursive: true });
  await rename(sourcePath, destinationPath);
}

async function recreateAliasEntry(
  entry: InstalledSkillEntry,
  targetState: 'enabled' | 'disabled',
  targetPath: string
): Promise<void> {
  const sourcePath = targetState === 'enabled' ? entry.disabledPath : entry.enabledPath;
  const destinationPath = targetState === 'enabled' ? entry.enabledPath : entry.disabledPath;

  await rm(sourcePath, { recursive: true, force: true });
  await mkdir(dirname(destinationPath), { recursive: true });

  const relativeTarget = relative(dirname(destinationPath), targetPath);
  const symlinkType = platform() === 'win32' ? 'junction' : undefined;
  await symlink(relativeTarget, destinationPath, symlinkType);
}
