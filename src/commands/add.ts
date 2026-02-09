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
import { multiselect, promptForAgents, selectAgentsInteractive } from '../ui/prompts.ts';
export { promptForAgents } from '../ui/prompts.ts';

import { cloneRepo, cleanupTempDir, GitCloneError } from '../services/source/git.ts';
import {
  discoverCognitives,
  getCognitiveDisplayName,
  filterCognitives,
} from '../services/discovery/index.ts';
import {
  installCognitiveForAgent,
  isCognitiveInstalled,
  getCanonicalPath,
  installRemoteCognitiveForAgent,
  installWellKnownCognitiveForAgent,
  type InstallMode,
  type InstallResult,
} from '../services/installer/index.ts';
import { detectInstalledAgents, agents, getUniversalAgents } from '../services/registry/index.ts';
import { track, setVersion } from '../services/telemetry/index.ts';
import { findProvider, wellKnownProvider } from '../providers/index.ts';
import {
  addCognitiveToLock,
  fetchCognitiveFolderHash,
  isPromptDismissed,
  dismissPrompt,
} from '../services/lock/lock-file.ts';
import type {
  Cognitive,
  AgentType,
  RemoteCognitive,
  CognitiveType,
  ParsedSource,
} from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import packageJson from '../../package.json' with { type: 'json' };
import { assertNotCancelled, buildLockEntry, type LockEntry } from './shared.ts';

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
  fileCount?: number;
}

interface PreparedInstallation {
  items: InstallItem[];
  targetAgents: AgentType[];
  installGlobally: boolean;
  installMode: InstallMode;
  cognitiveType: CognitiveType;
  lockEntries: LockEntry[];
  telemetry: TelemetryData;
}

interface TelemetryData {
  source: string;
  sourceType?: string;
  skillFiles: Record<string, string>;
  checkPrivacy: boolean;
}

interface InstallResultRecord {
  name: string;
  agent: string;
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
}

// ── Shared: Agent Selection ─────────────────────────────────────────────

async function selectTargetAgents(
  options: AddOptions,
  spinner: Ora,
  cleanup?: () => Promise<void>,
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
      assertNotCancelled(selected, cleanup);
      return selected as AgentType[];
    }

    logger.info('Select agents to install to');
    const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
      value: key as AgentType,
      label: config.displayName,
    }));
    const selected = await promptForAgents(
      'Which agents do you want to install to?',
      allAgentChoices
    );
    assertNotCancelled(selected, cleanup);
    return selected as AgentType[];
  }

  if (installedAgents.length === 1 || options.yes) {
    if (useUniversalAgents) {
      const target = ensureUniversalAgents(installedAgents);
      const { symlinked } = splitAgentsByType(target);
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
  assertNotCancelled(selected, cleanup);
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
    assertNotCancelled(scope, cleanup);
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
  assertNotCancelled(modeChoice, cleanup);
  return modeChoice as InstallMode;
}

// ── Shared: Install Context (agents + scope + mode) ─────────────────────

async function selectInstallContext(
  options: AddOptions,
  spinner: Ora,
  cleanup?: () => Promise<void>,
  config?: { useUniversalAgents?: boolean; forceMode?: InstallMode }
): Promise<{ targetAgents: AgentType[]; installGlobally: boolean; installMode: InstallMode }> {
  const targetAgents = await selectTargetAgents(
    options,
    spinner,
    cleanup,
    config?.useUniversalAgents
  );
  const installGlobally = await selectInstallScope(options, targetAgents, cleanup);
  const installMode = config?.forceMode ?? (await selectInstallMode(options, cleanup));
  return { targetAgents, installGlobally, installMode };
}

// ── Shared: Privacy Check ───────────────────────────────────────────────

async function isSourcePrivate(source: string): Promise<boolean | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) return false;
  return isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
}

// ── executeInstallFlow sub-functions ────────────────────────────────────

async function checkOverwrites(
  items: InstallItem[],
  targetAgents: AgentType[],
  installGlobally: boolean,
  cognitiveType: CognitiveType
): Promise<Map<string, Map<string, boolean>>> {
  const overwriteChecks = await Promise.all(
    items.flatMap((item) =>
      targetAgents.map(async (agent) => ({
        itemName: item.installName,
        agent,
        installed: await isCognitiveInstalled(item.installName, agent, cognitiveType, {
          global: installGlobally,
        }),
      }))
    )
  );
  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const { itemName, agent, installed } of overwriteChecks) {
    if (!overwriteStatus.has(itemName)) {
      overwriteStatus.set(itemName, new Map());
    }
    overwriteStatus.get(itemName)!.set(agent, installed);
  }
  return overwriteStatus;
}

function buildInstallSummary(
  items: InstallItem[],
  targetAgents: AgentType[],
  installGlobally: boolean,
  installMode: InstallMode,
  cognitiveType: CognitiveType,
  overwriteStatus: Map<string, Map<string, boolean>>,
  cwd: string
): string[] {
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
    const itemOverwrites = overwriteStatus.get(item.installName);
    const overwriteAgents = targetAgents
      .filter((a) => itemOverwrites?.get(a))
      .map((a) => agents[a].displayName);
    if (overwriteAgents.length > 0) {
      summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
    }
  }
  return summaryLines;
}

async function performInstalls(
  items: InstallItem[],
  targetAgents: AgentType[],
  installGlobally: boolean,
  installMode: InstallMode
): Promise<InstallResultRecord[]> {
  const results: InstallResultRecord[] = [];

  for (const item of items) {
    for (const agent of targetAgents) {
      const result = await item.installFn(agent, { global: installGlobally, mode: installMode });
      results.push({
        name: item.installName,
        agent: agents[agent].displayName,
        ...result,
      });
    }
  }

  return results;
}

async function writeLockEntries(
  prepared: PreparedInstallation,
  successfulNames: Set<string>
): Promise<void> {
  for (const entry of prepared.lockEntries) {
    if (successfulNames.has(entry.name)) {
      try {
        let cognitiveFolderHash = entry.cognitiveFolderHash;
        if (!cognitiveFolderHash && entry.sourceType === 'github' && entry.cognitivePath) {
          const hash = await fetchCognitiveFolderHash(entry.source, entry.cognitivePath);
          if (hash) cognitiveFolderHash = hash;
        }
        await addCognitiveToLock(entry.name, entry.cognitiveType, {
          source: entry.source,
          sourceType: entry.sourceType,
          sourceUrl: entry.sourceUrl,
          cognitivePath: entry.cognitivePath,
          cognitiveFolderHash,
        });
      } catch {
        // Don't fail installation if lock file update fails
      }
    }
  }
}

function displayResults(
  results: InstallResultRecord[],
  targetAgents: AgentType[],
  cognitiveType: CognitiveType,
  cwd: string
): void {
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const byName = new Map<string, typeof results>();
    for (const r of successful) {
      const group = byName.get(r.name) || [];
      group.push(r);
      byName.set(r.name, group);
    }

    const itemCount = byName.size;
    const resultLines: string[] = [];

    for (const [itemName, itemResults] of byName) {
      const firstResult = itemResults[0]!;
      if (firstResult.mode === 'copy') {
        resultLines.push(`${pc.green('✓')} ${itemName} ${pc.dim('(copied)')}`);
        for (const r of itemResults) {
          const shortPath = shortenPath(r.path, cwd);
          resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
        }
      } else {
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${pc.green('✓')} ${shortPath}`);
        } else {
          resultLines.push(`${pc.green('✓')} ${itemName}`);
        }
        resultLines.push(...buildResultLines(itemResults, targetAgents));
      }
    }

    const title = pc.green(`Installed ${itemCount} ${cognitiveType}${itemCount !== 1 ? 's' : ''}`);
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
      logger.message(`${pc.red('✗')} ${r.name} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }
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

  // 1. Check for overwrites
  const overwriteStatus = await checkOverwrites(
    items,
    targetAgents,
    installGlobally,
    cognitiveType
  );

  // 2. Build and display summary
  const summaryLines = buildInstallSummary(
    items,
    targetAgents,
    installGlobally,
    installMode,
    cognitiveType,
    overwriteStatus,
    cwd
  );
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
  const results = await performInstalls(items, targetAgents, installGlobally, installMode);
  spinner.succeed('Installation complete');
  logger.line();

  // 5. Telemetry
  const successful = results.filter((r) => r.success);
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
    const successfulNames = new Set(successful.map((r) => r.name));
    await writeLockEntries(prepared, successfulNames);
  }

  // 7. Display results
  displayResults(results, targetAgents, cognitiveType, cwd);

  logger.outro(
    pc.green('Done!') +
      pc.dim('  Review cognitives before use; they run with full agent permissions.')
  );

  await promptForFindSkills(options, targetAgents);
}

// ── Cognitive Selection (shared for multi-item sources) ─────────────────

async function selectCognitiveItems<
  T extends { installName?: string; name: string; description: string },
>(items: T[], options: AddOptions, cleanup?: () => Promise<void>): Promise<T[]> {
  const cognitiveType = options.type ?? 'skill';
  const label = cognitiveType === 'skill' ? 'skills' : `${cognitiveType}s`;

  if (options.skill?.includes('*')) {
    logger.info(`Installing all ${items.length} ${label}`);
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
      logger.error(`No matching ${label} found for: ${options.skill.join(', ')}`);
      logger.info(`Available ${label}:`);
      for (const s of items) {
        logger.message(
          `- ${'installName' in s ? (s as { installName: string }).installName : s.name}`
        );
      }
      await cleanup?.();
      process.exit(1);
    }
    logger.info(
      `Selected ${selected.length} ${cognitiveType}${selected.length !== 1 ? 's' : ''}: ${selected.map((s) => pc.cyan('installName' in s ? (s as { installName: string }).installName : s.name)).join(', ')}`
    );
    return selected;
  }

  if (items.length === 1) {
    const first = items[0]!;
    logger.info(
      `${cognitiveType}: ${pc.cyan('installName' in first ? (first as { installName: string }).installName : first.name)}`
    );
    return items;
  }

  if (options.yes) {
    logger.info(`Installing all ${items.length} ${label}`);
    return items;
  }

  const cognitiveChoices = items.map((s) => ({
    value: s,
    label: 'installName' in s ? (s as { installName: string }).installName : s.name,
    hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
  }));

  const selected = await multiselect({
    message: `Select ${label} to install`,
    options: cognitiveChoices,
    required: true,
  });

  assertNotCancelled(selected, cleanup);

  return selected as T[];
}

// ── Resolver: Remote Cognitive (provider-based) ─────────────────────────

async function resolveRemoteCognitive(
  url: string,
  options: AddOptions,
  spinner: Ora
): Promise<PreparedInstallation> {
  const provider = findProvider(url);

  if (!provider) {
    spinner.fail('Unsupported source host');
    logger.outro(
      pc.red(
        'Could not find a provider for this URL. Supported hosts include Mintlify, HuggingFace, and well-known endpoints.'
      )
    );
    process.exit(1);
  }

  const cognitiveType = options.type ?? 'skill';
  const cognitiveFile = COGNITIVE_FILE_NAMES[cognitiveType];

  spinner.start(`Fetching ${cognitiveFile} from ${provider.displayName}...`);
  const providerCognitive = await provider.fetchCognitive(url);

  if (!providerCognitive) {
    spinner.fail(`Invalid ${cognitiveType}`);
    logger.outro(
      pc.red(
        `Could not fetch ${cognitiveFile} or missing required frontmatter (name, description).`
      )
    );
    process.exit(1);
  }

  const resolvedType = providerCognitive.cognitiveType ?? cognitiveType;

  const remoteCognitive: RemoteCognitive = {
    name: providerCognitive.name,
    description: providerCognitive.description,
    content: providerCognitive.content,
    installName: providerCognitive.installName,
    sourceUrl: providerCognitive.sourceUrl,
    providerId: provider.id,
    sourceIdentifier: provider.getSourceIdentifier(url),
    metadata: providerCognitive.metadata,
    cognitiveType: resolvedType,
  };

  spinner.succeed(`Found ${resolvedType}: ${pc.cyan(remoteCognitive.installName)}`);
  logger.info(`${resolvedType}: ${pc.cyan(remoteCognitive.name)}`);
  logger.message(pc.dim(remoteCognitive.description));
  logger.message(pc.dim(`Source: ${remoteCognitive.sourceIdentifier}`));

  if (options.list) {
    logger.line();
    logger.step(pc.bold('Details'));
    logger.message(`${pc.cyan('Name:')} ${remoteCognitive.name}`);
    logger.message(`${pc.cyan('Install as:')} ${remoteCognitive.installName}`);
    logger.message(`${pc.cyan('Provider:')} ${provider.displayName}`);
    logger.message(`${pc.cyan('Description:')} ${remoteCognitive.description}`);
    logger.outro('Run without --list to install');
    process.exit(0);
  }

  const { targetAgents, installGlobally, installMode } = await selectInstallContext(
    options,
    spinner,
    undefined,
    { useUniversalAgents: true, forceMode: provider.id === 'mintlify' ? 'symlink' : undefined }
  );

  const item: InstallItem = {
    installName: remoteCognitive.installName,
    displayName: remoteCognitive.name,
    description: remoteCognitive.description,
    sourceIdentifier: remoteCognitive.sourceIdentifier,
    providerId: remoteCognitive.providerId,
    sourceUrl: url,
    installFn: (agent, opts) =>
      installRemoteCognitiveForAgent(remoteCognitive, agent, {
        ...opts,
        cognitiveType: resolvedType,
      }),
  };

  return {
    items: [item],
    targetAgents,
    installGlobally,
    installMode,
    cognitiveType: resolvedType,
    lockEntries: [
      buildLockEntry({
        name: remoteCognitive.installName,
        source: remoteCognitive.sourceIdentifier,
        sourceType: remoteCognitive.providerId,
        sourceUrl: url,
        cognitiveType: resolvedType,
      }),
    ],
    telemetry: {
      source: remoteCognitive.sourceIdentifier,
      sourceType: remoteCognitive.providerId,
      skillFiles: { [remoteCognitive.installName]: url },
      checkPrivacy: true,
    },
  };
}

// ── Resolver: Well-Known Cognitives ─────────────────────────────────────

async function resolveWellKnownCognitives(
  url: string,
  options: AddOptions,
  spinner: Ora
): Promise<PreparedInstallation> {
  const cognitiveType = options.type ?? 'skill';
  const label = cognitiveType === 'skill' ? 'skills' : `${cognitiveType}s`;

  spinner.start(`Discovering ${label} from well-known endpoint...`);
  const cognitives = await wellKnownProvider.fetchAllCognitives(url);

  if (cognitives.length === 0) {
    spinner.fail(`No ${label} found`);
    logger.outro(
      pc.red(
        `No ${label} found at this URL. Make sure the server has a /.well-known/skills/index.json file.`
      )
    );
    process.exit(1);
  }

  spinner.succeed(
    `Found ${pc.green(cognitives.length)} ${cognitiveType}${cognitives.length > 1 ? 's' : ''}`
  );

  for (const item of cognitives) {
    logger.info(`${cognitiveType}: ${pc.cyan(item.installName)}`);
    logger.message(pc.dim(item.description));
    if (item.files.size > 1) {
      logger.message(pc.dim(`  Files: ${Array.from(item.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    logger.line();
    logger.step(pc.bold(`Available ${label}`));
    for (const item of cognitives) {
      logger.message(`${pc.cyan(item.installName)}`);
      logger.message(`  ${pc.dim(item.description)}`);
      if (item.files.size > 1) {
        logger.message(`  ${pc.dim(`Files: ${item.files.size}`)}`);
      }
    }
    logger.outro('Run without --list to install');
    process.exit(0);
  }

  const selectedCognitives = await selectCognitiveItems(cognitives, options);

  const { targetAgents, installGlobally, installMode } = await selectInstallContext(
    options,
    spinner
  );

  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);

  const items: InstallItem[] = selectedCognitives.map((cog) => ({
    installName: cog.installName,
    displayName: cog.name,
    description: cog.description,
    sourceIdentifier,
    providerId: 'well-known',
    sourceUrl: cog.sourceUrl,
    fileCount: cog.files.size,
    installFn: (agent: AgentType, opts: { global: boolean; mode: InstallMode }) =>
      installWellKnownCognitiveForAgent(cog, agent, opts),
  }));

  const telemetryFiles: Record<string, string> = {};
  const lockEntries: LockEntry[] = [];
  for (const cog of selectedCognitives) {
    telemetryFiles[cog.installName] = cog.sourceUrl;
    lockEntries.push(
      buildLockEntry({
        name: cog.installName,
        source: sourceIdentifier,
        sourceType: 'well-known',
        sourceUrl: cog.sourceUrl,
        cognitiveType: cog.cognitiveType ?? cognitiveType,
      })
    );
  }

  const resolvedCognitiveType = selectedCognitives[0]?.cognitiveType ?? cognitiveType;

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
      skillFiles: telemetryFiles,
      checkPrivacy: true,
    },
  };
}

// ── Resolver: Git Repo Cognitives ───────────────────────────────────────

async function resolveGitRepoCognitives(
  source: string,
  parsed: ParsedSource,
  options: AddOptions,
  spinner: Ora,
  sourceDir: string,
  tempDir: string | null
): Promise<PreparedInstallation> {
  const cleanupFn = async () => {
    await cleanupDir(tempDir);
  };
  const cognitiveType = options.type ?? 'skill';
  const label = cognitiveType === 'skill' ? 'skills' : `${cognitiveType}s`;
  const cognitiveFile = COGNITIVE_FILE_NAMES[cognitiveType];

  const includeInternal = !!(options.skill && options.skill.length > 0);

  spinner.start(`Discovering ${label}...`);
  const cognitives = await discoverCognitives(sourceDir, parsed.subpath, {
    includeInternal,
    fullDepth: options.fullDepth,
    types: options.type ? [options.type] : ['skill'],
  });

  if (cognitives.length === 0) {
    spinner.fail(`No ${label} found`);
    logger.outro(
      pc.red(`No valid ${label} found. They require a ${cognitiveFile} with name and description.`)
    );
    await cleanupFn();
    process.exit(1);
  }

  spinner.succeed(
    `Found ${pc.green(cognitives.length)} ${cognitiveType}${cognitives.length > 1 ? 's' : ''}`
  );

  if (options.list) {
    logger.line();
    logger.step(pc.bold(`Available ${label}`));
    for (const cog of cognitives) {
      logger.message(`${pc.cyan(getCognitiveDisplayName(cog))}`);
      logger.message(`  ${pc.dim(cog.description)}`);
    }
    logger.outro(`Use --skill <name> to install specific ${label}`);
    await cleanupFn();
    process.exit(0);
  }

  // Select cognitives: use filterCognitives for --skill flag (supports path-based matching),
  // selectCognitiveItems for wildcard/interactive/yes
  let selectedCognitives: Cognitive[];
  if (options.skill && options.skill.length > 0 && !options.skill.includes('*')) {
    selectedCognitives = filterCognitives(cognitives, options.skill);
    if (selectedCognitives.length === 0) {
      logger.error(`No matching ${label} found for: ${options.skill.join(', ')}`);
      logger.info(`Available ${label}:`);
      for (const s of cognitives) {
        logger.message(`- ${getCognitiveDisplayName(s)}`);
      }
      await cleanupFn();
      process.exit(1);
    }
    logger.info(
      `Selected ${selectedCognitives.length} ${cognitiveType}${selectedCognitives.length !== 1 ? 's' : ''}: ${selectedCognitives.map((s: Cognitive) => pc.cyan(getCognitiveDisplayName(s))).join(', ')}`
    );
  } else {
    // Map Cognitive[] to the shape selectCognitiveItems expects
    const selectableItems = cognitives.map((s: Cognitive) => ({
      installName: s.name,
      name: getCognitiveDisplayName(s),
      description: s.description,
    }));
    const selected = await selectCognitiveItems(selectableItems, options, cleanupFn);
    selectedCognitives = selected.map(
      (s) => cognitives.find((c: Cognitive) => c.name === s.installName)!
    );
  }

  const { targetAgents, installGlobally, installMode } = await selectInstallContext(
    options,
    spinner,
    cleanupFn
  );

  const normalizedSource = getOwnerRepo(parsed);

  // Build telemetry files map
  const telemetryFiles: Record<string, string> = {};
  for (const cog of selectedCognitives) {
    let relativePath: string;
    if (tempDir && cog.path === tempDir) {
      relativePath = cognitiveFile;
    } else if (tempDir && cog.path.startsWith(tempDir + sep)) {
      relativePath =
        cog.path
          .slice(tempDir.length + 1)
          .split(sep)
          .join('/') + `/${cognitiveFile}`;
    } else {
      continue; // Local path - skip telemetry
    }
    telemetryFiles[cog.name] = relativePath;
  }

  const items: InstallItem[] = selectedCognitives.map((cog) => ({
    installName: cog.name,
    displayName: getCognitiveDisplayName(cog),
    description: cog.description,
    sourceIdentifier: normalizedSource ?? source,
    providerId: parsed.type,
    sourceUrl: parsed.url,
    installFn: (agent: AgentType, opts: { global: boolean; mode: InstallMode }) =>
      installCognitiveForAgent(cog, agent, { ...opts, cognitiveType }),
  }));

  const lockEntries: LockEntry[] = [];
  if (normalizedSource) {
    for (const cog of selectedCognitives) {
      lockEntries.push(
        buildLockEntry({
          name: getCognitiveDisplayName(cog),
          source: normalizedSource,
          sourceType: parsed.type,
          sourceUrl: parsed.url,
          cognitivePath: telemetryFiles[cog.name],
          cognitiveType,
        })
      );
    }
  }

  // Determine telemetry privacy check behavior
  let telemetrySource = normalizedSource ?? '';
  if (normalizedSource) {
    const ownerRepo = parseOwnerRepo(normalizedSource);
    if (ownerRepo) {
      // For GitHub repos, check privacy — only send if public
      const isPrivate = await isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
      if (isPrivate !== false) {
        // Private or unknown — skip telemetry entirely
        telemetrySource = '';
      }
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
      skillFiles: telemetryFiles,
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
    logger.log(`    ${pc.cyan('npx cognit add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    logger.line();
    logger.dim('  Example:');
    logger.log(`    ${pc.cyan('npx cognit add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    logger.line();
    process.exit(1);
  }

  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  logger.intro(' cognit ');

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = logger.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.succeed(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.nameFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.nameFilter)}` : ''}`
    );

    // Direct URL cognitives (Mintlify, HuggingFace, etc.) via provider system
    if (parsed.type === 'direct-url') {
      const prepared = await resolveRemoteCognitive(parsed.url, options, spinner);
      await executeInstallFlow(prepared, options, spinner);
      return;
    }

    // Well-known cognitives from arbitrary URLs
    if (parsed.type === 'well-known') {
      const prepared = await resolveWellKnownCognitives(parsed.url, options, spinner);
      await executeInstallFlow(prepared, options, spinner);
      return;
    }

    // Git repo or local path
    let sourceDir: string;

    if (parsed.type === 'local') {
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.fail('Path not found');
        logger.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      sourceDir = parsed.localPath!;
      spinner.succeed('Local path validated');
    } else {
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      sourceDir = tempDir;
      spinner.succeed('Repository cloned');
    }

    if (parsed.nameFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.nameFilter)) {
        options.skill.push(parsed.nameFilter);
      }
    }

    const prepared = await resolveGitRepoCognitives(
      source,
      parsed,
      options,
      spinner,
      sourceDir,
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

    const findSkillsInstalled = await isCognitiveInstalled('find-skills', 'claude-code', 'skill', {
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
        logger.message(pc.dim('  npx cognit add vercel-labs/skills@find-skills -g -y --all'));
      }
    } else {
      await dismissPrompt('findSkillsPrompt');
      logger.message(
        pc.dim('You can install it later with: npx cognit add vercel-labs/skills@find-skills')
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
