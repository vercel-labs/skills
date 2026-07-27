import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { agents } from './agents.ts';
import { tryBlobInstall, type BlobInstallResult, type BlobSkill } from './blob.ts';
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { sanitizeName } from './installer.ts';
import { getGitHubToken } from './skill-lock.ts';
import { discoverSkills, filterSkills, getSkillDisplayName } from './skills.ts';
import { getOwnerRepo, parseSource } from './source-parser.ts';
import type { AgentType, Skill } from './types.ts';
import {
  wellKnownProvider,
  type WellKnownSkill,
  type WellKnownFileContent,
} from './providers/wellknown.ts';

export interface UseOptions {
  skill?: string;
  agent?: string[];
  fullDepth?: boolean;
  dangerouslyAcceptOpenclawRisks?: boolean;
  help?: boolean;
}

export interface ParseUseOptionsResult {
  source: string[];
  options: UseOptions;
  errors: string[];
}

export type UseSkill =
  | {
      kind: 'blob';
      name: string;
      directoryName: string;
      rawContent: string;
      files: Array<{ path: string; contents: string }>;
    }
  | {
      kind: 'disk';
      name: string;
      directoryName: string;
      rawContent?: string;
      path: string;
    }
  | {
      kind: 'well-known';
      name: string;
      directoryName: string;
      rawContent: string;
      files: Map<string, WellKnownFileContent>;
    };

export interface MaterializedUseSkill {
  tempRoot: string;
  skillDir: string;
  skillMd: string;
  hasSupportingFiles: boolean;
}

export interface AgentProcess {
  on: (event: 'error' | 'close', listener: (...args: any[]) => void) => AgentProcess;
}

export type AgentSpawn = (
  command: string,
  args: string[],
  options: { stdio: 'inherit' }
) => AgentProcess;

interface UseAgentConfig {
  command: string;
  args: string[];
}

const BLOB_ALLOWED_OWNERS = ['vercel', 'vercel-labs', 'heygen-com'];
const EXCLUDE_FILES = new Set(['metadata.json']);
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);
const USE_AGENT_CONFIGS: Partial<Record<AgentType, UseAgentConfig>> = {
  'claude-code': { command: 'claude', args: [] },
  codex: { command: 'codex', args: [] },
};
const SUPPORTED_USE_AGENTS = Object.keys(USE_AGENT_CONFIGS) as AgentType[];

export function parseUseOptions(args: string[]): ParseUseOptionsResult {
  const source: string[] = [];
  const options: UseOptions = {};
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg === '--dangerously-accept-openclaw-risks') {
      options.dangerouslyAcceptOpenclawRisks = true;
    } else if (arg === '--skill' || arg === '-s') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        errors.push(`${arg} requires a skill name`);
      } else if (options.skill) {
        errors.push('Only one --skill value can be provided');
        i++;
      } else {
        options.skill = value;
        i++;
      }
    } else if (arg === '--agent' || arg === '-a') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      const startCount = options.agent.length;
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      if (options.agent.length === startCount) {
        errors.push(`${arg} requires an agent name`);
      }
      i--;
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown option: ${arg}`);
    } else {
      source.push(arg);
    }
  }

  errors.push(...validateUseAgentOption(options.agent));

  return { source, options, errors };
}

export function buildUsePrompt(input: {
  skillMd: string;
  supportDir?: string;
  hasSupportingFiles: boolean;
}): string {
  const sections = [
    "You are being given a Skill to execute for the user's next request.",
    'Use the following SKILL.md as your instructions:',
    `<SKILL.md>\n${input.skillMd}\n</SKILL.md>`,
  ];

  if (input.hasSupportingFiles && input.supportDir) {
    sections.push(
      `Supporting files for this skill were downloaded to:\n${input.supportDir}\n\nWhen the SKILL.md references relative paths, read them from that directory.`
    );
  }

  return sections.join('\n\n') + '\n';
}

export async function materializeUseSkill(skill: UseSkill): Promise<MaterializedUseSkill> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'skills-use-'));
  const skillDir = join(tempRoot, sanitizeName(skill.directoryName || skill.name));

  if (!isPathSafe(tempRoot, skillDir)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }

  await mkdir(skillDir, { recursive: true });

  if (skill.kind === 'blob') {
    await writeSnapshotFiles(skillDir, skill.files);
  } else if (skill.kind === 'well-known') {
    await writeMapFiles(skillDir, skill.files);
  } else {
    await copySkillDirectory(skill.path, skillDir);
  }

  const skillMd = skill.rawContent ?? (await readFile(join(skillDir, 'SKILL.md'), 'utf-8'));
  const hasSupportingFiles = await containsSupportingFiles(skillDir, skillDir);

  return { tempRoot, skillDir, skillMd, hasSupportingFiles };
}

export async function runUse(
  sourceArgs: string[],
  options: UseOptions = {},
  parseErrors: string[] = []
): Promise<void> {
  let cloneTempDir: string | null = null;

  try {
    if (options.help) {
      console.log(getUseHelp());
      return;
    }

    if (parseErrors.length > 0) {
      fail(parseErrors.join('\n'));
    }

    if (sourceArgs.length === 0) {
      fail(`Missing required argument: source\n\n${getUseHelp()}`);
    }

    if (sourceArgs.length > 1) {
      fail(`Expected one source, received ${sourceArgs.length}: ${sourceArgs.join(', ')}`);
    }

    const useAgent = options.agent?.[0] as AgentType | undefined;
    if (useAgent && !USE_AGENT_CONFIGS[useAgent]) {
      fail(formatUnsupportedAgentError(useAgent));
    }

    const source = sourceArgs[0]!;
    const parsed = parseSource(source);
    const ownerRepoRaw = getOwnerRepo(parsed);
    const sourceOwner = ownerRepoRaw?.split('/')[0]?.toLowerCase();

    if (sourceOwner === 'openclaw' && !options.dangerouslyAcceptOpenclawRisks) {
      fail(
        [
          'OpenClaw skills are unverified community submissions.',
          'Skills run with full agent permissions and could be malicious.',
          `If you understand the risks, re-run with: skills use ${source} --dangerously-accept-openclaw-risks`,
        ].join('\n')
      );
    }

    const selector = resolveSelector(parsed.skillFilter, options.skill);
    const includeInternal = selector !== undefined;

    let selectedSkill: UseSkill;

    if (parsed.type === 'well-known') {
      const skills = await wellKnownProvider.fetchAllSkills(parsed.url);
      selectedSkill = selectWellKnownSkill(skills, selector, source);
    } else {
      let skills: Skill[];
      let blobResult: BlobInstallResult | null = null;

      if (parsed.type === 'local') {
        if (!existsSync(parsed.localPath!)) {
          fail(`Local path does not exist: ${parsed.localPath}`);
        }
        skills = await discoverSkills(parsed.localPath!, parsed.subpath, {
          includeInternal,
          fullDepth: options.fullDepth,
        });
      } else if (parsed.type === 'github' && !options.fullDepth) {
        const ownerRepo = getOwnerRepo(parsed);
        const owner = ownerRepo?.split('/')[0]?.toLowerCase();
        if (ownerRepo && owner && BLOB_ALLOWED_OWNERS.includes(owner)) {
          blobResult = await tryBlobInstall(ownerRepo, {
            subpath: parsed.subpath,
            skillFilter: selector,
            ref: parsed.ref,
            getToken: getGitHubToken,
            includeInternal,
          });
        }

        if (blobResult) {
          skills = blobResult.skills;
        } else {
          cloneTempDir = await cloneRepo(parsed.url, parsed.ref);
          skills = await discoverSkills(cloneTempDir, parsed.subpath, {
            includeInternal,
            fullDepth: options.fullDepth,
          });
        }
      } else {
        cloneTempDir = await cloneRepo(parsed.url, parsed.ref);
        skills = await discoverSkills(cloneTempDir, parsed.subpath, {
          includeInternal,
          fullDepth: options.fullDepth,
        });
      }

      const selected = selectSkill(skills, selector, source);
      if (blobResult && isBlobSkill(selected)) {
        selectedSkill = {
          kind: 'blob',
          name: selected.name,
          directoryName: selected.name,
          rawContent: selected.rawContent ?? getSkillMdFromSnapshot(selected.files),
          files: selected.files,
        };
      } else {
        selectedSkill = {
          kind: 'disk',
          name: selected.name,
          directoryName: selected.name,
          rawContent: selected.rawContent,
          path: selected.path,
        };
      }
    }

    const materialized = await materializeUseSkill(selectedSkill);
    await cleanupClone(cloneTempDir);
    cloneTempDir = null;

    const prompt = buildUsePrompt({
      skillMd: materialized.skillMd,
      supportDir: materialized.skillDir,
      hasSupportingFiles: materialized.hasSupportingFiles,
    });

    if (useAgent) {
      const exitCode = await launchAgentInteractively(useAgent, prompt);
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
      return;
    }

    process.stdout.write(prompt);
  } catch (error) {
    await cleanupClone(cloneTempDir);
    if (error instanceof GitCloneError) {
      fail(error.message);
    }
    if (error instanceof UseCommandError) {
      fail(error.message);
    }
    fail(error instanceof Error ? error.message : 'Unknown error');
  }
}

export async function launchAgentInteractively(
  agent: AgentType,
  prompt: string,
  spawnImpl: AgentSpawn = spawnAgent
): Promise<number> {
  const config = USE_AGENT_CONFIGS[agent];
  if (!config) {
    throw new UseCommandError(formatUnsupportedAgentError(agent));
  }

  return new Promise((resolve, reject) => {
    const child = spawnImpl(config.command, [...config.args, prompt], {
      stdio: 'inherit',
    });
    let settled = false;

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (error.code === 'ENOENT') {
        reject(
          new UseCommandError(
            `Could not launch ${agents[agent].displayName}: command not found: ${config.command}`
          )
        );
        return;
      }
      reject(error);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve(code ?? 1);
    });
  });
}

function spawnAgent(command: string, args: string[]): AgentProcess {
  return spawn(command, args, { stdio: 'inherit' }) as AgentProcess;
}

function getUseHelp(): string {
  return `Usage: skills use <source>[@<skill>] [options]

Generate a prompt for using one skill without installing it.

Options:
  -s, --skill <skill>   Select the skill to use
  -a, --agent <agent>   Start one supported agent interactively (${SUPPORTED_USE_AGENTS.join(', ')})
  --full-depth          Search nested directories like skills add --full-depth
  --dangerously-accept-openclaw-risks
                         Allow unverified OpenClaw community skills
  -h, --help            Show this help message

Examples:
  skills use vercel-labs/agent-skills@web-design-guidelines | claude
  skills use vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
  skills use vercel-labs/agent-skills@web-design-guidelines --agent codex`;
}

function resolveSelector(sourceSelector?: string, optionSelector?: string): string | undefined {
  if (sourceSelector && optionSelector) {
    if (sourceSelector.toLowerCase() !== optionSelector.toLowerCase()) {
      throw new UseCommandError(
        `Conflicting skill selectors: source selects "${sourceSelector}" but --skill selects "${optionSelector}". Provide one selector.`
      );
    }
    return optionSelector;
  }

  return optionSelector ?? sourceSelector;
}

function selectSkill(skills: Skill[], selector: string | undefined, source: string): Skill {
  if (skills.length === 0) {
    throw new UseCommandError(
      'No valid skills found. Skills require a SKILL.md with name and description.'
    );
  }

  if (!selector) {
    if (skills.length === 1) return skills[0]!;
    throw new UseCommandError(formatMultipleSkillsError(source, skills.map(getSkillDisplayName)));
  }

  const selected = filterSkills(skills, [selector]);
  if (selected.length === 0) {
    throw new UseCommandError(formatNoMatchError(selector, skills.map(getSkillDisplayName)));
  }
  if (selected.length > 1) {
    throw new UseCommandError(`Skill selector "${selector}" matched multiple skills.`);
  }

  return selected[0]!;
}

function selectWellKnownSkill(
  skills: WellKnownSkill[],
  selector: string | undefined,
  source: string
): UseSkill {
  if (skills.length === 0) {
    throw new UseCommandError(
      'No skills found at this URL. Make sure the server has a /.well-known/agent-skills/index.json or /.well-known/skills/index.json file.'
    );
  }

  let selected: WellKnownSkill[];
  if (!selector) {
    if (skills.length !== 1) {
      throw new UseCommandError(
        formatMultipleSkillsError(
          source,
          skills.map((s) => s.installName)
        )
      );
    }
    selected = skills;
  } else {
    selected = skills.filter(
      (skill) =>
        skill.installName.toLowerCase() === selector.toLowerCase() ||
        skill.name.toLowerCase() === selector.toLowerCase()
    );
    if (selected.length === 0) {
      throw new UseCommandError(
        formatNoMatchError(
          selector,
          skills.map((s) => s.installName)
        )
      );
    }
    if (selected.length > 1) {
      throw new UseCommandError(`Skill selector "${selector}" matched multiple skills.`);
    }
  }

  const skill = selected[0]!;
  return {
    kind: 'well-known',
    name: skill.name,
    directoryName: skill.installName,
    rawContent: skill.content,
    files: skill.files,
  };
}

function formatMultipleSkillsError(source: string, names: string[]): string {
  return [
    'This source contains multiple skills. Specify exactly one skill:',
    ...names.map((name) => `  - ${name}`),
    '',
    `Examples:\n  skills use ${source}@${names[0] ?? '<skill>'}\n  skills use ${source} --skill ${names[0] ?? '<skill>'}`,
  ].join('\n');
}

function formatNoMatchError(selector: string, names: string[]): string {
  return [
    `No matching skill found for: ${selector}`,
    'Available skills:',
    ...names.map((name) => `  - ${name}`),
  ].join('\n');
}

function validateUseAgentOption(agentValues: string[] | undefined): string[] {
  if (!agentValues || agentValues.length === 0) return [];

  const errors: string[] = [];
  const validAgents = Object.keys(agents);
  const invalidAgents = agentValues.filter(
    (agent) => agent !== '*' && !validAgents.includes(agent)
  );

  if (agentValues.includes('*')) {
    errors.push("skills use --agent does not support '*'; specify exactly one agent.");
  }
  if (agentValues.length > 1) {
    errors.push('skills use --agent accepts exactly one agent.');
  }
  if (invalidAgents.length > 0) {
    errors.push(
      `Invalid agents: ${invalidAgents.join(', ')}\nValid agents: ${validAgents.join(', ')}`
    );
  }

  return errors;
}

function formatUnsupportedAgentError(agent: AgentType): string {
  return [
    `Running ${agents[agent].displayName} is not supported yet.`,
    `Supported agents for skills use --agent: ${SUPPORTED_USE_AGENTS.join(', ')}`,
  ].join('\n');
}

async function writeSnapshotFiles(
  targetDir: string,
  files: Array<{ path: string; contents: string }>
): Promise<void> {
  for (const file of files) {
    await writeSafeFile(targetDir, file.path, file.contents);
  }
}

async function writeMapFiles(
  targetDir: string,
  files: Map<string, WellKnownFileContent>
): Promise<void> {
  for (const [path, contents] of files) {
    await writeSafeFile(targetDir, path, contents);
  }
}

async function writeSafeFile(
  targetDir: string,
  filePath: string,
  contents: WellKnownFileContent
): Promise<void> {
  const fullPath = join(targetDir, filePath);
  if (!isPathSafe(targetDir, fullPath)) return;

  await mkdir(dirname(fullPath), { recursive: true });
  if (typeof contents === 'string') {
    await writeFile(fullPath, contents, 'utf-8');
  } else {
    await writeFile(fullPath, contents);
  }
}

async function copySkillDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (!isPathSafe(dest, destPath)) return;

        if (entry.isDirectory()) {
          await copySkillDirectory(srcPath, destPath);
          return;
        }

        try {
          await cp(srcPath, destPath, { dereference: true, recursive: true });
        } catch (err) {
          if (
            err instanceof Error &&
            'code' in err &&
            (err as NodeJS.ErrnoException).code === 'ENOENT' &&
            entry.isSymbolicLink()
          ) {
            console.error(`Skipping broken symlink: ${srcPath}`);
            return;
          }
          throw err;
        }
      })
  );
}

async function containsSupportingFiles(rootDir: string, currentDir: string): Promise<boolean> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, entryPath).split(sep).join('/');
    if (entry.isDirectory()) {
      if (await containsSupportingFiles(rootDir, entryPath)) return true;
    } else if (relPath.toLowerCase() !== 'skill.md') {
      return true;
    }
  }

  return false;
}

function isBlobSkill(skill: Skill): skill is BlobSkill {
  return Array.isArray((skill as BlobSkill).files);
}

function getSkillMdFromSnapshot(files: Array<{ path: string; contents: string }>): string {
  const skillMd = files.find((file) => file.path.toLowerCase() === 'skill.md');
  return skillMd?.contents ?? '';
}

function isExcluded(name: string, isDirectory: boolean): boolean {
  return EXCLUDE_FILES.has(name) || (isDirectory && EXCLUDE_DIRS.has(name));
}

function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

async function cleanupClone(tempDir: string | null): Promise<void> {
  if (tempDir) {
    await cleanupTempDir(tempDir).catch(() => {});
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

class UseCommandError extends Error {}
