import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'path';
import { tmpdir } from 'os';
import { agents } from './agents.ts';
import { tryBlobInstall, type BlobInstallResult, type BlobSkill } from './blob.ts';
import type { Diagnostic } from 'nostics';
import { diagnostics, formatError, isDiagnostic } from './diagnostics.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { copyDirectory, sanitizeName } from './installer.ts';
import { getGitHubToken } from './skill-lock.ts';
import { discoverSkills, filterSkills, getSkillDisplayName } from './skills.ts';
import { getOwnerRepo, parseSource } from './source-parser.ts';
import type { AgentType, Skill } from './types.ts';
import { downloadSource } from './download-source.ts';
import {
  wellKnownProvider,
  type WellKnownSkill,
  type WellKnownFileContent,
} from './providers/wellknown.ts';

export interface UseOptions {
  skill?: string;
  agent?: string[];
  fullDepth?: boolean;
  help?: boolean;
}

export interface ParseUseOptionsResult {
  source: string[];
  options: UseOptions;
  errors: Diagnostic[];
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

const BLOB_ALLOWED_OWNERS = ['vercel', 'vercel-labs', 'heygen-com', 'remotion-dev'];
const USE_AGENT_CONFIGS: Partial<Record<AgentType, UseAgentConfig>> = {
  'claude-code': { command: 'claude', args: [] },
  codex: { command: 'codex', args: [] },
  'sarvam-code': { command: 'sarvam-code', args: [] },
};
const SUPPORTED_USE_AGENTS = Object.keys(USE_AGENT_CONFIGS) as AgentType[];

export function parseUseOptions(args: string[]): ParseUseOptionsResult {
  const source: string[] = [];
  const options: UseOptions = {};
  const errors: Diagnostic[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg === '--skill' || arg === '-s') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        errors.push(
          diagnostics.SKILLS_OPTION_REQUIRES_VALUE({ option: arg, value: 'a skill name' })
        );
      } else if (options.skill) {
        errors.push(diagnostics.SKILLS_DUPLICATE_OPTION({ option: '--skill' }));
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
        errors.push(
          diagnostics.SKILLS_OPTION_REQUIRES_VALUE({ option: arg, value: 'an agent name' })
        );
      }
      i--;
    } else if (arg.startsWith('-')) {
      errors.push(diagnostics.SKILLS_UNKNOWN_OPTION({ option: arg }));
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
    throw diagnostics.SKILLS_UNSAFE_SKILL_NAME();
  }

  await mkdir(skillDir, { recursive: true });

  if (skill.kind === 'blob') {
    await writeSnapshotFiles(skillDir, skill.files);
  } else if (skill.kind === 'well-known') {
    await writeMapFiles(skillDir, skill.files);
  } else {
    await copyDirectory(skill.path, skillDir);
  }

  const skillMd = skill.rawContent ?? (await readFile(join(skillDir, 'SKILL.md'), 'utf-8'));
  const hasSupportingFiles = await containsSupportingFiles(skillDir, skillDir);

  return { tempRoot, skillDir, skillMd, hasSupportingFiles };
}

export async function runUse(
  sourceArgs: string[],
  options: UseOptions = {},
  parseErrors: Diagnostic[] = []
): Promise<void> {
  let cloneTempDir: string | null = null;

  try {
    if (options.help) {
      console.log(getUseHelp());
      return;
    }

    if (parseErrors.length > 0) {
      fail(...parseErrors);
    }

    if (sourceArgs.length === 0) {
      fail(diagnostics.SKILLS_MISSING_ARGUMENT({ name: 'source' }), `\n${getUseHelp()}`);
    }

    if (sourceArgs.length > 1) {
      fail(diagnostics.SKILLS_MULTIPLE_SOURCES({ received: sourceArgs }));
    }

    const useAgent = options.agent?.[0] as AgentType | undefined;
    if (useAgent && !USE_AGENT_CONFIGS[useAgent]) {
      fail(unsupportedAgent(useAgent));
    }

    const source = sourceArgs[0]!;
    const parsed = parseSource(source);

    const selector = resolveSelector(parsed.skillFilter, options.skill);
    const includeInternal = selector !== undefined;

    let selectedSkill: UseSkill;

    if (parsed.type === 'well-known') {
      const skills = await wellKnownProvider
        .fetchAllSkills(parsed.url, {
          includeInternal,
        })
        .catch((error) => {
          if (
            isDiagnostic(error, 'SKILLS_WELLKNOWN_SCOPE_NOT_FOUND') ||
            isDiagnostic(error, 'SKILLS_WELLKNOWN_DIGEST_MISMATCH')
          ) {
            fail(error);
          }
          return [] as WellKnownSkill[];
        });
      if (skills.length > 0) {
        selectedSkill = selectWellKnownSkill(skills, selector, source);
      } else {
        const downloaded = await downloadSource(parsed.url);
        cloneTempDir = downloaded.tempDir;
        const downloadedSkills = await discoverSkills(downloaded.rootDir, undefined, {
          includeInternal,
          fullDepth: options.fullDepth,
        });
        const selected = selectSkill(downloadedSkills, selector, source);
        selectedSkill = {
          kind: 'disk',
          name: selected.name,
          directoryName: selected.name,
          rawContent: selected.rawContent,
          path: selected.path,
        };
      }
    } else {
      let skills: Skill[];
      let blobResult: BlobInstallResult | null = null;

      if (parsed.type === 'download') {
        const downloaded = await downloadSource(parsed.url);
        cloneTempDir = downloaded.tempDir;
        skills = await discoverSkills(downloaded.rootDir, undefined, {
          includeInternal,
          fullDepth: options.fullDepth,
        });
      } else if (parsed.type === 'local') {
        if (!existsSync(parsed.localPath!)) {
          fail(diagnostics.SKILLS_LOCAL_PATH_NOT_FOUND({ path: parsed.localPath! }));
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
    fail(error instanceof Error ? error : 'Unknown error');
  }
}

export async function launchAgentInteractively(
  agent: AgentType,
  prompt: string,
  spawnImpl: AgentSpawn = spawnAgent
): Promise<number> {
  const config = USE_AGENT_CONFIGS[agent];
  if (!config) {
    throw unsupportedAgent(agent);
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
          diagnostics.SKILLS_USE_AGENT_COMMAND_NOT_FOUND({
            agent: agents[agent].displayName,
            command: config.command,
          })
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
  -h, --help            Show this help message

Examples:
  skills use vercel-labs/agent-skills@web-design-guidelines | claude
  skills use vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
  skills use vercel-labs/agent-skills@web-design-guidelines --agent codex`;
}

function resolveSelector(sourceSelector?: string, optionSelector?: string): string | undefined {
  if (sourceSelector && optionSelector) {
    if (sourceSelector.toLowerCase() !== optionSelector.toLowerCase()) {
      throw diagnostics.SKILLS_CONFLICTING_SKILL_SELECTORS({
        fromSource: sourceSelector,
        fromOption: optionSelector,
      });
    }
    return optionSelector;
  }

  return optionSelector ?? sourceSelector;
}

function selectSkill(skills: Skill[], selector: string | undefined, source: string): Skill {
  if (skills.length === 0) {
    throw diagnostics.SKILLS_NO_VALID_SKILLS();
  }

  if (!selector) {
    if (skills.length === 1) return skills[0]!;
    throw diagnostics.SKILLS_MULTIPLE_SKILLS_IN_SOURCE({
      source,
      names: skills.map(getSkillDisplayName),
    });
  }

  const selected = filterSkills(skills, [selector]);
  if (selected.length === 0) {
    throw diagnostics.SKILLS_USE_NO_MATCHING_SKILL({
      selector,
      available: skills.map(getSkillDisplayName),
    });
  }
  if (selected.length > 1) {
    throw diagnostics.SKILLS_AMBIGUOUS_SKILL_SELECTOR({ selector });
  }

  return selected[0]!;
}

function selectWellKnownSkill(
  skills: WellKnownSkill[],
  selector: string | undefined,
  source: string
): UseSkill {
  if (skills.length === 0) {
    throw diagnostics.SKILLS_WELLKNOWN_INDEX_NOT_FOUND();
  }

  let selected: WellKnownSkill[];
  if (!selector) {
    if (skills.length !== 1) {
      throw diagnostics.SKILLS_MULTIPLE_SKILLS_IN_SOURCE({
        source,
        names: skills.map((s) => s.installName),
      });
    }
    selected = skills;
  } else {
    selected = skills.filter(
      (skill) =>
        skill.installName.toLowerCase() === selector.toLowerCase() ||
        skill.name.toLowerCase() === selector.toLowerCase()
    );
    if (selected.length === 0) {
      throw diagnostics.SKILLS_USE_NO_MATCHING_SKILL({
        selector,
        available: skills.map((s) => s.installName),
      });
    }
    if (selected.length > 1) {
      throw diagnostics.SKILLS_AMBIGUOUS_SKILL_SELECTOR({ selector });
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

function validateUseAgentOption(agentValues: string[] | undefined): Diagnostic[] {
  if (!agentValues || agentValues.length === 0) return [];

  const errors: Diagnostic[] = [];
  const validAgents = Object.keys(agents);
  const invalidAgents = agentValues.filter(
    (agent) => agent !== '*' && !validAgents.includes(agent)
  );

  if (agentValues.includes('*')) {
    errors.push(diagnostics.SKILLS_USE_AGENT_WILDCARD());
  }
  if (agentValues.length > 1) {
    errors.push(diagnostics.SKILLS_USE_MULTIPLE_AGENTS());
  }
  if (invalidAgents.length > 0) {
    errors.push(diagnostics.SKILLS_INVALID_AGENTS({ invalid: invalidAgents, valid: validAgents }));
  }

  return errors;
}

function unsupportedAgent(agent: AgentType): Diagnostic {
  return diagnostics.SKILLS_USE_AGENT_UNSUPPORTED({
    agent: agents[agent].displayName,
    supported: SUPPORTED_USE_AGENTS,
  });
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

function fail(...errors: unknown[]): never {
  for (const error of errors) {
    console.error(error instanceof Error ? formatError(error) : String(error));
  }
  process.exit(1);
}
