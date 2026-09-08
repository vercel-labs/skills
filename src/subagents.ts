import { readdir, readFile } from 'fs/promises';
import { extname, join } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { isSubpathSafe, warnSkippedSkill } from './skills.ts';
import type { SubagentDefinition } from './types.ts';

async function parseSubagentMd(filePath: string): Promise<SubagentDefinition | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    warnSkippedSkill(filePath, `failed to read file: ${(err as Error).message}`);
    return null;
  }

  let data: Record<string, unknown>;
  try {
    ({ data } = parseFrontmatter(content));
  } catch (err) {
    warnSkippedSkill(filePath, `YAML parse error: ${(err as Error).message}`);
    return null;
  }

  if (!data.name || !data.description) {
    const missing: string[] = [];
    if (!data.name) missing.push('name');
    if (!data.description) missing.push('description');
    warnSkippedSkill(filePath, `missing required frontmatter field(s): ${missing.join(', ')}`);
    return null;
  }

  if (typeof data.name !== 'string' || typeof data.description !== 'string') {
    warnSkippedSkill(
      filePath,
      `frontmatter "name" and "description" must be strings (got ${typeof data.name} and ${typeof data.description})`
    );
    return null;
  }

  return {
    name: sanitizeMetadata(data.name),
    description: sanitizeMetadata(data.description),
    path: filePath,
    rawContent: content,
  };
}

/**
 * Discover Claude Code-style subagent definitions in a source repo.
 * Unlike skills (a folder containing a SKILL.md, searched recursively),
 * subagent definitions are flat `.md` files directly under an `agents/`
 * directory — one file per subagent, not nested.
 */
export async function discoverSubagentDefinitions(
  basePath: string,
  subpath?: string
): Promise<SubagentDefinition[]> {
  if (subpath && !isSubpathSafe(basePath, subpath)) {
    return [];
  }

  const searchPath = subpath ? join(basePath, subpath) : basePath;
  const agentsDir = join(searchPath, 'agents');

  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const definitions: SubagentDefinition[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue;

    const definition = await parseSubagentMd(join(agentsDir, entry.name));
    if (!definition || seenNames.has(definition.name)) continue;

    seenNames.add(definition.name);
    definitions.push(definition);
  }

  return definitions;
}
