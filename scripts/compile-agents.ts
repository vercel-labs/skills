#!/usr/bin/env node

/**
 * compile-agents.ts
 *
 * Reads agents/*.yaml, validates schema, resolves conventions,
 * and generates:
 *   - src/core/__generated__/agent-type.ts  (AgentType union)
 *   - src/services/registry/__generated__/agents.ts  (agents Record)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';

const ROOT = join(import.meta.dirname, '..');
const AGENTS_DIR = join(ROOT, 'agents');
const AGENT_TYPE_OUT = join(ROOT, 'src/core/__generated__/agent-type.ts');
const AGENTS_OUT = join(ROOT, 'src/services/registry/__generated__/agents.ts');

// ============================================
// Types
// ============================================

interface DetectRule {
  homeDir?: string;
  xdgConfig?: string;
  cwdDir?: string;
  absolutePath?: string;
  envVar?: string;
  envResolved?: string;
  envResolvedPath?: { var: string; subpath: string };
}

interface AgentYaml {
  name: string;
  displayName: string;
  rootDir?: string;
  localRoot?: string;
  globalRoot?: string | { firstExists: string[] };
  detect?: DetectRule[];
  showInUniversalList?: boolean;
}

interface ResolvedAgent {
  name: string;
  displayName: string;
  localRoot: string;
  globalRoot: string | { firstExists: string[] };
  detect: DetectRule[];
  showInUniversalList?: boolean;
}

// ============================================
// YAML Loading & Validation
// ============================================

function loadAgentYamls(): AgentYaml[] {
  const files = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort();

  const agents: AgentYaml[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(AGENTS_DIR, file), 'utf-8');
    const data = parseYaml(content) as AgentYaml;
    const expectedName = basename(file, '.yaml');

    if (!data.name) {
      errors.push(`${file}: missing required field "name"`);
      continue;
    }
    if (!data.displayName) {
      errors.push(`${file}: missing required field "displayName"`);
      continue;
    }
    if (data.name !== expectedName) {
      errors.push(`${file}: name "${data.name}" does not match filename "${expectedName}"`);
      continue;
    }
    if (!data.rootDir && data.localRoot === undefined) {
      errors.push(`${file}: must specify either "rootDir" or "localRoot"`);
      continue;
    }

    agents.push(data);
  }

  if (errors.length > 0) {
    console.error('Validation errors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  return agents;
}

function validateAgents(agents: AgentYaml[]): void {
  const errors: string[] = [];

  // Check duplicate names
  const names = new Map<string, string[]>();
  for (const a of agents) {
    const key = a.name;
    if (!names.has(key)) names.set(key, []);
    names.get(key)!.push(a.name);
  }
  for (const [name, entries] of names) {
    if (entries.length > 1) {
      errors.push(`Duplicate agent name: "${name}"`);
    }
  }

  // Check duplicate displayNames (case-insensitive)
  const displayNames = new Map<string, string[]>();
  for (const a of agents) {
    const key = a.displayName.toLowerCase();
    if (!displayNames.has(key)) displayNames.set(key, []);
    displayNames.get(key)!.push(a.name);
  }
  for (const [displayName, agentNames] of displayNames) {
    if (agentNames.length > 1) {
      errors.push(
        `Duplicate displayName "${displayName}" found in agents: ${agentNames.join(', ')}`
      );
    }
  }

  if (errors.length > 0) {
    console.error('Validation errors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

// ============================================
// Convention Resolution
// ============================================

function resolveAgent(yaml: AgentYaml): ResolvedAgent {
  // localRoot: explicit or from rootDir
  const localRoot = yaml.localRoot !== undefined ? yaml.localRoot : yaml.rootDir!;

  // globalRoot: explicit or ~/rootDir
  const globalRoot = yaml.globalRoot !== undefined ? yaml.globalRoot : `~/${yaml.rootDir!}`;

  // detect: explicit or inferred from rootDir as homeDir
  const detect = yaml.detect ?? [{ homeDir: yaml.rootDir! }];

  return {
    name: yaml.name,
    displayName: yaml.displayName,
    localRoot,
    globalRoot,
    detect,
    ...(yaml.showInUniversalList !== undefined
      ? { showInUniversalList: yaml.showInUniversalList }
      : {}),
  };
}

// ============================================
// Determine which module-level variables are needed
// ============================================

interface NeededVars {
  home: boolean;
  configHome: boolean;
  codexHome: boolean;
  claudeHome: boolean;
}

function determineNeededVars(agents: ResolvedAgent[]): NeededVars {
  const needed: NeededVars = { home: true, configHome: false, codexHome: false, claudeHome: false };

  for (const a of agents) {
    // Check globalRoot
    if (typeof a.globalRoot === 'string') {
      if (a.globalRoot.includes('${XDG_CONFIG_HOME}')) needed.configHome = true;
      if (a.globalRoot.includes('${CODEX_HOME')) needed.codexHome = true;
      if (a.globalRoot.includes('${CLAUDE_CONFIG_DIR')) needed.claudeHome = true;
    }

    // Check detect rules
    for (const rule of a.detect) {
      if (rule.xdgConfig) needed.configHome = true;
      if (rule.envResolved === 'codexHome') needed.codexHome = true;
      if (rule.envResolved === 'claudeHome') needed.claudeHome = true;
      if (rule.envResolvedPath?.var === 'codexHome') needed.codexHome = true;
      if (rule.envResolvedPath?.var === 'claudeHome') needed.claudeHome = true;
    }
  }

  return needed;
}

// ============================================
// Code Generation — globalRoot expression
// ============================================

function globalRootExpr(globalRoot: string | { firstExists: string[] }): string {
  if (typeof globalRoot === 'object' && 'firstExists' in globalRoot) {
    // firstExists: generate ternary chain
    const paths = globalRoot.firstExists;
    const resolvedPaths = paths.map((p) => resolvePath(p));

    // Build: existsSync(p1) ? p1 : existsSync(p2) ? p2 : p3
    let expr = resolvedPaths[resolvedPaths.length - 1];
    for (let i = resolvedPaths.length - 2; i >= 0; i--) {
      expr = `existsSync(${resolvedPaths[i]}) ? ${resolvedPaths[i]} : ${expr}`;
    }
    return expr;
  }

  return resolvePath(globalRoot);
}

function resolvePath(p: string): string {
  // Handle ${ENV_VAR:fallback} patterns
  const envMatch = p.match(/^\$\{(\w+):(.+)\}$/);
  if (envMatch) {
    const [, envVar, fallback] = envMatch;
    // These are module-level vars like codexHome, claudeHome
    if (envVar === 'CODEX_HOME') return 'codexHome';
    if (envVar === 'CLAUDE_CONFIG_DIR') return 'claudeHome';
    // fallback — shouldn't hit this for known vars
    return `(process.env.${envVar}?.trim() || ${resolvePath(fallback)})`;
  }

  // Handle ${XDG_CONFIG_HOME}/rest
  const xdgMatch = p.match(/^\$\{XDG_CONFIG_HOME\}\/(.+)$/);
  if (xdgMatch) {
    return `join(configHome, '${xdgMatch[1]}')`;
  }

  // Handle ~/rest
  if (p.startsWith('~/')) {
    const rest = p.slice(2);
    return `join(home, '${rest}')`;
  }

  // Bare string
  return `'${p}'`;
}

function globalDirExpr(globalRoot: string | { firstExists: string[] }, subdir: string): string {
  if (typeof globalRoot === 'object' && 'firstExists' in globalRoot) {
    const paths = globalRoot.firstExists;
    const resolvedPaths = paths.map((p) => {
      const base = resolvePath(p);
      return `join(${base}, '${subdir}')`;
    });

    let expr = resolvedPaths[resolvedPaths.length - 1];
    for (let i = resolvedPaths.length - 2; i >= 0; i--) {
      const checkPath = resolvePath(paths[i]);
      expr = `existsSync(${checkPath})\n        ? ${resolvedPaths[i]}\n        : ${expr}`;
    }
    return expr;
  }

  const base = globalRootExpr(globalRoot);
  // If it's already a join() or a variable, wrap it
  if (base.startsWith('join(') || base.startsWith('(')) {
    return `join(${base}, '${subdir}')`;
  }
  // If it's a variable name (no quotes)
  if (!base.startsWith("'")) {
    return `join(${base}, '${subdir}')`;
  }
  // It's a string literal like 'something'
  const inner = base.slice(1, -1);
  return `join(home, '${inner}/${subdir}')`;
}

// ============================================
// Code Generation — detectInstalled
// ============================================

function generateDetectBody(rules: DetectRule[]): string {
  const conditions = rules.map((rule) => {
    if (rule.homeDir) return `existsSync(join(home, '${rule.homeDir}'))`;
    if (rule.xdgConfig) return `existsSync(join(configHome, '${rule.xdgConfig}'))`;
    if (rule.cwdDir) return `existsSync(join(process.cwd(), '${rule.cwdDir}'))`;
    if (rule.absolutePath) return `existsSync('${rule.absolutePath}')`;
    if (rule.envVar)
      return `(process.env.${rule.envVar} ? existsSync(process.env.${rule.envVar}) : false)`;
    if (rule.envResolved) return `existsSync(${rule.envResolved})`;
    if (rule.envResolvedPath) {
      return `existsSync(join(${rule.envResolvedPath.var}, '${rule.envResolvedPath.subpath}'))`;
    }
    throw new Error(`Unknown detect rule: ${JSON.stringify(rule)}`);
  });

  if (conditions.length === 1) {
    return `return ${conditions[0]};`;
  }

  return `return (\n        ${conditions.join(' ||\n        ')}\n      );`;
}

// ============================================
// Code Generation — local dirs
// ============================================

function localDir(localRoot: string, subdir: string): string {
  if (localRoot === '') return subdir;
  return `${localRoot}/${subdir}`;
}

// ============================================
// Main Generation
// ============================================

function generateAgentTypeFile(agents: ResolvedAgent[]): string {
  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));
  const members = sorted.map((a) => `  | '${a.name}'`).join('\n');

  return `// AUTO-GENERATED by scripts/compile-agents.ts — DO NOT EDIT
// Source: agents/*.yaml

export type AgentType =
${members};
`;
}

function generateAgentsFile(agents: ResolvedAgent[]): string {
  const needed = determineNeededVars(agents);

  const imports = [
    "import { homedir } from 'os';",
    "import { join } from 'path';",
    "import { existsSync } from 'fs';",
  ];
  if (needed.configHome) {
    imports.push("import { xdgConfig } from 'xdg-basedir';");
  }
  imports.push("import type { AgentConfig, AgentType } from '../../../core/types.ts';");

  const vars = [`const home = homedir();`];
  if (needed.configHome) {
    vars.push(
      `// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.`
    );
    vars.push(`const configHome = xdgConfig ?? join(home, '.config');`);
  }
  if (needed.codexHome) {
    vars.push(`const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');`);
  }
  if (needed.claudeHome) {
    vars.push(`const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');`);
  }

  const entries: string[] = [];

  for (const a of agents) {
    const skillsDir = localDir(a.localRoot, 'skills');
    const agentsDir = localDir(a.localRoot, 'agents');
    const promptsDir = localDir(a.localRoot, 'prompts');

    const globalSkillsDir = globalDirExpr(a.globalRoot, 'skills');
    const globalAgentsDir = globalDirExpr(a.globalRoot, 'agents');
    const globalPromptsDir = globalDirExpr(a.globalRoot, 'prompts');

    const detectBody = generateDetectBody(a.detect);

    const showFlag =
      a.showInUniversalList !== undefined
        ? `\n    showInUniversalList: ${a.showInUniversalList},`
        : '';

    entries.push(`  '${a.name}': {
    name: '${a.name}',
    displayName: '${a.displayName}',
    skillsDir: '${skillsDir}',
    globalSkillsDir: ${globalSkillsDir},
    agentsDir: '${agentsDir}',
    globalAgentsDir: ${globalAgentsDir},
    promptsDir: '${promptsDir}',
    globalPromptsDir: ${globalPromptsDir},${showFlag}
    detectInstalled: async () => {
      ${detectBody}
    },
  }`);
  }

  return `// AUTO-GENERATED by scripts/compile-agents.ts — DO NOT EDIT
// Source: agents/*.yaml

${imports.join('\n')}

${vars.join('\n')}

export const agents: Record<AgentType, AgentConfig> = {
${entries.join(',\n')},
};
`;
}

// ============================================
// Main
// ============================================

function main() {
  console.log('Compiling agents from YAML...\n');

  const yamls = loadAgentYamls();
  validateAgents(yamls);

  const resolved = yamls.map(resolveAgent);

  // Generate files
  const agentTypeContent = generateAgentTypeFile(resolved);
  const agentsContent = generateAgentsFile(resolved);

  // Ensure output directories exist
  mkdirSync(join(ROOT, 'src/core/__generated__'), { recursive: true });
  mkdirSync(join(ROOT, 'src/services/registry/__generated__'), { recursive: true });

  writeFileSync(AGENT_TYPE_OUT, agentTypeContent);
  writeFileSync(AGENTS_OUT, agentsContent);

  console.log(`Generated ${AGENT_TYPE_OUT}`);
  console.log(`Generated ${AGENTS_OUT}`);
  console.log(`\n${resolved.length} agents compiled successfully.`);
}

main();
