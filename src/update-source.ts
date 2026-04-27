export interface UpdateSourceEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  skillPath?: string;
}

export interface LocalUpdateSourceEntry {
  source: string;
  ref?: string;
  skillPath?: string;
  sourceType?: string;
}

export function formatSourceInput(sourceUrl: string, ref?: string): string {
  if (!ref) {
    return sourceUrl;
  }
  return `${sourceUrl}#${ref}`;
}

/**
 * Derive the skill's folder path from a SKILL.md-terminated skillPath.
 * Returns '' when the skill lives at the repo root.
 */
function deriveSkillFolder(skillPath: string): string {
  let folder = skillPath;
  if (folder.endsWith('/SKILL.md')) {
    folder = folder.slice(0, -9);
  } else if (folder.endsWith('SKILL.md')) {
    folder = folder.slice(0, -8);
  }
  if (folder.endsWith('/')) {
    folder = folder.slice(0, -1);
  }
  return folder;
}

function appendFolderAndRef(source: string, skillPath: string, ref?: string): string {
  const folder = deriveSkillFolder(skillPath);
  const withFolder = folder ? `${source}/${folder}` : source;
  return ref ? `${withFolder}#${ref}` : withFolder;
}

/**
 * Build the source argument for `skills add` during update.
 * Uses shorthand form for path-targeted updates to avoid branch/path ambiguity.
 */
export function buildUpdateInstallSource(entry: UpdateSourceEntry): string {
  if (!entry.skillPath) {
    return formatSourceInput(entry.sourceUrl, entry.ref);
  }

  // For GitLab and generic git sources, always use the full sourceUrl.
  // The shorthand "source/skillFolder" format is GitHub-specific and would
  // be misidentified as a GitHub repo for any other host.
  if (entry.sourceType === 'gitlab' || entry.sourceType === 'git') {
    return formatSourceInput(entry.sourceUrl, entry.ref);
  }

  // Extract skill folder from skillPath (remove /SKILL.md suffix).
  let skillFolder = entry.skillPath;
  if (skillFolder.endsWith('/SKILL.md')) {
    skillFolder = skillFolder.slice(0, -9);
  } else if (skillFolder.endsWith('SKILL.md')) {
    skillFolder = skillFolder.slice(0, -8);
  }
  if (skillFolder.endsWith('/')) {
    skillFolder = skillFolder.slice(0, -1);
  }

  let installSource = skillFolder ? `${entry.source}/${skillFolder}` : entry.source;
  if (entry.ref) {
    installSource = `${installSource}#${entry.ref}`;
  }
  return installSource;
}

/**
 * Build the source argument for `skills add` during project-level update.
 */
export function buildLocalUpdateSource(entry: LocalUpdateSourceEntry): string {
  if (!entry.skillPath) {
    return formatSourceInput(entry.source, entry.ref);
  }

  const skillFolder = deriveSkillFolder(entry.skillPath);

  // For GitLab/git sources, build a /-/tree/ref/skillPath URL so the path
  // and host are preserved through re-parsing by parseSource.
  if (entry.sourceType === 'gitlab' || entry.sourceType === 'git') {
    if (entry.ref) {
      const baseUrl = entry.source.replace(/\.git$/, '');
      return `${baseUrl}/-/tree/${entry.ref}/${skillFolder || entry.skillPath}`;
    }
    // No ref recorded — fall back to repo root (can't embed path without a ref)
    return formatSourceInput(entry.source, undefined);
  }

  // GitHub: append skill folder to shorthand (e.g., "owner/repo/skills/my-skill#branch")
  return formatSourceInput(
    skillFolder ? `${entry.source}/${skillFolder}` : entry.source,
    entry.ref
  );
}
