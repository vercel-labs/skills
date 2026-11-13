import { realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { discoverSkills } from './skills.ts';
import { sanitizeName } from './installer.ts';
import type { Skill } from './types.ts';

export function skillDependencies(skill: Pick<Skill, 'name' | 'metadata'>): string[] {
  const value = skill.metadata?.dependencies;
  if (value === undefined) return [];
  if (typeof value !== 'string') {
    throw new Error(`${skill.name}: metadata.dependencies must be a string`);
  }
  const names = value.trim() ? value.trim().split(/\s+/) : [];
  for (const name of names) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      throw new Error(`${skill.name}: invalid dependency name "${name}"`);
    }
  }
  return [...new Set(names)];
}

export function rejectUnsupportedDependencies(
  skills: Pick<Skill, 'name' | 'metadata'>[],
  source: string
): void {
  for (const skill of skills) {
    if (skillDependencies(skill).length) {
      throw new Error(
        `${skill.name}: metadata.dependencies is not supported for ${source}; use a Git checkout or local source directory`
      );
    }
  }
}

/** Resolve only the selected closure, keeping dependency names exact and destinations unique. */
export function resolveDependencyGraph(roots: Skill[], candidates: Skill[]): Skill[] {
  const byName = new Map<string, Map<string, Skill>>();
  for (const skill of candidates) {
    if (!byName.has(skill.name)) byName.set(skill.name, new Map());
    byName.get(skill.name)!.set(resolve(skill.path), skill);
  }
  const done = new Set<string>();
  const visiting = new Set<string>();
  const destinations = new Map<string, string>();
  const result: Skill[] = [];
  function visit(skill: Skill, chain: string[]) {
    const path = resolve(skill.path);
    const trace = [...chain, skill.name];
    const fail = (message: string): never => {
      throw new Error(`${trace.join(' -> ')}: ${message}`);
    };
    if ((byName.get(skill.name)?.size ?? 0) > 1) fail('ambiguous skill name');
    if (visiting.has(path)) fail('dependency cycle');
    if (done.has(path)) return;
    const destination = sanitizeName(skill.name);
    if (destinations.has(destination) && destinations.get(destination) !== path) {
      fail(`installation destination collision: ${destination}`);
    }
    destinations.set(destination, path);
    visiting.add(path);
    let names: string[];
    try {
      names = skillDependencies(skill);
    } catch (error) {
      fail((error as Error).message);
    }
    for (const name of names!) {
      const matches = [...(byName.get(name)?.values() ?? [])];
      if (matches.length !== 1)
        fail(`${name}: ${matches.length ? 'ambiguous dependency' : 'missing dependency'}`);
      visit(matches[0]!, trace);
    }
    visiting.delete(path);
    done.add(path);
    result.push(skill);
  }
  for (const root of roots) visit(root, []);
  return result;
}

export async function resolveSameSourceDependencies(
  roots: Skill[],
  source: string
): Promise<Skill[]> {
  if (!roots.some((skill) => skillDependencies(skill).length > 0)) return roots;
  const candidates = await discoverSkills(source, undefined, {
    includeInternal: true,
    includeDuplicateNames: true,
    fullDepth: true,
  });
  const selected = resolveDependencyGraph(roots, candidates);
  const base = await realpath(source);
  for (const skill of selected) {
    for (const path of [skill.path, join(skill.path, 'SKILL.md')]) {
      const rel = relative(base, await realpath(path));
      if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) {
        throw new Error(`${skill.name}: dependency path escapes source directory`);
      }
    }
  }
  return selected;
}
