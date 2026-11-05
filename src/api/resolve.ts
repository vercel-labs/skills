import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { posix, relative, sep } from 'path';
import { fetchSource, releaseSource, type FetchedSource } from '../add.ts';
import { isDiagnostic } from '../diagnostics.ts';
import { getHeadCommit, isMissingRefError } from '../git.ts';
import { getSkillDisplayName } from '../skills.ts';
import { parseSource } from '../source-parser.ts';
import type { ParsedSource, Skill } from '../types.ts';
import { resolveConfig, type ResolvedConfig } from './config.ts';
import { errorMessage, SkillsError, throwIfAborted } from './errors.ts';
import type {
  ResolveOptions,
  SkillInfo,
  SkillsErrorCode,
  SkillSource,
  SourceInfo,
} from './types.ts';
import { runWithWarnings } from './warnings.ts';

interface SourceState {
  fetched: FetchedSource;
  disposed: boolean;
}

const GIT_SOURCE_TYPES: ReadonlySet<ParsedSource['type']> = new Set(['github', 'gitlab', 'git']);

/** Internal state of each SkillSource, kept off the public object. */
const sourceStates = new WeakMap<SkillSource, SourceState>();

export function parseSourceInput(input: string, cwd: string): ParsedSource {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SkillsError('INVALID_SOURCE', 'Source must be a non-empty string');
  }
  try {
    return parseSource(input, { cwd });
  } catch (error) {
    throw new SkillsError('INVALID_SOURCE', errorMessage(error), { cause: error });
  }
}

export function toSourceInfo(input: string, parsed: ParsedSource, commit?: string): SourceInfo {
  return Object.freeze({
    input,
    type: parsed.type,
    url: parsed.url,
    ...(parsed.ref && { ref: parsed.ref }),
    ...(commit && { commit }),
    ...(parsed.subpath && { subpath: parsed.subpath }),
  });
}

/**
 * Fetch `source` (a GitHub shorthand, git or HTTPS URL, or local path) and
 * discover its skills without installing anything. Call `dispose()` on the
 * result, or pass it to `installSkills`, which keeps it usable.
 */
export async function resolveSource(
  source: string,
  options: ResolveOptions = {}
): Promise<SkillSource> {
  const config = resolveConfig(options);
  return runWithWarnings(options, () => openSource(source, config, [], options));
}

/** Fetch `input` and wrap it in a SkillSource; `requested` names guide discovery. */
export async function openSource(
  input: string,
  config: ResolvedConfig,
  requested: readonly string[],
  options: Pick<ResolveOptions, 'signal' | 'onProgress' | 'ref'>
): Promise<SkillSource> {
  const parsed = withRef(parseSourceInput(input, config.cwd), options.ref);
  throwIfAborted(options.signal);

  if (parsed.type === 'local' && !existsSync(parsed.localPath!)) {
    throw new SkillsError('SOURCE_NOT_FOUND', `Local path does not exist: ${parsed.localPath}`);
  }

  const skills =
    requested.length > 0 ? [...requested] : parsed.skillFilter ? [parsed.skillFilter] : [];
  options.onProgress?.({ type: 'resolve:start', source: input });
  const fetched = await fetchSource({
    parsed,
    skills,
    fullDepth: config.fullDepth,
    includeInternal: config.includeInternal || skills.length > 0,
    // Kept so duplicates can be reported; only the first of each name is installed.
    includeDuplicateNames: true,
  });
  if (!fetched.resolved) throw fetchError(input, fetched);

  const handle = await createSkillSource(input, fetched);
  if (options.signal?.aborted) {
    await handle.dispose();
    throwIfAborted(options.signal);
  }
  if (handle.skills.length === 0) {
    await handle.dispose();
    throw new SkillsError('NO_SKILLS_FOUND', `No skills found in ${input}`);
  }
  options.onProgress?.({
    type: 'resolve:done',
    source: handle.source,
    skills: handle.skills.length,
  });
  return handle;
}

/** Apply a `ref` option, which only git sources accept. */
function withRef(parsed: ParsedSource, ref: string | undefined): ParsedSource {
  if (ref === undefined) return parsed;
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new SkillsError('INVALID_OPTIONS', '`ref` must be a non-empty string');
  }
  if (!GIT_SOURCE_TYPES.has(parsed.type)) {
    throw new SkillsError('INVALID_OPTIONS', `\`ref\` is not supported for ${parsed.type} sources`);
  }
  return { ...parsed, ref };
}

/** Map a failed fetch to a SkillsError, keeping the original error as `cause`. */
function fetchError(input: string, fetched: FetchedSource): SkillsError {
  const message = fetched.error ?? `Could not fetch ${input}`;
  const { cause } = fetched;
  let code: SkillsErrorCode = 'SOURCE_FETCH_FAILED';
  if (isDiagnostic(cause, 'SKILLS_GIT_CLONE_TIMEOUT')) code = 'SOURCE_TIMEOUT';
  else if (isDiagnostic(cause, 'SKILLS_GIT_CLONE_FAILED') && isMissingRefError(cause.message)) {
    code = 'SOURCE_REF_NOT_FOUND';
  }
  // Hosts report a private repository without access as "not found", so a
  // missing repository and missing credentials are indistinguishable.
  else if (isDiagnostic(cause, 'SKILLS_GIT_AUTH_FAILED', 'SKILLS_GIT_SAML_SSO_BLOCKED')) {
    code = 'SOURCE_AUTH_FAILED';
  }
  return new SkillsError(code, message, { cause });
}

async function createSkillSource(input: string, raw: FetchedSource): Promise<SkillSource> {
  const { fetched, duplicates } = await dedupeSkills(raw);
  const skills: SkillInfo[] = fetched.resolved!.skills.map((skill) => {
    const path = skillPath(fetched, skill);
    const others = duplicates.get(skill);
    return Object.freeze({
      name: getSkillDisplayName(skill),
      description: skill.description,
      ...(path !== undefined && { path }),
      ...(others && { duplicates: Object.freeze(others) }),
      ...(skill.pluginName && { pluginName: skill.pluginName }),
      ...(skill.metadata && { metadata: Object.freeze({ ...skill.metadata }) }),
    });
  });

  const { resolved, parsed } = fetched;
  const commit =
    GIT_SOURCE_TYPES.has(parsed.type) && resolved!.tempDir && !resolved!.blobResult
      ? ((await getHeadCommit(resolved!.tempDir)) ?? undefined)
      : undefined;

  const state: SourceState = { fetched, disposed: false };
  const handle: SkillSource = Object.freeze({
    source: toSourceInfo(input, parsed, commit),
    skills: Object.freeze(skills),
    async dispose() {
      if (state.disposed) return;
      state.disposed = true;
      await releaseSource(fetched);
    },
  });
  sourceStates.set(handle, state);
  return handle;
}

/**
 * Keep the first skill of each name, as `skills add` does, and record the
 * paths of the others. Copies that resolve to the same folder (symlinks)
 * are not duplicates.
 */
async function dedupeSkills(
  fetched: FetchedSource
): Promise<{ fetched: FetchedSource; duplicates: Map<Skill, string[]> }> {
  const resolved = fetched.resolved!;
  const first = new Map<string, { skill: Skill; real: string }>();
  const kept: Skill[] = [];
  const duplicates = new Map<Skill, string[]>();

  for (const skill of resolved.skills) {
    const name = getSkillDisplayName(skill);
    const real = skill.path ? await realpath(skill.path).catch(() => skill.path) : '';
    const winner = first.get(name);
    if (!winner) {
      first.set(name, { skill, real });
      kept.push(skill);
      continue;
    }
    if (real && real === winner.real) continue;
    const path = skillPath(fetched, skill);
    if (path === undefined) continue;
    duplicates.set(winner.skill, [...(duplicates.get(winner.skill) ?? []), path]);
  }

  return { fetched: { ...fetched, resolved: { ...resolved, skills: kept } }, duplicates };
}

/** A skill's folder relative to the source root, `/`-separated; undefined when unknown. */
function skillPath({ resolved }: FetchedSource, skill: Skill): string | undefined {
  if ('repoPath' in skill && typeof skill.repoPath === 'string') {
    return posix.dirname(skill.repoPath);
  }
  const root = resolved?.rootDir;
  if (!root || !skill.path) return undefined;
  const rel = relative(root, skill.path);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

/** The fetched source behind a handle returned by resolveSource. */
export function getFetchedSource(handle: SkillSource): FetchedSource {
  const state = sourceStates.get(handle);
  if (!state) {
    throw new SkillsError('INVALID_SOURCE', 'Expected a source returned by resolveSource()');
  }
  if (state.disposed) {
    throw new SkillsError('SOURCE_DISPOSED', 'This source was already disposed');
  }
  return state.fetched;
}
