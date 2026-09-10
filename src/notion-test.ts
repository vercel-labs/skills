import * as p from '@clack/prompts';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { downloadSource, type DownloadedSource } from './download-source.ts';
import { cleanupTempDir } from './git.ts';
import { sanitizeName } from './installer.ts';
import { sanitizeMetadata, stripTerminalEscapes } from './sanitize.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { discoverSkills } from './skills.ts';

const NOTION_API_VERSION = '2026-03-11';
const NTN_TIMEOUT_MS = 30_000;
const NTN_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const NOTION_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;
const NOTION_EXTRACT_MAX_BYTES = 100 * 1024 * 1024;
const NOTION_EXTRACT_MAX_FILES = 5000;

export interface NotionPack {
  id: string;
  name: string;
  description: string;
  version_id: string;
}

interface NotionPackListResponse {
  results: NotionPack[];
  next_cursor: string | null;
  has_more: boolean;
}

interface NotionDirectory {
  id: string;
  version_id: string;
  url: string;
}

export interface PreparedNotionPackSource {
  rootDir: string;
  tempDir: string;
  packCount: number;
  skillCount: number;
}

export interface PreparedNotionSkillSource {
  rootDir: string;
  tempDir: string;
}

export interface NotionPackSelectorOptions {
  yes?: boolean;
  list?: boolean;
  skill?: string[];
}

export type NtnRunner = (args: string[]) => Promise<string>;

interface FetchNotionPacksOptions {
  runNtn?: NtnRunner;
}

interface PrepareNotionPackSourceOptions extends NotionPackSelectorOptions {
  runNtn?: NtnRunner;
  download?: (url: string) => Promise<DownloadedSource>;
  discover?: typeof discoverSkills;
}

interface PrepareNotionSkillSourceOptions {
  runNtn?: NtnRunner;
  download?: (url: string) => Promise<DownloadedSource>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion Agent Plugins response is missing ${field}`);
  }
  return value;
}

function optionalMetadata(value: unknown, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new Error(`Notion Agent Plugins response has an invalid ${field}`);
  }
  return sanitizeMetadata(value);
}

function parsePack(value: unknown): NotionPack {
  if (!isRecord(value)) {
    throw new Error('Notion Agent Plugins response contains an invalid pack');
  }

  return {
    id: assertString(value.id, 'pack.id'),
    name: sanitizeMetadata(assertString(value.name, 'pack.name')),
    description: optionalMetadata(value.description, 'pack.description'),
    version_id: assertString(value.version_id, 'pack.version_id'),
  };
}

function parsePackList(value: unknown): NotionPackListResponse {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new Error('Notion Agent Plugins list response is invalid');
  }
  if (typeof value.has_more !== 'boolean') {
    throw new Error('Notion Agent Plugins list response is missing has_more');
  }

  const nextCursor = value.next_cursor;
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    throw new Error('Notion Agent Plugins list response has an invalid next_cursor');
  }

  return {
    results: value.results.map(parsePack),
    next_cursor: nextCursor,
    has_more: value.has_more,
  };
}

function parseDirectory(value: unknown, label: string): NotionDirectory {
  if (!isRecord(value)) {
    throw new Error(`Notion ${label} directory response is invalid`);
  }

  return {
    id: assertString(value.id, `${label} directory id`),
    version_id: assertString(value.version_id, `${label} directory version_id`),
    url: assertString(value.url, `${label} directory url`),
  };
}

function downloadNotionDirectory(url: string): Promise<DownloadedSource> {
  return downloadSource(url, {
    downloadMaxBytes: NOTION_DOWNLOAD_MAX_BYTES,
    extractMaxBytes: NOTION_EXTRACT_MAX_BYTES,
    extractMaxFiles: NOTION_EXTRACT_MAX_FILES,
  });
}

function debugNtn(args: string[]): void {
  if (process.env.SKILLS_DEBUG === '1') {
    console.error(`[notion] ntn ${args.join(' ')}`);
  }
}

export async function runNtnApi(args: string[]): Promise<string> {
  debugNtn(args);
  return new Promise((resolve, reject) => {
    const child = spawn('ntn', args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const fail = (message: string): void => finish(() => reject(new Error(message)));
    const append = (chunks: Buffer[], chunk: Buffer): void => {
      outputBytes += chunk.length;
      if (outputBytes > NTN_MAX_BUFFER_BYTES) {
        child.kill('SIGTERM');
        fail('ntn api output exceeded 10 MiB');
        return;
      }
      chunks.push(chunk);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      fail(`ntn api timed out after ${NTN_TIMEOUT_MS / 1000} seconds`);
    }, NTN_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => append(stdoutChunks, chunk));
    child.stderr.on('data', (chunk: Buffer) => append(stderrChunks, chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        fail('Notion CLI (ntn) is required. Install it, then run `ntn login`.');
        return;
      }
      fail(`Unable to start ntn: ${stripTerminalEscapes(error.message)}`);
    });
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = stripTerminalEscapes(Buffer.concat(stderrChunks).toString('utf8')).trim();
      if (code === 0) {
        finish(() => resolve(stdout));
        return;
      }
      fail(`ntn api failed${stderr ? `: ${stderr}` : ` with exit code ${code ?? 'unknown'}`}`);
    });
  });
}

export async function fetchNotionPacks(
  options: FetchNotionPacksOptions = {}
): Promise<NotionPack[]> {
  const runNtn = options.runNtn ?? runNtnApi;
  const packs: NotionPack[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const args = ['api', '/v1/ai/plugins', 'page_size==100'];
    if (cursor) args.push(`start_cursor==${cursor}`);
    args.push('--notion-version', NOTION_API_VERSION);

    let value: unknown;
    try {
      value = JSON.parse(await runNtn(args)) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error('ntn returned invalid JSON for the Notion packs list');
      }
      throw error;
    }

    const page = parsePackList(value);
    packs.push(...page.results);

    if (!page.has_more) break;
    if (!page.next_cursor || seenCursors.has(page.next_cursor)) {
      throw new Error('Notion Agent Plugins pagination returned an invalid cursor');
    }
    cursor = page.next_cursor;
    seenCursors.add(cursor);
  } while (cursor);

  return packs;
}

export async function fetchNotionPackDirectory(
  pack: NotionPack,
  options: FetchNotionPacksOptions = {}
): Promise<NotionDirectory> {
  const runNtn = options.runNtn ?? runNtnApi;
  const path = `/v1/ai/plugins/${encodeURIComponent(pack.id)}`;
  const args = ['api', path, '--notion-version', NOTION_API_VERSION];

  let value: unknown;
  try {
    value = JSON.parse(await runNtn(args)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`ntn returned invalid JSON for Notion pack ${JSON.stringify(pack.name)}`);
    }
    throw error;
  }

  const directory = parseDirectory(value, 'pack');
  if (directory.id !== pack.id || directory.version_id !== pack.version_id) {
    throw new Error(
      `Notion pack ${JSON.stringify(pack.name)} changed while preparing installation`
    );
  }
  return directory;
}

export function isNotionSource(source: string): boolean {
  return source.toLowerCase() === 'notion';
}

const NOTION_HOSTNAME = /(^|\.)notion\.(so|com)$/;
const NOTION_PAGE_ID =
  /(?:^|-)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function formatPageId(rawId: string): string {
  const hex = rawId.replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Recognize a Notion page URL and return its page ID, e.g.
 * https://app.notion.com/p/team/Capture-meeting-decisions-c169bd0a…  ->  c169bd0a-…
 * Returns null for anything that is not a Notion page URL so the caller can
 * fall through to the ordinary git/download source handling.
 */
export function parseNotionSkillUrl(source: string): string | null {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!NOTION_HOSTNAME.test(url.hostname.toLowerCase())) return null;

  const lastSegment = url.pathname.split('/').filter(Boolean).pop();
  if (!lastSegment) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    decoded = lastSegment;
  }

  const match = decoded.toLowerCase().match(NOTION_PAGE_ID);
  return match ? formatPageId(match[1]!) : null;
}

export async function fetchNotionSkillDirectory(
  pageId: string,
  options: FetchNotionPacksOptions = {}
): Promise<NotionDirectory> {
  const runNtn = options.runNtn ?? runNtnApi;
  const path = `/v1/ai/skills/${encodeURIComponent(pageId)}`;
  const args = ['api', path, '--notion-version', NOTION_API_VERSION];

  let value: unknown;
  try {
    value = JSON.parse(await runNtn(args)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`ntn returned invalid JSON for Notion skill ${pageId}`);
    }
    throw error;
  }

  return parseDirectory(value, 'skill');
}

/**
 * Download a single Notion skill directory. The archive holds one top-level
 * directory with SKILL.md, so the extracted root is handed to the normal
 * install flow as a local source.
 */
export async function prepareNotionSkillSource(
  pageId: string,
  options: PrepareNotionSkillSourceOptions = {}
): Promise<PreparedNotionSkillSource> {
  const download = options.download ?? downloadNotionDirectory;
  const spinner = p.spinner();
  spinner.start('Fetching Notion skill with ntn…');

  try {
    const directory = await fetchNotionSkillDirectory(pageId, { runNtn: options.runNtn });
    const downloaded = await download(directory.url);
    spinner.stop(`Downloaded Notion skill ${pc.dim(pageId)}`);
    return { rootDir: downloaded.rootDir, tempDir: downloaded.tempDir };
  } catch (error) {
    spinner.stop(pc.red('Failed to prepare Notion skill'));
    throw error;
  }
}

function normalizeSelector(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function filterPacks(packs: NotionPack[], selectors: string[]): NotionPack[] {
  if (selectors.includes('*')) return packs;
  const normalized = new Set(selectors.map(normalizeSelector));
  return packs.filter(
    (pack) => normalized.has(normalizeSelector(pack.name)) || normalized.has(pack.id.toLowerCase())
  );
}

function sortedPacks(packs: NotionPack[]): NotionPack[] {
  return [...packs].sort((a, b) => a.name.localeCompare(b.name));
}

function printAvailablePacks(packs: NotionPack[]): void {
  console.log();
  p.log.step(pc.bold('Available Notion packs'));
  for (const pack of sortedPacks(packs)) {
    p.log.message(pc.cyan(pack.name));
    if (pack.description) p.log.message(`  ${pc.dim(pack.description)}`);
  }
}

export async function prepareNotionPackSource(
  options: PrepareNotionPackSourceOptions = {}
): Promise<PreparedNotionPackSource | null> {
  const spinner = p.spinner();
  spinner.start('Fetching Notion packs with ntn…');

  let packs: NotionPack[];
  try {
    packs = await fetchNotionPacks({ runNtn: options.runNtn });
  } catch (error) {
    spinner.stop(pc.red('Failed to load Notion packs'));
    throw error;
  }

  spinner.stop(`Found ${pc.green(packs.length)} Notion pack${packs.length === 1 ? '' : 's'}`);
  if (packs.length === 0) {
    throw new Error('Notion returned no packs for the authenticated workspace');
  }

  if (options.list) {
    printAvailablePacks(packs);
    p.outro(pc.dim('Select a pack by running the command without --list.'));
    return null;
  }

  let selectedPacks: NotionPack[];
  if (options.skill && options.skill.length > 0) {
    selectedPacks = filterPacks(packs, options.skill);
    if (selectedPacks.length === 0) {
      throw new Error(`No matching Notion packs found for: ${options.skill.join(', ')}`);
    }
  } else if (options.yes || !process.stdin.isTTY) {
    selectedPacks = packs;
  } else {
    const selected = await searchMultiselect({
      message: `Select Notion packs to install ${pc.dim('(space to toggle)')}`,
      items: sortedPacks(packs).map((pack) => ({
        value: pack,
        label: pack.name,
        detail: pack.description || 'Notion plugin pack',
      })),
      required: true,
      maxVisible: 20,
      searchable: false,
      showDetail: true,
      showSelectedSummary: false,
    });

    if (typeof selected === 'symbol') {
      p.cancel('Selection cancelled');
      return null;
    }
    selectedPacks = selected as NotionPack[];
  }

  p.note(
    selectedPacks.map((pack) => pc.cyan(pack.name)).join('\n'),
    `Selected ${selectedPacks.length} Notion pack${selectedPacks.length === 1 ? '' : 's'}`
  );

  const stagingDir = await mkdtemp(join(tmpdir(), 'skills-notion-'));
  const packsDir = join(stagingDir, 'packs');
  const manifestPlugins: Array<{ name: string; source: string; skills: string[] }> = [];
  const download = options.download ?? downloadNotionDirectory;
  const discover = options.discover ?? discoverSkills;
  let skillCount = 0;

  spinner.start('Preparing selected Notion packs…');
  try {
    await mkdir(packsDir, { recursive: true });

    for (const [index, pack] of selectedPacks.entries()) {
      let downloaded: DownloadedSource | null = null;
      try {
        const directory = await fetchNotionPackDirectory(pack, { runNtn: options.runNtn });
        downloaded = await download(directory.url);
        const skills = await discover(downloaded.rootDir, undefined, {
          includeInternal: true,
          fullDepth: true,
        });
        if (skills.length === 0) {
          throw new Error('pack contains no valid skills');
        }

        const directoryName = `pack-${index + 1}-${sanitizeName(pack.name).slice(0, 100)}`;
        const targetDir = join(packsDir, directoryName);
        await cp(downloaded.rootDir, targetDir, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });

        manifestPlugins.push({
          name: pack.name,
          source: `./${directoryName}`,
          skills: skills.map((skill) => {
            const skillPath = relative(downloaded!.rootDir, skill.path).split(sep).join('/');
            return skillPath ? `./${skillPath}` : './.';
          }),
        });
        skillCount += skills.length;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to prepare Notion pack ${JSON.stringify(pack.name)}: ${detail}`);
      } finally {
        if (downloaded) await cleanupTempDir(downloaded.tempDir).catch(() => {});
      }
    }

    const manifestDir = join(stagingDir, '.claude-plugin');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, 'marketplace.json'),
      `${JSON.stringify(
        {
          metadata: { pluginRoot: './packs' },
          plugins: manifestPlugins,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    spinner.stop(
      `Prepared ${pc.green(selectedPacks.length)} Notion pack${selectedPacks.length === 1 ? '' : 's'} with ${pc.green(skillCount)} skill${skillCount === 1 ? '' : 's'}`
    );
    return {
      rootDir: stagingDir,
      tempDir: stagingDir,
      packCount: selectedPacks.length,
      skillCount,
    };
  } catch (error) {
    spinner.stop(pc.red('Failed to prepare Notion packs'));
    await cleanupTempDir(stagingDir).catch(() => {});
    throw error;
  }
}
