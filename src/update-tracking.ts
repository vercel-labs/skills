import { existsSync } from 'fs';
import { cleanupTempDir, cloneRepo } from './git.ts';
import { getCanonicalPath } from './installer.ts';
import { wellKnownProvider } from './providers/index.ts';
import { computeTextFileHash, computeTrackedSkillDirectoryHash } from './skill-hash.ts';
import type { SkillLockEntry } from './skill-lock.ts';
import { fetchSkillFolderHash } from './skill-lock.ts';
import { discoverSkills, filterSkills, getSkillDisplayName } from './skills.ts';
import type { Skill } from './types.ts';

export async function getInstalledTrackingHash(
  skillName: string,
  entry: Pick<SkillLockEntry, 'skillFolderHash' | 'sourceType'>
): Promise<string | null> {
  if (entry.skillFolderHash) {
    return entry.skillFolderHash;
  }

  if (entry.sourceType === 'github' || entry.sourceType === 'local') {
    return null;
  }

  const installPath = getCanonicalPath(skillName, { global: true });
  if (!existsSync(installPath)) {
    return null;
  }

  try {
    return await computeTrackedSkillDirectoryHash(installPath);
  } catch {
    return null;
  }
}

export async function getLatestTrackingHash(
  skillName: string,
  entry: Pick<SkillLockEntry, 'source' | 'sourceType' | 'sourceUrl' | 'skillPath' | 'ref'>,
  token?: string | null
): Promise<string | null> {
  switch (entry.sourceType) {
    case 'github':
      if (!entry.skillPath) {
        return null;
      }
      return fetchSkillFolderHash(entry.source, entry.skillPath, token, entry.ref);
    case 'well-known':
      return fetchWellKnownSkillHash(skillName, entry.sourceUrl);
    case 'git':
    case 'gitlab':
      return fetchRepositorySkillHash(skillName, entry.sourceUrl, entry.ref);
    default:
      return null;
  }
}

export function buildUpdateCommandArgs(skillName: string, source: string): string[] {
  return ['add', source, '-g', '-y', '--skill', skillName];
}

async function fetchRepositorySkillHash(
  skillName: string,
  sourceUrl: string,
  ref?: string
): Promise<string | null> {
  let tempDir: string | null = null;

  try {
    tempDir = await cloneRepo(sourceUrl, ref);
    const skills = await discoverSkills(tempDir, undefined, { includeInternal: true });
    const selectedSkill = selectSkillByName(skills, skillName);
    if (!selectedSkill) {
      return null;
    }

    return await computeTrackedSkillDirectoryHash(selectedSkill.path);
  } catch {
    return null;
  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
  }
}

async function fetchWellKnownSkillHash(
  skillName: string,
  sourceUrl: string
): Promise<string | null> {
  const parsedSource = parseWellKnownSkillSource(sourceUrl);

  if (parsedSource) {
    const indexResult = await wellKnownProvider.fetchIndex(parsedSource.baseUrl);
    const matchedEntry = indexResult?.index.skills.find(
      (entry) => entry.name === parsedSource.skillSlug
    );

    if (indexResult && matchedEntry) {
      const skill = await wellKnownProvider.fetchSkillByEntry(
        indexResult.resolvedBaseUrl,
        matchedEntry
      );
      if (skill) {
        return computeTextFileHash(skill.files);
      }
    }
  }

  const skills = await wellKnownProvider.fetchAllSkills(sourceUrl);
  const selectedSkill = skills.find(
    (skill) => skill.installName === skillName || skill.name === skillName
  );

  return selectedSkill ? computeTextFileHash(selectedSkill.files) : null;
}

function selectSkillByName(skills: Skill[], skillName: string): Skill | null {
  const exactMatch = skills.find(
    (skill) => getSkillDisplayName(skill) === skillName || skill.name === skillName
  );

  if (exactMatch) {
    return exactMatch;
  }

  const filteredSkills = filterSkills(skills, [skillName]);
  return filteredSkills.length === 1 ? filteredSkills[0]! : null;
}

function parseWellKnownSkillSource(
  sourceUrl: string
): { baseUrl: string; skillSlug: string } | null {
  try {
    const parsedUrl = new URL(sourceUrl);
    const match = parsedUrl.pathname.match(/^(.*)\/\.well-known\/skills\/([^/]+)\/SKILL\.md$/i);
    if (!match) {
      return null;
    }

    const [, basePath, skillSlug] = match;
    return {
      baseUrl: `${parsedUrl.protocol}//${parsedUrl.host}${basePath || ''}`,
      skillSlug: skillSlug!,
    };
  } catch {
    return null;
  }
}
