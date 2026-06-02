/**
 * Remote plugin resolution engine.
 *
 * Turns a RemotePluginEntry (a marketplace.json plugin entry whose source points
 * at another repository) into discovered skills on disk: clone the referenced
 * repo at the declared ref/sha, then discover skills at the declared path.
 *
 * This module is format-agnostic: it only consumes { url, path?, ref?, sha? }
 * shaped sources and knows nothing about how manifests declare them.
 */
import { join } from 'path';
import { tmpdir } from 'os';
import { cloneRepo, cloneRepoAtSha, cloneRepoSparse, getHeadSha, cleanupTempDir } from './git.ts';
import { discoverSkills, isSubpathSafe, type DiscoverSkillsOptions } from './skills.ts';
import type {
  RemotePluginEntry,
  ResolvableRemoteSource,
  ResolvedFromInfo,
  Skill,
} from './types.ts';

/** A successfully resolved remote plugin */
export interface ResolvedPlugin {
  /** The marketplace entry that was resolved */
  entry: RemotePluginEntry;
  /** Temp directory containing the cloned repository (caller must clean up) */
  clonePath: string;
  /** The commit SHA that was actually checked out */
  resolvedSha: string;
  /** Skills discovered within the resolved plugin, tagged with the plugin name */
  skills: Skill[];
}

/** A failed resolution, isolated per plugin */
export interface ResolutionFailure {
  entry: RemotePluginEntry;
  error: Error;
}

export type ResolutionResult =
  | { ok: true; plugin: ResolvedPlugin }
  | { ok: false; failure: ResolutionFailure };

/** GitHub owner/repo shorthand (no protocol, no host) */
const OWNER_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * Convert a remote plugin source into a cloneable git URL.
 */
export function toCloneUrl(source: ResolvableRemoteSource): string {
  switch (source.source) {
    case 'github':
      return `https://github.com/${source.repo}.git`;
    case 'url':
      return source.url;
    case 'git-subdir':
      // git-subdir urls may use GitHub owner/repo shorthand per the Claude Code spec
      return OWNER_REPO_PATTERN.test(source.url)
        ? `https://github.com/${source.url}.git`
        : source.url;
  }
}

/**
 * Resolve a remote plugin: clone its repository at the declared ref/sha and
 * discover the skills inside it.
 *
 * The returned clonePath is a temp directory the caller must clean up
 * (via cleanupTempDir) once the discovered skills have been installed.
 * On failure the clone is cleaned up before the error propagates.
 */
export async function resolveRemotePlugin(
  entry: RemotePluginEntry,
  options?: DiscoverSkillsOptions
): Promise<ResolvedPlugin> {
  const source = entry.source;
  const cloneUrl = toCloneUrl(source);

  // git-subdir sources know the path up front, so we sparse, partial clone just
  // that subdirectory (parity with Claude Code). github/url sources have no path
  // before discovery, so they clone normally. A sha pin always wins over ref.
  let clonePath: string;
  if (source.source === 'git-subdir') {
    // Defense in depth: reject a path that would escape the clone before we hand
    // it to git sparse-checkout (manifest parsing already rejects these). The
    // base is a synthetic non-root dir so containment is checked correctly.
    if (!isSubpathSafe(join(tmpdir(), 'skills-clone-base'), source.path)) {
      throw new Error(
        `Invalid subpath: "${source.path}" resolves outside the repository directory.`
      );
    }
    clonePath = await cloneRepoSparse(cloneUrl, {
      path: source.path,
      ref: source.ref,
      sha: source.sha,
    });
  } else if (source.sha) {
    clonePath = await cloneRepoAtSha(cloneUrl, source.sha, source.ref);
  } else {
    clonePath = await cloneRepo(cloneUrl, source.ref);
  }

  try {
    const resolvedSha = await getHeadSha(clonePath);

    // git-subdir scopes discovery to the declared subdirectory.
    // discoverSkills validates the subpath against traversal.
    const subpath = source.source === 'git-subdir' ? source.path : undefined;
    const pluginRoot = subpath ? join(clonePath, subpath) : clonePath;

    const seenNames = new Set<string>();
    const skills: Skill[] = [];
    const addSkills = (found: Skill[]) => {
      for (const skill of found) {
        if (seenNames.has(skill.name)) continue;
        seenNames.add(skill.name);
        skills.push({ ...skill, pluginName: entry.name });
      }
    };

    // Conventional discovery scoped to the plugin root
    addSkills(await discoverSkills(clonePath, subpath, options));

    // Skill paths explicitly declared on the marketplace entry (./-prefixed,
    // relative to the plugin root). Paths escaping the plugin root are ignored.
    for (const skillPath of entry.skills ?? []) {
      if (!isSubpathSafe(pluginRoot, skillPath)) continue;
      addSkills(await discoverSkills(join(pluginRoot, skillPath), undefined, options));
    }

    return { entry, clonePath, resolvedSha, skills };
  } catch (error) {
    // Don't leak the temp clone when discovery fails
    await cleanupTempDir(clonePath).catch(() => {});
    throw error;
  }
}

/** Key under Skill.metadata that carries an unresolved RemotePluginEntry */
const REMOTE_PLUGIN_METADATA_KEY = 'remotePluginEntry';

/**
 * Human-readable display of where a remote source points (host + repo + path),
 * without protocol noise. Used for transparency output at resolution/install time.
 */
export function getRemoteSourceDisplay(source: ResolvableRemoteSource): string {
  let location: string;
  switch (source.source) {
    case 'github':
      location = `github.com/${source.repo}`;
      break;
    case 'url':
    case 'git-subdir':
      location = source.url.replace(/^(https?:\/\/|git@|ssh:\/\/)/, '').replace(/\.git$/, '');
      break;
  }
  if (source.source === 'git-subdir') {
    location += `/${source.path}`;
  }
  return location;
}

/**
 * Just the host of a remote source (e.g. "gitlab.company.com"). Used in selection
 * hints, where the full url+path would wrap in narrow terminals and corrupt the
 * prompt rendering. Full transparency comes from getRemoteSourceDisplay() later.
 */
export function getRemoteSourceHost(source: ResolvableRemoteSource): string {
  if (source.source === 'github') return 'github.com';
  const url = source.url;
  if (url.startsWith('file://')) {
    // Local repos (tests, fixtures): the repo directory name is the clearest label
    const segments = url.slice('file://'.length).split('/').filter(Boolean);
    return segments[segments.length - 1] ?? url;
  }
  const stripped = url.replace(/^(https?:\/\/|ssh:\/\/|git@)/, '');
  const host = stripped.split(/[/:]/, 1)[0];
  return host || stripped;
}

/**
 * Create a placeholder Skill for an unresolved remote plugin so it can flow
 * through the existing selection UI without cloning anything. Placeholders are
 * replaced by the skills they resolve to after selection.
 *
 * The description doubles as the selection hint, so it must stay short: over-long
 * hints wrap in narrow terminals and corrupt clack's prompt redraws. The host
 * comes first so truncation never hides it (trust model: the remote host is
 * visible before anything is cloned).
 */
export function createRemotePlaceholder(entry: RemotePluginEntry): Skill {
  const host = getRemoteSourceHost(entry.source);
  return {
    name: entry.name,
    description: entry.description ? `${host} · ${entry.description}` : `${host} · remote plugin`,
    path: '', // not on disk yet
    pluginName: entry.name,
    metadata: { [REMOTE_PLUGIN_METADATA_KEY]: entry },
  };
}

/**
 * Get the RemotePluginEntry carried by a placeholder skill, or null if the
 * skill is a regular on-disk skill.
 */
export function getRemotePluginEntry(skill: Skill): RemotePluginEntry | null {
  const entry = skill.metadata?.[REMOTE_PLUGIN_METADATA_KEY];
  return entry ? (entry as RemotePluginEntry) : null;
}

/**
 * Build the lock file provenance record for a resolved plugin.
 */
export function buildResolvedFrom(plugin: ResolvedPlugin): ResolvedFromInfo {
  const source = plugin.entry.source;
  return {
    pluginName: plugin.entry.name,
    url: toCloneUrl(source),
    ...(source.source === 'git-subdir' && { path: source.path }),
    ...(source.ref && { ref: source.ref }),
    sha: plugin.resolvedSha,
  };
}

/**
 * Resolve multiple remote plugins concurrently with per-plugin error isolation:
 * one unreachable repository does not block the others.
 */
export async function resolveRemotePlugins(
  entries: RemotePluginEntry[],
  options?: DiscoverSkillsOptions
): Promise<ResolutionResult[]> {
  return Promise.all(
    entries.map(async (entry): Promise<ResolutionResult> => {
      try {
        const plugin = await resolveRemotePlugin(entry, options);
        return { ok: true, plugin };
      } catch (error) {
        return {
          ok: false,
          failure: { entry, error: error instanceof Error ? error : new Error(String(error)) },
        };
      }
    })
  );
}
