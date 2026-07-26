export interface UpdateSourceEntry {
  source: string;
  sourceUrl: string;
  ref?: string;
  skillPath?: string;
}

export interface LocalUpdateSourceEntry {
  source: string;
  ref?: string;
  skillPath?: string;
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
  return appendFolderAndRef(entry.source, entry.skillPath, entry.ref);
}

/**
 * Build the source argument for `skills add` during project-level update.
 * Local lock entries don't carry `sourceUrl`, so we fall back to the bare
 * `source` identifier when no `skillPath` is available.
 */
export function buildLocalUpdateSource(entry: LocalUpdateSourceEntry): string {
  if (!entry.skillPath) {
    return formatSourceInput(entry.source, entry.ref);
  }
  return appendFolderAndRef(entry.source, entry.skillPath, entry.ref);
}
