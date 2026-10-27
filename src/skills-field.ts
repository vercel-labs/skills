import { parseSource } from './source-parser.ts';
import type { ParsedSource } from './types.ts';
import type { Diagnostic } from 'nostics';
import { diagnostics } from './diagnostics.ts';

/**
 * The `skills` field of package.json: skills a package wants installed
 * without shipping their files. Grammar: https://github.com/antfu/skills-npm/blob/main/SPEC.md
 */
type SkillsFieldEntry = string | { source: string; skills?: string[]; ref?: string };

/** `npm:<package>`: the skills shipped by an installed package. */
interface NpmSkillsRequest {
  package: string;
  /** Folder or sanitized skill names to keep; empty means all. */
  skills: string[];
}

/** A git source to install skills from. */
export interface RemoteSkillsRequest {
  parsed: ParsedSource;
  /** Skill names to keep; empty means all. */
  skills: string[];
}

interface ParsedSkillsField {
  npm: NpmSkillsRequest[];
  remote: RemoteSkillsRequest[];
  errors: Diagnostic[];
}

const NPM_PREFIX = 'npm:';
// the SPEC allows git-hosted sources only, not local paths or plain URLs
const REMOTE_SOURCE_TYPES = new Set<ParsedSource['type']>(['github', 'gitlab', 'git']);

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
  const parsed: ParsedSkillsField = { npm: [], remote: [], errors: [] };

  for (const raw of entries) {
    if (!isSkillsFieldEntry(raw)) {
      parsed.errors.push(diagnostics.SKILLS_P002({ declarer, entry: JSON.stringify(raw) }));
      continue;
    }
    const { source, skills = [], ref } = typeof raw === 'string' ? { source: raw } : raw;
    if (!source.startsWith(NPM_PREFIX)) {
      const remote = parseSource(source);
      if (!REMOTE_SOURCE_TYPES.has(remote.type)) {
        parsed.errors.push(diagnostics.SKILLS_P003({ declarer, source }));
      } else if (ref !== undefined && remote.ref !== undefined) {
        parsed.errors.push(diagnostics.SKILLS_P004({ declarer, source }));
      } else {
        parsed.remote.push({
          parsed: { ...remote, ref: ref ?? remote.ref },
          skills: remote.skillFilter ? [...skills, remote.skillFilter] : skills,
        });
      }
    } else if (ref !== undefined) {
      parsed.errors.push(diagnostics.SKILLS_P005({ declarer, source }));
    } else {
      parsed.npm.push({ package: source.slice(NPM_PREFIX.length), skills });
    }
  }

  return parsed;
}
