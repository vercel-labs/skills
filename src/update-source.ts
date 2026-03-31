export interface UpdateSourceEntry {
  source: string;
  sourceUrl: string;
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
 * Build the source argument for `skills add` during update.
 * Uses shorthand form for path-targeted updates to avoid branch/path ambiguity.
 */
export function buildUpdateInstallSource(entry: UpdateSourceEntry): string {
  if (!entry.skillPath) {
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
