import { existsSync } from 'fs';
import { fetchSource, releaseSource, type FetchedSource } from '../add.ts';
import { getSkillDisplayName } from '../skills.ts';
import { parseSource } from '../source-parser.ts';
import type { ParsedSource } from '../types.ts';
import { resolveConfig, type ResolvedConfig } from './config.ts';
import { errorMessage, SkillsError, throwIfAborted } from './errors.ts';
import type { ResolveOptions, SkillInfo, SkillSource, SourceInfo } from './types.ts';

interface SourceState {
  fetched: FetchedSource;
  disposed: boolean;
}

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

export function toSourceInfo(input: string, parsed: ParsedSource): SourceInfo {
  return Object.freeze({
    input,
    type: parsed.type,
    url: parsed.url,
    ...(parsed.ref && { ref: parsed.ref }),
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
  return openSource(source, resolveConfig(options), [], options);
}

/** Fetch `input` and wrap it in a SkillSource; `requested` names guide discovery. */
export async function openSource(
  input: string,
  config: ResolvedConfig,
  requested: readonly string[],
  options: Pick<ResolveOptions, 'signal' | 'onProgress'>
): Promise<SkillSource> {
  const parsed = parseSourceInput(input, config.cwd);
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
  });
  if (!fetched.resolved) {
    throw new SkillsError('SOURCE_FETCH_FAILED', fetched.error ?? `Could not fetch ${input}`);
  }

  const handle = createSkillSource(input, fetched);
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

function createSkillSource(input: string, fetched: FetchedSource): SkillSource {
  const skills: SkillInfo[] = (fetched.resolved?.skills ?? []).map((skill) =>
    Object.freeze({
      name: getSkillDisplayName(skill),
      description: skill.description,
      ...(skill.pluginName && { pluginName: skill.pluginName }),
      ...(skill.metadata && { metadata: Object.freeze({ ...skill.metadata }) }),
    })
  );
  const state: SourceState = { fetched, disposed: false };
  const handle: SkillSource = Object.freeze({
    source: toSourceInfo(input, fetched.parsed),
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
