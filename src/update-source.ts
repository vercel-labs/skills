export interface UpdateSourceEntry {
  source: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
  skillPath?: string;
}

export interface LocalUpdateSourceEntry {
  source: string;
  sourceUrl?: string;
  sourceType?: string;
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

/**
 * Whether a skill folder can be safely appended to the given source as a
 * subpath. Only true for sources the source-parser can resolve as a
 * GitHub/GitLab tree URL — owner/repo shorthand or an HTTPS URL on those
 * hosts. Full SSH URLs (`git@host:owner/repo.git` or `ssh://...`) and generic Git URLs
 * (anything ending in `.git`, or hosts other than github.com/gitlab.com)
 * cannot have a subpath appended without producing an unclonable URL.
 */
function supportsAppendedSubpath(source: string): boolean {
  if (source.startsWith('git@') || source.startsWith('ssh://')) return false;
  if (source.endsWith('.git')) return false;
  if (source.startsWith('http://') || source.startsWith('https://')) {
    try {
      const host = new URL(source).hostname;
      return host === 'github.com' || host === 'gitlab.com';
    } catch {
      return false;
    }
  }
  return true;
}

function isBareShorthand(source: string): boolean {
  return !source.includes(':') && !source.startsWith('.') && !source.startsWith('/');
}

function getLocalSource(entry: LocalUpdateSourceEntry): string | null {
  if (entry.sourceUrl) {
    return entry.sourceUrl;
  }
  // Older project locks normalized both generic Git and GitLab sources to an
  // owner/repo shorthand. Without the original URL, treating either one as a
  // source would incorrectly redirect the operation to GitHub.
  const requiresSourceUrl = entry.sourceType === 'git' || entry.sourceType === 'gitlab';
  if (requiresSourceUrl && isBareShorthand(entry.source)) {
    return null;
  }
  return entry.source;
}

export function shouldUseFullDepthForUpdate(entry: LocalUpdateSourceEntry): boolean {
  if (!entry.skillPath) return false;

  const source =
    entry.sourceType && entry.sourceType !== 'github' ? getLocalSource(entry) : entry.source;

  return source !== null && !supportsAppendedSubpath(source);
}

function appendFolderAndRef(source: string, skillPath: string, ref?: string): string {
  if (!supportsAppendedSubpath(source)) {
    return formatSourceInput(source, ref);
  }
  const folder = deriveSkillFolder(skillPath);
  const withFolder = folder ? `${source}/${folder}` : source;
  return ref ? `${withFolder}#${ref}` : withFolder;
}

/**
 * Build the source argument for `skills add` during update.
 * Uses shorthand form for path-targeted updates to avoid branch/path ambiguity.
 */
export function buildUpdateInstallSource(entry: UpdateSourceEntry): string | null {
  if (!entry.skillPath) {
    const source =
      entry.sourceType && entry.sourceType !== 'github'
        ? getLocalSource(entry)
        : entry.sourceUrl || entry.source;
    if (!source) {
      return null;
    }
    return formatSourceInput(source, entry.ref);
  }
  const source =
    entry.sourceType && entry.sourceType !== 'github' ? getLocalSource(entry) : entry.source;
  if (!source) {
    return null;
  }
  return appendFolderAndRef(source, entry.skillPath, entry.ref);
}

/**
 * Build the source argument for `skills add` during project-level update.
 * Returns null for legacy generic-Git or GitLab lock entries whose source was
 * normalized to an ambiguous owner/repo shorthand. Those entries lack the
 * original host, so reinterpreting them as GitHub would be unsafe.
 */
export function buildLocalUpdateSource(entry: LocalUpdateSourceEntry): string | null {
  const source = getLocalSource(entry);
  if (!source) {
    return null;
  }
  if (!entry.skillPath) {
    return formatSourceInput(source, entry.ref);
  }
  return appendFolderAndRef(source, entry.skillPath, entry.ref);
}
