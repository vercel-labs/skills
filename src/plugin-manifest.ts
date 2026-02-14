import { readFile } from 'fs/promises';
import { join, dirname, resolve, normalize, sep } from 'path';

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
  source?: string | { source: string; repo?: string };
  skills?: string[];
  /** Optional name for grouping skills (e.g., "document-skills") */
  name?: string;
}

interface MarketplaceManifest {
  metadata?: { pluginRoot?: string };
  plugins?: PluginManifestEntry[];
}

interface PluginManifest {
  skills?: string[];
  name?: string;
}

/**
 * Extract skill search directories from plugin manifests.
 * Handles both marketplace.json (multi-plugin) and plugin.json (single plugin).
 * Only resolves local paths - remote sources are skipped.
 *
 * Returns directories that CONTAIN skills (to be searched for child SKILL.md files).
 * For explicit skill paths in manifests, adds the parent directory so the
 * existing discovery loop finds them.
 */
export async function getPluginSkillPaths(basePath: string): Promise<string[]> {
  const searchDirs: string[] = [];

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
        // Skip remote sources (object with source/repo) - only handle local string paths
        if (typeof plugin.source !== 'string' && plugin.source !== undefined) continue;

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

  return searchDirs;
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
