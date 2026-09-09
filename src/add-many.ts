import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { AddJsonResult, AddOptions } from './add.ts';
import { parseSource } from './source-parser.ts';
import { LOCK_ENTRIES_FILE_ENV, mergeLockEntriesFiles } from './skill-lock.ts';
import { LOCAL_LOCK_ENTRIES_FILE_ENV, mergeLocalLockEntriesFiles } from './local-lock.ts';
import { stripTerminalEscapes } from './sanitize.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Sources installed at once. Each is one clone or snapshot download plus a tree fetch. */
const MAX_CONCURRENCY = 6;

/**
 * One repository (or path) to install from, merged from every command-line
 * token that names it. `skills` is undefined when a token asked for the whole
 * source; otherwise it is the union of the `@skill[,skill]` selections.
 */
export interface SourceGroup {
  /** First token naming this source, passed to the child `add` as typed. */
  token: string;
  /** Token without its `@skill` suffix, for display. */
  label: string;
  skills?: string[];
}

/** Outcome of one child `add <source> --json` run. */
export interface SourceResult {
  label: string;
  exitCode: number;
  entries: AddJsonResult[];
}

/**
 * Group the sources of a multi-source `add` by repository.
 *
 * Skill selection rides on the token (`owner/repo@a,b`, upstream's `@skill`
 * syntax plus comma lists), so tokens that resolve to the same repository at
 * the same ref merge into one group and one clone.
 */
export function groupSources(sources: string[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const token of sources) {
    const parsed = parseSource(token);
    const key = JSON.stringify([
      parsed.type,
      parsed.url,
      parsed.localPath,
      parsed.ref,
      parsed.subpath,
    ]);
    const skills = parsed.skillFilter?.split(',').filter(Boolean);
    const label =
      parsed.skillFilter && token.endsWith(`@${parsed.skillFilter}`)
        ? token.slice(0, -(parsed.skillFilter.length + 1))
        : token;

    const group = groups.get(key);
    if (!group) {
      groups.set(key, { token, label, ...(skills && skills.length > 0 ? { skills } : {}) });
      continue;
    }
    if (!skills || skills.length === 0) {
      // A token without a selection asks for everything from this source.
      group.skills = undefined;
      group.token = token;
      group.label = label;
    } else if (group.skills) {
      for (const skill of skills) if (!group.skills.includes(skill)) group.skills.push(skill);
    }
  }
  return [...groups.values()];
}

/** Argument list for one child install. Exported for tests. */
export function buildChildArgs(group: SourceGroup, options: AddOptions): string[] {
  const args = ['add', group.token];
  if (options.list) args.push('--list');
  else args.push('--json', '-y');
  // The child merges the token's own @skill selection with --skill, so passing
  // the whole union is harmless and covers skills named by the other tokens.
  if (group.skills && group.skills.length > 0) args.push('--skill', ...group.skills);
  if (options.global) args.push('-g');
  if (options.agent && options.agent.length > 0) args.push('--agent', ...options.agent);
  if (options.subagent && options.subagent.length > 0) args.push('--subagent', ...options.subagent);
  if (options.all) args.push('--all');
  if (options.copy) args.push('--copy');
  if (options.fullDepth) args.push('--full-depth');
  if (options.metadata) args.push('--metadata', options.metadata);
  return args;
}

/**
 * `skills add` with several sources.
 *
 * `runAdd` is written around one source: it owns the terminal (clack
 * spinners, prompts, a monkey-patched stdout in json mode) and exits the
 * process on failure, so sources cannot share it in-process. Like `update`,
 * each source runs as a child `add <source> --json -y`; the parent collects
 * the JSON, folds the children's lock entries into the lock file once, and
 * prints either one merged JSON array or a one-line-per-source summary.
 * Several sources are therefore always non-interactive.
 */
export async function runAddMany(sources: string[], options: AddOptions): Promise<void> {
  const jsonMode = options.json === true;

  if (options.skill && options.skill.length > 0) {
    // With one source --skill has an obvious owner; with several it does not,
    // and guessing (first? last? all?) is exactly the ambiguity to avoid.
    console.error(
      'Error: --skill is ambiguous with several sources. Name skills on the source instead: ' +
        `owner/repo@${options.skill.join(',')}`
    );
    if (jsonMode) console.log('[]');
    process.exit(1);
  }

  const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
  if (!existsSync(cliEntry)) {
    console.error(`CLI entrypoint not found at ${cliEntry}`);
    process.exit(1);
  }

  const groups = groupSources(sources);

  if (options.list) {
    // Listing is read-only and human-oriented: run the sources one after
    // another with the terminal attached instead of collecting JSON.
    for (const group of groups) {
      const code = await new Promise<number>((resolve) => {
        spawn(process.execPath, [cliEntry, ...buildChildArgs(group, options)], {
          stdio: 'inherit',
          shell: false,
        }).on('close', (c) => resolve(c ?? 1));
      });
      if (code !== 0) process.exitCode = 1;
    }
    return;
  }

  const started = Date.now();
  const spinner = !jsonMode && process.stdout.isTTY ? p.spinner() : null;
  spinner?.start(`Installing from ${groups.length} sources…`);

  const workDir = await mkdtemp(join(tmpdir(), 'skills-add-'));
  const results: SourceResult[] = new Array(groups.length);
  try {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < groups.length) {
        const index = next++;
        results[index] = await runChild(cliEntry, groups[index]!, options, workDir, index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, groups.length) }, worker));

    await mergeLockEntriesFiles(groups.map((_, i) => globalEntriesFile(workDir, i)));
    await mergeLocalLockEntriesFiles(groups.map((_, i) => projectEntriesFile(workDir, i)));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !sourceSucceeded(r));
  spinner?.stop(
    failed.length === 0
      ? `Installed from ${results.length} sources`
      : `${failed.length} of ${results.length} sources failed`
  );

  if (jsonMode) {
    // Children already report the normalized source on installed entries; the
    // label fills in for failures so every entry is attributable.
    const entries = results.flatMap((r) => r.entries.map((e) => ({ source: r.label, ...e })));
    console.log(JSON.stringify(entries, null, 2));
  } else {
    printSummary(results, Date.now() - started);
  }

  if (failed.length > 0) process.exitCode = 1;
}

function globalEntriesFile(workDir: string, index: number): string {
  return join(workDir, `global-${index}.jsonl`);
}

function projectEntriesFile(workDir: string, index: number): string {
  return join(workDir, `project-${index}.jsonl`);
}

function runChild(
  cliEntry: string,
  group: SourceGroup,
  options: AddOptions,
  workDir: string,
  index: number
): Promise<SourceResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliEntry, ...buildChildArgs(group, options)], {
      // stdin is closed: a child that would prompt fails with the non-TTY
      // message instead of hanging.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        [LOCK_ENTRIES_FILE_ENV]: globalEntriesFile(workDir, index),
        [LOCAL_LOCK_ENTRIES_FILE_ENV]: projectEntriesFile(workDir, index),
      },
      // Sources come straight from the command line; argv keeps them inert.
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({
        label: group.label,
        exitCode: 1,
        entries: [{ status: 'failed', error: error.message }],
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 1;
      const fallbackError = lastLines(stderr) || `add exited with code ${exitCode}`;
      let entries = parseJsonArray(stdout);
      if (!entries) {
        entries = [{ status: 'failed', error: fallbackError }];
      } else if (exitCode !== 0 && !entries.some((e) => e.status === 'failed')) {
        entries.push({ status: 'failed', error: fallbackError });
      }
      resolve({ label: group.label, exitCode, entries });
    });
  });
}

function parseJsonArray(text: string): AddJsonResult[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as AddJsonResult[]) : null;
  } catch {
    return null;
  }
}

function lastLines(text: string, count = 3): string {
  return stripTerminalEscapes(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(' ');
}

function sourceSucceeded(result: SourceResult): boolean {
  return result.exitCode === 0 && !result.entries.some((e) => e.status === 'failed');
}

/** One line per source, then a total. Names and errors are remote content, so they are sanitized. */
function printSummary(results: SourceResult[], elapsedMs: number): void {
  const clean = (text: string | undefined): string => stripTerminalEscapes(text ?? '');
  let installedCount = 0;
  let okSources = 0;

  for (const result of results) {
    const label = clean(result.label);
    const installed = result.entries
      .filter((e) => e.status === 'installed')
      .map((e) => clean(e.name));
    const failures = result.entries.filter((e) => e.status === 'failed');
    const skipped = result.entries.filter((e) => e.status === 'skipped');

    if (sourceSucceeded(result)) {
      okSources++;
      installedCount += installed.length;
      console.log(
        `${pc.green('+')} ${label}: ${installed.length > 0 ? installed.join(', ') : pc.dim('nothing installed')}`
      );
    } else {
      const reason = failures.map((f) => clean(f.error) || 'Installation failed').join('; ');
      console.log(`${pc.red('FAILED')} ${label}: ${reason}`);
      if (installed.length > 0) {
        installedCount += installed.length;
        console.log(`  ${pc.dim('installed:')} ${installed.join(', ')}`);
      }
    }
    for (const entry of skipped) {
      console.log(`  ${pc.yellow('skipped')} ${clean(entry.name)}: ${clean(entry.reason)}`);
    }
  }

  const failedSources = results.length - okSources;
  const seconds = (elapsedMs / 1000).toFixed(1);
  console.log(
    `Installed ${installedCount} skill${installedCount === 1 ? '' : 's'} from ${okSources} of ${results.length} sources in ${seconds}s` +
      (failedSources > 0 ? pc.red(` (${failedSources} failed)`) : '')
  );
}
