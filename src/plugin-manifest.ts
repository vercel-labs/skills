import { readFile } from 'fs/promises';
import { join, dirname, resolve, normalize, sep } from 'path';
import type { PluginManifestResult, RemotePluginEntry, ResolvableRemoteSource } from './types.ts';

/**
 * Check if a path is contained within a base directory.
 * Prevents path traversal attacks via `..` segments or absolute paths.
 */
function isContainedIn(targetPath: string, basePath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Validate that a relative path follows Claude Code conventions.
 * Paths must start with './' per the plugin manifest spec.
 */
function isValidRelativePath(path: string): boolean {
  return path.startsWith('./');
}

/**
 * Plugin manifest types
 */
interface PluginManifestEntry {
  /** Local relative path (string) or remote source object (untrusted JSON) */
  source?: string | Record<string, unknown>;
  skills?: string[];
  /** Optional name for grouping skills (e.g., "document-skills") */
  name?: string;
  /** Optional description (shown for remote plugins in selection lists) */
  description?: string;
}

interface MarketplaceManifest {
  metadata?: { pluginRoot?: string };
  plugins?: PluginManifestEntry[];
}

interface PluginManifest {
  skills?: string[];
  name?: string;
}

/** Full 40-character commit SHA, per the Claude Code marketplace spec */
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** GitHub repository in owner/repo format */
const GITHUB_REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

/**
 * Validate a remote source object from untrusted manifest JSON.
 * Returns the narrowed source for git-based types, 'unsupported' for recognized
 * but unsupported types (npm), and null for unknown types or invalid fields.
 */
function validateRemoteSource(
  source: Record<string, unknown>
): ResolvableRemoteSource | 'unsupported' | null {
  const ref = typeof source.ref === 'string' ? source.ref : undefined;
  const sha = typeof source.sha === 'string' ? source.sha : undefined;

  // Reject entries where ref/sha are present but invalid
  if (source.ref !== undefined && ref === undefined) return null;
  if (source.sha !== undefined && (sha === undefined || !FULL_SHA_PATTERN.test(sha))) return null;

  switch (source.source) {
    case 'github':
      if (typeof source.repo !== 'string' || !GITHUB_REPO_PATTERN.test(source.repo)) return null;
      return { source: 'github', repo: source.repo, ref, sha };
    case 'url':
      if (typeof source.url !== 'string' || source.url.length === 0) return null;
      return { source: 'url', url: source.url, ref, sha };
    case 'git-subdir': {
      if (typeof source.url !== 'string' || source.url.length === 0) return null;
      if (typeof source.path !== 'string' || source.path.length === 0) return null;
      // Reject absolute paths and traversal segments. Containment is re-checked
      // against the cloned repo at resolution time.
      if (source.path.startsWith('/') || source.path.split('/').includes('..')) return null;
      return { source: 'git-subdir', url: source.url, path: source.path, ref, sha };
    }
    case 'npm':
      return 'unsupported';
    default:
      return null;
  }
}

/**
 * Parse and validate a manifest entry whose source is a remote source object.
 * Returns the entry for resolvable git-based sources, 'unsupported' for recognized
 * but unsupported source types, and null for malformed entries.
 */
function parseRemotePlugin(plugin: PluginManifestEntry): RemotePluginEntry | 'unsupported' | null {
  // Remote plugins need a name: it's what users select and what the lock records
  if (!plugin.name || typeof plugin.name !== 'string') return null;

  const source = plugin.source;
  if (source === undefined || typeof source === 'string') return null;

  const validated = validateRemoteSource(source);
  if (validated === null) return null;
  if (validated === 'unsupported') return 'unsupported';

  // Skill paths within the remote repo follow the same './' convention as local ones
  const skills = Array.isArray(plugin.skills)
    ? plugin.skills.filter((s) => typeof s === 'string' && isValidRelativePath(s))
    : undefined;

  return {
    name: plugin.name,
    description: typeof plugin.description === 'string' ? plugin.description : undefined,
    source: validated,
    skills: skills && skills.length > 0 ? skills : undefined,
  };
}

/**
 * Parse plugin manifests into local skill search directories and remote plugin entries.
 * Handles both marketplace.json (multi-plugin catalog) and plugin.json (single plugin).
 *
 * Local string sources are returned as directories that CONTAIN skills (to be searched
 * for child SKILL.md files). Remote source objects (github / url / git-subdir) are
 * returned as entries to be resolved lazily; npm sources are reported as unsupported.
 */
export async function parsePluginManifests(basePath: string): Promise<PluginManifestResult> {
  const searchDirs: string[] = [];
  const remotePlugins: RemotePluginEntry[] = [];
  const unsupportedPlugins: string[] = [];
  const duplicatePluginNames: string[] = [];
  // Plugin names share one namespace in a marketplace. Claude Code's validator
  // rejects duplicates; we keep the first entry and report the collision.
  const seenPluginNames = new Set<string>();

  // Helper: add skill paths for a plugin at a given base path
  // Only adds paths that are contained within basePath (security: prevents traversal)
  const addPluginSkillPaths = (pluginBase: string, skills?: string[]) => {
    // Validate pluginBase itself is contained
    if (!isContainedIn(pluginBase, basePath)) return;

    if (skills && skills.length > 0) {
      // Plugin explicitly declares skill paths - add parent dirs so existing loop finds them
      for (const skillPath of skills) {
        // Validate skill path starts with './' (per Claude Code convention)
        if (!isValidRelativePath(skillPath)) continue;

        const skillDir = dirname(join(pluginBase, skillPath));
        if (isContainedIn(skillDir, basePath)) {
          searchDirs.push(skillDir);
        }
      }
    }
    // Always add conventional skills/ directory for discovery
    // (deduplication happens via seenNames in discoverSkills)
    searchDirs.push(join(pluginBase, 'skills'));
  };

  // Try marketplace.json (multi-plugin catalog)
  try {
    const content = await readFile(join(basePath, '.claude-plugin/marketplace.json'), 'utf-8');
    const manifest: MarketplaceManifest = JSON.parse(content);
    const pluginRoot = manifest.metadata?.pluginRoot;

    // Validate pluginRoot starts with './' if provided (per Claude Code convention)
    const validPluginRoot = pluginRoot === undefined || isValidRelativePath(pluginRoot);

    if (validPluginRoot) {
      for (const plugin of manifest.plugins ?? []) {
        // A second entry under a name already seen is dropped (first wins),
        // and the collision is recorded for the caller to warn about.
        if (typeof plugin.name === 'string') {
          if (seenPluginNames.has(plugin.name)) {
            duplicatePluginNames.push(plugin.name);
            continue;
          }
          seenPluginNames.add(plugin.name);
        }

        // Remote sources (object form) are collected for lazy resolution;
        // local string paths are searched on disk below.
        if (typeof plugin.source !== 'string' && plugin.source !== undefined) {
          const remote = parseRemotePlugin(plugin);
          if (remote === 'unsupported') {
            if (plugin.name) unsupportedPlugins.push(plugin.name);
          } else if (remote) {
            remotePlugins.push(remote);
          }
          continue;
        }

        // Validate source starts with './' if provided (per Claude Code convention)
        if (plugin.source !== undefined && !isValidRelativePath(plugin.source)) continue;

        const pluginBase = join(basePath, pluginRoot ?? '', plugin.source ?? '');
        addPluginSkillPaths(pluginBase, plugin.skills);
      }
    }
  } catch {
    // File doesn't exist or invalid JSON
  }

  // Try plugin.json (single plugin at root)
  try {
    const content = await readFile(join(basePath, '.claude-plugin/plugin.json'), 'utf-8');
    const manifest: PluginManifest = JSON.parse(content);
    addPluginSkillPaths(basePath, manifest.skills);
  } catch {
    // File doesn't exist or invalid JSON
  }

  return { localSearchDirs: searchDirs, remotePlugins, unsupportedPlugins, duplicatePluginNames };
}

/**
 * Extract local skill search directories from plugin manifests.
 * Convenience wrapper for callers that only need disk-based discovery
 * (remote plugins are resolved separately, after selection).
 *
 * Returns directories that CONTAIN skills (to be searched for child SKILL.md files).
 */
export async function getPluginSkillPaths(basePath: string): Promise<string[]> {
  return (await parsePluginManifests(basePath)).localSearchDirs;
}

/**
 * Get a map of skill directory paths to plugin names from plugin manifests.
 * This allows grouping skills by their parent plugin.
 *
 * Returns Map<AbsolutePath, PluginName>
 */
export async function getPluginGroupings(basePath: string): Promise<Map<string, string>> {
  const groupings = new Map<string, string>();

  // Try marketplace.json (multi-plugin catalog)
  try {
    const content = await readFile(join(basePath, '.claude-plugin/marketplace.json'), 'utf-8');
    const manifest: MarketplaceManifest = JSON.parse(content);
    const pluginRoot = manifest.metadata?.pluginRoot;

    // Validate pluginRoot starts with './' if provided (per Claude Code convention)
    const validPluginRoot = pluginRoot === undefined || isValidRelativePath(pluginRoot);

    if (validPluginRoot) {
      for (const plugin of manifest.plugins ?? []) {
        if (!plugin.name) continue;

        // Skip remote sources (object with source/repo) - only handle local string paths
        if (typeof plugin.source !== 'string' && plugin.source !== undefined) continue;

        // Validate source starts with './' if provided (per Claude Code convention)
        if (plugin.source !== undefined && !isValidRelativePath(plugin.source)) continue;

        const pluginBase = join(basePath, pluginRoot ?? '', plugin.source ?? '');

        // Validate pluginBase itself is contained
        if (!isContainedIn(pluginBase, basePath)) continue;

        if (plugin.skills && plugin.skills.length > 0) {
          for (const skillPath of plugin.skills) {
            // Validate skill path starts with './' (per Claude Code convention)
            if (!isValidRelativePath(skillPath)) continue;

            const skillDir = join(pluginBase, skillPath);
            if (isContainedIn(skillDir, basePath)) {
              // Store absolute path as key for reliable matching
              groupings.set(resolve(skillDir), plugin.name);
            }
          }
        }
      }
    }
  } catch {
    // File doesn't exist or invalid JSON
  }

  // Try plugin.json (single plugin at root)
  try {
    const content = await readFile(join(basePath, '.claude-plugin/plugin.json'), 'utf-8');
    const manifest: PluginManifest = JSON.parse(content);
    if (manifest.name && manifest.skills && manifest.skills.length > 0) {
      for (const skillPath of manifest.skills) {
        if (!isValidRelativePath(skillPath)) continue;
        const skillDir = join(basePath, skillPath);
        if (isContainedIn(skillDir, basePath)) {
          groupings.set(resolve(skillDir), manifest.name);
        }
      }
    }
  } catch {
    // File doesn't exist or invalid JSON
  }

  return groupings;
}
