import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { sep } from 'path';
import { logger, type Ora } from '../utils/logger.ts';
import {
  parseSource,
  getOwnerRepo,
  parseOwnerRepo,
  isRepoPrivate,
} from '../services/source/parser.ts';
import {
  shortenPath,
  formatList,
  splitAgentsByType,
  buildAgentSummaryLines,
  ensureUniversalAgents,
  buildResultLines,
} from '../ui/formatters.ts';
import {
  isCancelled,
  multiselect,
  promptForAgents,
  selectAgentsInteractive,
} from '../ui/prompts.ts';
export { promptForAgents } from '../ui/prompts.ts';

import { cloneRepo, cleanupTempDir, GitCloneError } from '../services/source/git.ts';
import {
  discoverSkills,
  discoverCognitives,
  getSkillDisplayName,
  filterSkills,
} from '../services/discovery/index.ts';
import {
  installCognitiveForAgent,
  isSkillInstalled,
  isCognitiveInstalled,
  getInstallPath,
  getCanonicalPath,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  type InstallMode,
  type InstallResult,
} from '../services/installer/index.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getNonUniversalAgents,
  isUniversalAgent,
} from '../services/registry/index.ts';
import { track, setVersion } from '../services/telemetry/index.ts';
import { findProvider, wellKnownProvider, type WellKnownCognitive } from '../providers/index.ts';
import {
  addSkillToLock,
  addCognitiveToLock,
  fetchSkillFolderHash,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
} from '../services/lock/lock-file.ts';
import type { Skill, AgentType, RemoteSkill, CognitiveType, ParsedSource } from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import packageJson from '../../package.json' with { type: 'json' };

export function initTelemetry(version: string): void {
  setVersion(version);
}

const version = packageJson.version;
setVersion(version);

export interface AddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
  fullDepth?: boolean;
  type?: CognitiveType;
}

// ── Install Item Abstraction ────────────────────────────────────────────

interface InstallItem {
  installName: string;
  displayName: string;
  description: string;
  sourceIdentifier: string;
  providerId: string;
  sourceUrl: string;
  installFn: (
    agent: AgentType,
    options: { global: boolean; mode: InstallMode }
  ) => Promise<InstallResult>;
  /** Extra files count for well-known skills */
  fileCount?: number;
}

interface PreparedInstallation {
  items: InstallItem[];
  targetAgents: AgentType[];
  installGlobally: boolean;
  installMode: InstallMode;
  cognitiveType: CognitiveType;
  /** Lock file entries to write after successful install */
  lockEntries: LockEntry[];
  /** Telemetry data */
  telemetry: TelemetryData;
}

interface LockEntry {
  name: string;
  source: string;
  sourceType: string;
  sourceUrl: string;
  cognitivePath?: string;
  cognitiveFolderHash: string;
  cognitiveType: CognitiveType;
  isCognitive: boolean;
}

interface TelemetryData {
  source: string;
  sourceType?: string;
  skillFiles: Record<string, string>;
  checkPrivacy: boolean;
}

// ── Shared: Agent Selection ─────────────────────────────────────────────

async function selectTargetAgents(
  options: AddOptions,
  spinner: Ora,
  cleanup?: () => Promise<void>,
  /** Whether to use ensureUniversalAgents (true for remote/direct, false for well-known/legacy) */
  useUniversalAgents = false
): Promise<AgentType[]> {
  const validAgents = Object.keys(agents);
  const universalAgents = getUniversalAgents();

  if (options.agent?.includes('*')) {
    const all = validAgents as AgentType[];
    logger.info(`Installing to all ${all.length} agents`);
    return all;
  }

  if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));
    if (invalidAgents.length > 0) {
      logger.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      logger.info(`Valid agents: ${validAgents.join(', ')}`);
      await cleanup?.();
      process.exit(1);
    }
    if (useUniversalAgents) {
      return ensureUniversalAgents(options.agent as AgentType[]);
    }
    return options.agent as AgentType[];
  }

  spinner.start('Loading agents...');
  const installedAgents = await detectInstalledAgents();
  const totalAgents = Object.keys(agents).length;
  spinner.succeed(`${totalAgents} agents`);

  if (installedAgents.length === 0) {
    if (options.yes) {
      if (useUniversalAgents) {
        logger.info(`Installing to universal agents`);
        return universalAgents;
      }
      const all = validAgents as AgentType[];
      logger.info('Installing to all agents');
      return all;
    }

    if (useUniversalAgents) {
      const selected = await selectAgentsInteractive({ global: options.global });
      if (p.isCancel(selected)) {
        logger.cancel('Installation cancelled');
        await cleanup?.();
        process.exit(0);
      }
      return selected as AgentType[];
    }

    logger.info('Select agents to install skills to');
    const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
      value: key as AgentType,
      label: config.displayName,
    }));
    const selected = await promptForAgents(
      'Which agents do you want to install to?',
      allAgentChoices
    );
    if (p.isCancel(selected)) {
      logger.cancel('Installation cancelled');
      await cleanup?.();
      process.exit(0);
    }
    return selected as AgentType[];
  }

  if (installedAgents.length === 1 || options.yes) {
    if (useUniversalAgents) {
      const target = ensureUniversalAgents(installedAgents);
      const { universal, symlinked } = splitAgentsByType(target);
      if (symlinked.length > 0) {
        logger.info(
          `Installing to: ${pc.green('universal')} + ${symlinked.map((a) => pc.cyan(a)).join(', ')}`
        );
      } else {
        logger.info(`Installing to: ${pc.green('universal agents')}`);
      }
      return target;
    }
    if (installedAgents.length === 1) {
      const firstAgent = installedAgents[0]!;
      logger.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
    } else {
      logger.info(
        `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
      );
    }
    return installedAgents;
  }

  const selected = await selectAgentsInteractive({ global: options.global });
  if (p.isCancel(selected)) {
    logger.cancel('Installation cancelled');
    await cleanup?.();
    process.exit(0);
  }
  return selected as AgentType[];
}

// ── Shared: Scope Selection ─────────────────────────────────────────────

async function selectInstallScope(
  options: AddOptions,
  targetAgents: AgentType[],
  cleanup?: () => Promise<void>
): Promise<boolean> {
  let installGlobally = options.global ?? false;
  const cogType = options.type ?? 'skill';
  const supportsGlobal = targetAgents.some((a) => agents[a].dirs[cogType]?.global !== undefined);

  if (options.global === undefined && !options.yes && supportsGlobal) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });
    if (p.isCancel(scope)) {
      logger.cancel('Installation cancelled');
      await cleanup?.();
      process.exit(0);
    }
    installGlobally = scope as boolean;
  }

  return installGlobally;
}

// ── Shared: Install Mode Selection ──────────────────────────────────────

async function selectInstallMode(
  options: AddOptions,
  cleanup?: () => Promise<void>
): Promise<InstallMode> {
  if (options.yes) return 'symlink';

  const modeChoice = await p.select({
    message: 'Installation method',
    options: [
      {
        value: 'symlink',
        label: 'Symlink (Recommended)',
        hint: 'Single source of truth, easy updates',
      },
      { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
    ],
  });
  if (p.isCancel(modeChoice)) {
    logger.cancel('Installation cancelled');
    await cleanup?.();
    process.exit(0);
  }
  return modeChoice as InstallMode;
}

// ── Shared: Privacy Check ───────────────────────────────────────────────

async function isSourcePrivate(source: string): Promise<boolean | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) return false;
  return isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
}

// ── Unified Install Pipeline ────────────────────────────────────────────

async function executeInstallFlow(
  prepared: PreparedInstallation,
  options: AddOptions,
  spinner: Ora,
  cleanup?: () => Promise<void>
): Promise<void> {
  const { items, targetAgents, installGlobally, installMode, cognitiveType } = prepared;
  const cwd = process.cwd();

  // 1. Check for overwrites (parallel)
  const overwriteChecks = await Promise.all(
    items.flatMap((item) =>
      targetAgents.map(async (agent) => ({
        skillName: item.installName,
        agent,
        installed:
          cognitiveType === 'skill'
            ? await isSkillInstalled(item.installName, agent, { global: installGlobally })
            : await isCognitiveInstalled(item.installName, agent, cognitiveType, {
                global: installGlobally,
              }),
      }))
    )
  );
  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const { skillName, agent, installed } of overwriteChecks) {
    if (!overwriteStatus.has(skillName)) {
      overwriteStatus.set(skillName, new Map());
    }
    overwriteStatus.get(skillName)!.set(agent, installed);
  }

  // 2. Build installation summary
  const summaryLines: string[] = [];
  for (const item of items) {
    if (summaryLines.length > 0) summaryLines.push('');
    const canonicalPath = getCanonicalPath(item.installName, {
      global: installGlobally,
      cognitiveType,
    });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(shortCanonical)}`);
    summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));
    if (item.fileCount && item.fileCount > 1) {
      summaryLines.push(`  ${pc.dim('files:')} ${item.fileCount}`);
    }
    const skillOverwrites = overwriteStatus.get(item.installName);
    const overwriteAgents = targetAgents
      .filter((a) => skillOverwrites?.get(a))
      .map((a) => agents[a].displayName);
    if (overwriteAgents.length > 0) {
      summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
    }
  }

  logger.note(summaryLines.join('\n'), 'Installation Summary');

  // 3. Confirm
  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with installation?' });
    if (p.isCancel(confirmed) || !confirmed) {
      logger.cancel('Installation cancelled');
      await cleanup?.();
      process.exit(0);
    }
  }

  // 4. Install
  const label =
    items.length === 1 ? `Installing ${cognitiveType}...` : `Installing ${cognitiveType}s...`;
  spinner.start(label);

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const item of items) {
    for (const agent of targetAgents) {
      const result = await item.installFn(agent, { global: installGlobally, mode: installMode });
      results.push({
        skill: item.installName,
        agent: agents[agent].displayName,
        ...result,
      });
    }
  }

  spinner.succeed('Installation complete');

  logger.line();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // 5. Telemetry (skip if source is empty, e.g. private repos or local installs)
  const { telemetry } = prepared;
  if (telemetry.source) {
    let shouldTrack = true;
    if (telemetry.checkPrivacy) {
      const isPrivate = await isSourcePrivate(telemetry.source);
      if (isPrivate === true) shouldTrack = false;
    }
    if (shouldTrack) {
      track({
        event: 'install',
        source: telemetry.source,
        skills: items.map((i) => i.installName).join(','),
        agents: targetAgents.join(','),
        ...(installGlobally && { global: '1' }),
        skillFiles: JSON.stringify(telemetry.skillFiles),
        ...(telemetry.sourceType && { sourceType: telemetry.sourceType }),
      });
    }
  }

  // 6. Lock file
  if (successful.length > 0 && installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const entry of prepared.lockEntries) {
      if (successfulSkillNames.has(entry.name)) {
        try {
          let cognitiveFolderHash = entry.cognitiveFolderHash;
          if (!cognitiveFolderHash && entry.sourceType === 'github' && entry.cognitivePath) {
            const hash = await fetchSkillFolderHash(entry.source, entry.cognitivePath);
            if (hash) cognitiveFolderHash = hash;
          }
          if (entry.isCognitive) {
            await addCognitiveToLock(entry.name, entry.cognitiveType, {
              source: entry.source,
              sourceType: entry.sourceType,
              sourceUrl: entry.sourceUrl,
              cognitivePath: entry.cognitivePath,
              cognitiveFolderHash,
            });
          } else {
            await addSkillToLock(entry.name, {
              source: entry.source,
              sourceType: entry.sourceType,
              sourceUrl: entry.sourceUrl,
              cognitiveFolderHash,
            });
          }
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  // 7. Display results
  if (successful.length > 0) {
    const bySkill = new Map<string, typeof results>();
    for (const r of successful) {
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);
    }

    const skillCount = bySkill.size;
    const resultLines: string[] = [];

    for (const [skillName, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;
      if (firstResult.mode === 'copy') {
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim('(copied)')}`);
        for (const r of skillResults) {
          const shortPath = shortenPath(r.path, cwd);
          resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
        }
      } else {
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${pc.green('✓')} ${shortPath}`);
        } else {
          resultLines.push(`${pc.green('✓')} ${skillName}`);
        }
        resultLines.push(...buildResultLines(skillResults, targetAgents));
      }
    }

    const title = pc.green(
      `Installed ${skillCount} ${cognitiveType}${skillCount !== 1 ? 's' : ''}`
    );
    logger.note(resultLines.join('\n'), title);

    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    if (symlinkFailures.length > 0) {
      const copiedAgentNames = symlinkFailures.map((r) => r.agent);
      logger.warning(pc.yellow(`Symlinks failed for: ${formatList(copiedAgentNames)}`));
      logger.message(
        pc.dim('Files were copied instead. On Windows, enable Developer Mode for symlink support.')
      );
    }
  }

  if (failed.length > 0) {
    logger.line();
    logger.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      logger.message(`${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  logger.outro(
    pc.green('Done!') +
      pc.dim('  Review cognitives before use; they run with full agent permissions.')
  );

  await promptForFindSkills(options, targetAgents);
}

// ── Skill Selection (shared for multi-skill sources) ────────────────────

async function selectSkillItems<
  T extends { installName?: string; name: string; description: string },
>(items: T[], options: AddOptions, cleanup?: () => Promise<void>): Promise<T[]> {
  if (options.skill?.includes('*')) {
    logger.info(`Installing all ${items.length} skills`);
    return items;
  }

  if (options.skill && options.skill.length > 0) {
    const selected = items.filter((s) =>
      options.skill!.some(
        (name) =>
          ('installName' in s &&
            (s as { installName: string }).installName?.toLowerCase() === name.toLowerCase()) ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );
    if (selected.length === 0) {
      logger.error(`No matching skills found for: ${options.skill.join(', ')}`);
      logger.info('Available skills:');
      for (const s of items) {
        logger.message(
          `- ${'installName' in s ? (s as { installName: string }).installName : s.name}`
        );
      }
      await cleanup?.();
      process.exit(1);
    }
    logger.info(
      `Selected ${selected.length} skill${selected.length !== 1 ? 's' : ''}: ${selected.map((s) => pc.cyan('installName' in s ? (s as { installName: string }).installName : s.name)).join(', ')}`
    );
    return selected;
  }

  if (items.length === 1) {
    const first = items[0]!;
    logger.info(
      `Skill: ${pc.cyan('installName' in first ? (first as { installName: string }).installName : first.name)}`
    );
    return items;
  }

  if (options.yes) {
    logger.info(`Installing all ${items.length} skills`);
    return items;
  }

  const skillChoices = items.map((s) => ({
    value: s,
    label: 'installName' in s ? (s as { installName: string }).installName : s.name,
    hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
  }));

  const selected = await multiselect({
    message: 'Select skills to install',
    options: skillChoices,
    required: true,
  });

  if (p.isCancel(selected)) {
    logger.cancel('Installation cancelled');
    await cleanup?.();
    process.exit(0);
  }

  return selected as T[];
}

// ── Resolver: Remote Skill (provider-based) ─────────────────────────────

async function resolveRemoteSkill(
  url: string,
  options: AddOptions,
  spinner: Ora
): Promise<PreparedInstallation> {
  const provider = findProvider(url);

  if (!provider) {
    spinner.fail('Unsupported skill host');
    logger.outro(
      pc.red(
        'Could not find a provider for this URL. Supported hosts include Mintlify, HuggingFace, and well-known skill endpoints.'
      )
    );
    process.exit(1);
  }

  spinner.start(`Fetching skill.md from ${provider.displayName}...`);
  const providerSkill = await provider.fetchCognitive(url);

  if (!providerSkill) {
    spinner.fail('Invalid skill');
    logger.outro(
      pc.red('Could not fetch skill.md or missing required frontmatter (name, description).')
    );
    process.exit(1);
  }

  const cognitiveType = providerSkill.cognitiveType ?? 'skill';

  const remoteSkill: RemoteSkill = {
    name: providerSkill.name,
    description: providerSkill.description,
    content: providerSkill.content,
    installName: providerSkill.installName,
    sourceUrl: providerSkill.sourceUrl,
    providerId: provider.id,
    sourceIdentifier: provider.getSourceIdentifier(url),
    metadata: providerSkill.metadata,
    cognitiveType,
  };

  spinner.succeed(`Found skill: ${pc.cyan(remoteSkill.installName)}`);
  logger.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  logger.message(pc.dim(remoteSkill.description));
  logger.message(pc.dim(`Source: ${remoteSkill.sourceIdentifier}`));

  if (options.list) {
    logger.line();
    logger.step(pc.bold('Skill Details'));
    logger.message(`${pc.cyan('Name:')} ${remoteSkill.name}`);
    logger.message(`${pc.cyan('Install as:')} ${remoteSkill.installName}`);
    logger.message(`${pc.cyan('Provider:')} ${provider.displayName}`);
    logger.message(`${pc.cyan('Description:')} ${remoteSkill.description}`);
    logger.outro('Run without --list to install');
    process.exit(0);
  }

  const targetAgents = await selectTargetAgents(options, spinner, undefined, true);
  const installGlobally = await selectInstallScope(options, targetAgents);
  const installMode = provider.id === 'mintlify' ? 'symlink' : await selectInstallMode(options);

  const item: InstallItem = {
    installName: remoteSkill.installName,
    displayName: remoteSkill.name,
    description: remoteSkill.description,
    sourceIdentifier: remoteSkill.sourceIdentifier,
    providerId: remoteSkill.providerId,
    sourceUrl: url,
    installFn: (agent, opts) =>
      installRemoteSkillForAgent(remoteSkill, agent, { ...opts, cognitiveType }),
  };

  return {
    items: [item],
    targetAgents,
    installGlobally,
    installMode,
    cognitiveType,
    lockEntries: [
      {
        name: remoteSkill.installName,
        source: remoteSkill.sourceIdentifier,
        sourceType: remoteSkill.providerId,
        sourceUrl: url,
        cognitiveFolderHash: '',
        cognitiveType,
        isCognitive: cognitiveType !== 'skill',
      },
    ],
    telemetry: {
      source: remoteSkill.sourceIdentifier,
      sourceType: remoteSkill.providerId,
      skillFiles: { [remoteSkill.installName]: url },
      checkPrivacy: true,
    },
  };
}

// ── Resolver: Well-Known Skills ─────────────────────────────────────────

async function resolveWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: Ora
): Promise<PreparedInstallation> {
  spinner.start('Discovering skills from well-known endpoint...');
  const skills = await wellKnownProvider.fetchAllSkills(url);

  if (skills.length === 0) {
    spinner.fail('No skills found');
    logger.outro(
      pc.red(
        'No skills found at this URL. Make sure the server has a /.well-known/skills/index.json file.'
      )
    );
    process.exit(1);
  }

  spinner.succeed(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  for (const skill of skills) {
    logger.info(`Skill: ${pc.cyan(skill.installName)}`);
    logger.message(pc.dim(skill.description));
    if (skill.files.size > 1) {
      logger.message(pc.dim(`  Files: ${Array.from(skill.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    logger.line();
    logger.step(pc.bold('Available Skills'));
    for (const skill of skills) {
      logger.message(`${pc.cyan(skill.installName)}`);
      logger.message(`  ${pc.dim(skill.description)}`);
      if (skill.files.size > 1) {
        logger.message(`  ${pc.dim(`Files: ${skill.files.size}`)}`);
      }
    }
    logger.outro('Run without --list to install');
    process.exit(0);
  }

  const selectedSkills = await selectSkillItems(skills, options);
  const targetAgents = await selectTargetAgents(options, spinner);
  const installGlobally = await selectInstallScope(options, targetAgents);
  const installMode = await selectInstallMode(options);

  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);

  const items: InstallItem[] = selectedSkills.map((skill) => ({
    installName: skill.installName,
    displayName: skill.name,
    description: skill.description,
    sourceIdentifier,
    providerId: 'well-known',
    sourceUrl: skill.sourceUrl,
    fileCount: skill.files.size,
    installFn: (agent: AgentType, opts: { global: boolean; mode: InstallMode }) =>
      installWellKnownSkillForAgent(skill, agent, opts),
  }));

  const skillFiles: Record<string, string> = {};
  const lockEntries: LockEntry[] = [];
  for (const skill of selectedSkills) {
    skillFiles[skill.installName] = skill.sourceUrl;
    lockEntries.push({
      name: skill.installName,
      source: sourceIdentifier,
      sourceType: 'well-known',
      sourceUrl: skill.sourceUrl,
      cognitiveFolderHash: '',
      cognitiveType: skill.cognitiveType ?? 'skill',
      isCognitive: (skill.cognitiveType ?? 'skill') !== 'skill',
    });
  }

  const resolvedCognitiveType = selectedSkills[0]?.cognitiveType ?? 'skill';

  return {
    items,
    targetAgents,
    installGlobally,
    installMode,
    cognitiveType: resolvedCognitiveType,
    lockEntries,
    telemetry: {
      source: sourceIdentifier,
      sourceType: 'well-known',
      skillFiles,
      checkPrivacy: true,
    },
  };
}

// ── Resolver: Git Repo Skills ───────────────────────────────────────────

async function resolveGitRepoSkills(
  source: string,
  parsed: ParsedSource,
  options: AddOptions,
  spinner: Ora,
  skillsDir: string,
  tempDir: string | null
): Promise<PreparedInstallation> {
  const cleanupFn = async () => {
    await cleanupDir(tempDir);
  };
  const cognitiveType = options.type ?? 'skill';
  const cognitiveLabel = cognitiveType === 'skill' ? 'skills' : `${cognitiveType}s`;
  const cognitiveFile = COGNITIVE_FILE_NAMES[cognitiveType];

  const includeInternal = !!(options.skill && options.skill.length > 0);

  spinner.start(`Discovering ${cognitiveLabel}...`);
  const skills = options.type
    ? await discoverCognitives(skillsDir, parsed.subpath, {
        includeInternal,
        fullDepth: options.fullDepth,
        types: [options.type],
      })
    : await discoverSkills(skillsDir, parsed.subpath, {
        includeInternal,
        fullDepth: options.fullDepth,
      });

  if (skills.length === 0) {
    spinner.fail(`No ${cognitiveLabel} found`);
    logger.outro(
      pc.red(
        `No valid ${cognitiveLabel} found. They require a ${cognitiveFile} with name and description.`
      )
    );
    await cleanupFn();
    process.exit(1);
  }

  spinner.succeed(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  if (options.list) {
    logger.line();
    logger.step(pc.bold('Available Skills'));
    for (const skill of skills) {
      logger.message(`${pc.cyan(getSkillDisplayName(skill))}`);
      logger.message(`  ${pc.dim(skill.description)}`);
    }
    logger.outro('Use --skill <name> to install specific skills');
    await cleanupFn();
    process.exit(0);
  }

  // Select skills using filter or interactive
  let selectedSkills: Skill[];
  if (options.skill?.includes('*')) {
    selectedSkills = skills;
    logger.info(`Installing all ${skills.length} skills`);
  } else if (options.skill && options.skill.length > 0) {
    selectedSkills = filterSkills(skills, options.skill);
    if (selectedSkills.length === 0) {
      logger.error(`No matching skills found for: ${options.skill.join(', ')}`);
      logger.info('Available skills:');
      for (const s of skills) {
        logger.message(`- ${getSkillDisplayName(s)}`);
      }
      await cleanupFn();
      process.exit(1);
    }
    logger.info(
      `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
    );
  } else if (skills.length === 1) {
    selectedSkills = skills;
    const firstSkill = skills[0]!;
    logger.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
    logger.message(pc.dim(firstSkill.description));
  } else if (options.yes) {
    selectedSkills = skills;
    logger.info(`Installing all ${skills.length} skills`);
  } else {
    const skillChoices = skills.map((s) => ({
      value: s,
      label: getSkillDisplayName(s),
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));
    const selected = await multiselect({
      message: 'Select skills to install',
      options: skillChoices,
      required: true,
    });
    if (p.isCancel(selected)) {
      logger.cancel('Installation cancelled');
      await cleanupFn();
      process.exit(0);
    }
    selectedSkills = selected as Skill[];
  }

  const targetAgents = await selectTargetAgents(options, spinner, cleanupFn);
  const installGlobally = await selectInstallScope(options, targetAgents, cleanupFn);
  const installMode = await selectInstallMode(options, cleanupFn);

  const normalizedSource = getOwnerRepo(parsed);

  // Build skillFiles map for telemetry
  const skillFiles: Record<string, string> = {};
  for (const skill of selectedSkills) {
    let relativePath: string;
    if (tempDir && skill.path === tempDir) {
      relativePath = cognitiveFile;
    } else if (tempDir && skill.path.startsWith(tempDir + sep)) {
      relativePath =
        skill.path
          .slice(tempDir.length + 1)
          .split(sep)
          .join('/') + `/${cognitiveFile}`;
    } else {
      continue; // Local path - skip telemetry
    }
    skillFiles[skill.name] = relativePath;
  }

  const items: InstallItem[] = selectedSkills.map((skill) => ({
    installName: skill.name,
    displayName: getSkillDisplayName(skill),
    description: skill.description,
    sourceIdentifier: normalizedSource ?? source,
    providerId: parsed.type,
    sourceUrl: parsed.url,
    installFn: (agent: AgentType, opts: { global: boolean; mode: InstallMode }) =>
      installCognitiveForAgent(skill, agent, { ...opts, cognitiveType }),
  }));

  const lockEntries: LockEntry[] = [];
  if (normalizedSource) {
    for (const skill of selectedSkills) {
      lockEntries.push({
        name: getSkillDisplayName(skill),
        source: normalizedSource,
        sourceType: parsed.type,
        sourceUrl: parsed.url,
        cognitivePath: skillFiles[skill.name],
        cognitiveFolderHash: '',
        cognitiveType,
        isCognitive: true,
      });
    }
  }

  // Determine telemetry privacy check behavior
  let checkPrivacy = false;
  let telemetrySource = normalizedSource ?? '';
  if (normalizedSource) {
    const ownerRepo = parseOwnerRepo(normalizedSource);
    if (ownerRepo) {
      // For GitHub repos, check privacy — only send if public
      const isPrivate = await isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
      if (isPrivate === false) {
        checkPrivacy = false; // Already verified public, just send
      } else {
        // Private or unknown — skip telemetry entirely
        telemetrySource = '';
      }
    } else {
      checkPrivacy = false;
    }
  }

  return {
    items,
    targetAgents,
    installGlobally,
    installMode,
    cognitiveType,
    lockEntries,
    telemetry: {
      source: telemetrySource,
      skillFiles,
      checkPrivacy: false,
    },
  };
}

// ── Main Entry Point ────────────────────────────────────────────────────

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  const showInstallTip = (): void => {
    if (installTipShown) return;
    logger.message(
      pc.dim('Tip: use the --yes (-y) and --global (-g) flags to install without prompts.')
    );
    installTipShown = true;
  };

  if (!source) {
    logger.line();
    logger.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    logger.line();
    logger.dim('  Usage:');
    logger.log(`    ${pc.cyan('npx synk add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    logger.line();
    logger.dim('  Example:');
    logger.log(`    ${pc.cyan('npx synk add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    logger.line();
    process.exit(1);
  }

  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  logger.intro(' synk ');

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = logger.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.succeed(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    // Direct URL skills (Mintlify, HuggingFace, etc.) via provider system
    if (parsed.type === 'direct-url') {
      const prepared = await resolveRemoteSkill(parsed.url, options, spinner);
      await executeInstallFlow(prepared, options, spinner);
      return;
    }

    // Well-known skills from arbitrary URLs
    if (parsed.type === 'well-known') {
      const prepared = await resolveWellKnownSkills(source, parsed.url, options, spinner);
      await executeInstallFlow(prepared, options, spinner);
      return;
    }

    // Git repo or local path
    let skillsDir: string;

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.fail('Path not found');
        logger.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.succeed('Local path validated');
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.succeed('Repository cloned');
    }

    if (parsed.skillFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.skillFilter)) {
        options.skill.push(parsed.skillFilter);
      }
    }

    const prepared = await resolveGitRepoSkills(
      source,
      parsed,
      options,
      spinner,
      skillsDir,
      tempDir
    );
    const cleanupFn = async () => {
      await cleanupDir(tempDir);
    };
    await executeInstallFlow(prepared, options, spinner, cleanupFn);
  } catch (error) {
    if (error instanceof GitCloneError) {
      logger.error(pc.red('Failed to clone repository'));
      for (const line of error.message.split('\n')) {
        logger.message(pc.dim(line));
      }
    } else {
      logger.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    showInstallTip();
    logger.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanupDir(tempDir);
  }
}

async function cleanupDir(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

async function promptForFindSkills(
  options?: AddOptions,
  targetAgents?: AgentType[]
): Promise<void> {
  if (!process.stdin.isTTY) return;
  if (options?.yes) return;

  try {
    const dismissed = await isPromptDismissed('findSkillsPrompt');
    if (dismissed) return;

    const findSkillsInstalled = await isSkillInstalled('find-skills', 'claude-code', {
      global: true,
    });
    if (findSkillsInstalled) {
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    logger.line();
    logger.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-skills')} skill? It helps your agent discover and suggest skills.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    if (install) {
      await dismissPrompt('findSkillsPrompt');
      const findSkillsAgents = targetAgents?.filter((a) => a !== 'replit');
      if (!findSkillsAgents || findSkillsAgents.length === 0) return;

      logger.line();
      logger.step('Installing find-skills skill...');

      try {
        await runAdd(['vercel-labs/skills'], {
          skill: ['find-skills'],
          global: true,
          yes: true,
          agent: findSkillsAgents,
        });
      } catch {
        logger.warning('Failed to install find-skills. You can try again with:');
        logger.message(pc.dim('  npx synk add vercel-labs/skills@find-skills -g -y --all'));
      }
    } else {
      await dismissPrompt('findSkillsPrompt');
      logger.message(
        pc.dim('You can install it later with: npx synk add vercel-labs/skills@find-skills')
      );
    }
  } catch {
    // Don't fail the main installation if prompt fails
  }
}

export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.skill.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '-t' || arg === '--type') {
      i++;
      const typeVal = args[i];
      if (typeVal && (Object.keys(COGNITIVE_FILE_NAMES) as string[]).includes(typeVal)) {
        options.type = typeVal as CognitiveType;
      }
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
