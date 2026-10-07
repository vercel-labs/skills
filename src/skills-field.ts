/**
 * The `skills` field of package.json: skills a package wants installed
 * without shipping their files. Grammar: https://github.com/antfu/skills-npm/blob/main/SPEC.md
 */
export type SkillsFieldEntry = string | { source: string; skills?: string[]; ref?: string };

/** `npm:<package>`: the skills shipped by an installed package. */
export interface NpmSkillsRequest {
  package: string;
  /** Folder or sanitized skill names to keep; empty means all. */
  skills: string[];
}

export interface ParsedSkillsField {
  npm: NpmSkillsRequest[];
  /** Number of remote (git) entries; installing them is not supported yet. */
  remote: number;
  errors: string[];
}

const NPM_PREFIX = 'npm:';

function isSkillsFieldEntry(value: unknown): value is SkillsFieldEntry {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object' || !('source' in value)) return false;
  if (typeof value.source !== 'string') return false;
  const skills = 'skills' in value ? value.skills : undefined;
  const ref = 'ref' in value ? value.ref : undefined;
  return (
    (skills === undefined ||
      (Array.isArray(skills) && skills.every((s) => typeof s === 'string'))) &&
    (ref === undefined || typeof ref === 'string')
  );
}

/** Parse the entries of `declarer`'s `skills` field. Problems are returned, not thrown. */
export function parseSkillsField(entries: unknown[], declarer: string): ParsedSkillsField {
  const parsed: ParsedSkillsField = { npm: [], remote: 0, errors: [] };

  for (const raw of entries) {
    if (!isSkillsFieldEntry(raw)) {
      parsed.errors.push(`${declarer}: invalid "skills" entry ${JSON.stringify(raw)}`);
      continue;
    }
    const entry = typeof raw === 'string' ? { source: raw } : raw;
    if (!entry.source.startsWith(NPM_PREFIX)) {
      parsed.remote++;
      continue;
    }

    const name = entry.source.slice(NPM_PREFIX.length);
    if (!name) {
      parsed.errors.push(`${declarer}: "npm:" needs a package name`);
    } else if ('ref' in entry && entry.ref !== undefined) {
      parsed.errors.push(`${declarer}: "ref" cannot be used with "${entry.source}"`);
    } else {
      parsed.npm.push({ package: name, skills: ('skills' in entry && entry.skills) || [] });
    }
  }

  return parsed;
}
