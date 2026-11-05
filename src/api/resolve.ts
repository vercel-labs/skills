import { existsSync } from 'fs';
import { realpath } from 'fs/promises';
import { posix, relative, sep } from 'path';
import { fetchSource, releaseSource, type FetchedSource } from '../add.ts';
import { Diagnostic } from 'nostics';
import { diagnostics } from '../diagnostics.ts';
import { getHeadCommit } from '../git.ts';
import { getSkillDisplayName } from '../skills.ts';
import { parseSource } from '../source-parser.ts';
import type { ParsedSource, Skill } from '../types.ts';
import { resolveConfig, type ResolvedConfig } from './config.ts';
import { throwIfAborted } from './errors.ts';
import type { ResolveOptions, SkillInfo, SkillSource, SourceInfo } from './types.ts';
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
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'source',
      expected: 'a non-empty string',
    });
  }
  return parseSource(input, { cwd });
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
    throw diagnostics.SKILLS_LOCAL_PATH_NOT_FOUND({ path: parsed.localPath! });
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
    throw diagnostics.SKILLS_NO_VALID_SKILLS();
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
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'ref',
      expected: 'a non-empty string',
    });
  }
  if (!GIT_SOURCE_TYPES.has(parsed.type)) {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'ref',
      expected: 'used only with git sources',
    });
  }
  return { ...parsed, ref };
}

/**
 * The error behind a failed fetch: the original diagnostic (git, download,
 * archive, well-known), or SKILLS_SOURCE_FETCH_FAILED wrapping anything else.
 */
function fetchError(input: string, fetched: FetchedSource): Error {
  const { cause } = fetched;
  if (cause instanceof Diagnostic) return cause;
  return diagnostics.SKILLS_SOURCE_FETCH_FAILED({
    source: input,
    detail: fetched.error ?? 'unknown error',
    cause,
  });
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
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'source',
      expected: 'a source string or a SkillSource returned by resolveSource()',
    });
  }
  if (state.disposed) {
    throw diagnostics.SKILLS_SOURCE_DISPOSED();
  }
  return state.fetched;
}
