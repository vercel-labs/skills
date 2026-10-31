import { createWriteStream, type Stats } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import { ArchiveValidationError, readZipArchive } from './archive.ts';
import { parseFrontmatter } from './frontmatter.ts';

const DEFAULT_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_EXTRACT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_EXTRACT_MAX_FILES = 1000;
const FETCH_TIMEOUT_MS = 30_000;

interface DownloadLimits {
  downloadMaxBytes: number;
  extractMaxBytes: number;
  extractMaxFiles: number;
}

interface ExtractState {
  bytes: number;
  entries: number;
}

export interface DownloadedSource {
  rootDir: string;
  tempDir: string;
  kind: 'skill-md' | 'archive';
}

export interface DownloadSourceOptions {
  downloadMaxBytes?: number;
  extractMaxBytes?: number;
  extractMaxFiles?: number;
}

function positiveIntegerOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getDownloadLimits(options: DownloadSourceOptions): DownloadLimits {
  return {
    downloadMaxBytes: getPositiveIntegerEnv(
      'SKILLS_DOWNLOAD_MAX_BYTES',
      positiveIntegerOr(options.downloadMaxBytes, DEFAULT_DOWNLOAD_MAX_BYTES)
    ),
    extractMaxBytes: getPositiveIntegerEnv(
      'SKILLS_EXTRACT_MAX_BYTES',
      positiveIntegerOr(options.extractMaxBytes, DEFAULT_EXTRACT_MAX_BYTES)
    ),
    extractMaxFiles: getPositiveIntegerEnv(
      'SKILLS_EXTRACT_MAX_FILES',
      positiveIntegerOr(options.extractMaxFiles, DEFAULT_EXTRACT_MAX_FILES)
    ),
  };
}

function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

function validateArchivePath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.endsWith('/')) return normalized;
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

function incrementEntry(state: ExtractState, size: number, limits: DownloadLimits): void {
  state.entries += 1;
  if (state.entries > limits.extractMaxFiles) {
    throw new ArchiveValidationError(
      `Archive contains too many files (${state.entries}). Maximum is ${limits.extractMaxFiles}. Set SKILLS_EXTRACT_MAX_FILES to override.`
    );
  }

  state.bytes += size;
  if (state.bytes > limits.extractMaxBytes) {
    throw new ArchiveValidationError(
      `Archive extracts to more than ${limits.extractMaxBytes} bytes. Set SKILLS_EXTRACT_MAX_BYTES to override.`
    );
  }
}

async function downloadToFile(
  url: string,
  targetFile: string,
  limits: DownloadLimits
): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > limits.downloadMaxBytes) {
      throw new Error(
        `Download is larger than ${limits.downloadMaxBytes} bytes. Set SKILLS_DOWNLOAD_MAX_BYTES to override.`
      );
    }
  }

  if (!response.body) {
    throw new Error('Download response has no body');
  }

  let downloaded = 0;
  const limitStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      downloaded += chunk.byteLength;
      if (downloaded > limits.downloadMaxBytes) {
        throw new Error(
          `Download is larger than ${limits.downloadMaxBytes} bytes. Set SKILLS_DOWNLOAD_MAX_BYTES to override.`
        );
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(response.body.pipeThrough(limitStream), createWriteStream(targetFile));
}

async function isValidSkillMarkdown(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const { data } = parseFrontmatter(content);
    return typeof data.name === 'string' && typeof data.description === 'string';
  } catch {
    return false;
  }
}

async function extractZip(
  filePath: string,
  extractDir: string,
  limits: DownloadLimits
): Promise<void> {
  const files = readZipArchive(await readFile(filePath), {
    maxExtractedBytes: limits.extractMaxBytes,
    maxEntries: limits.extractMaxFiles,
  });

  for (const [path, contents] of files) {
    const targetPath = join(extractDir, path);
    if (!isPathSafe(extractDir, targetPath)) {
      throw new ArchiveValidationError(`Archive contains unsafe path: ${path}`);
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents);
  }
}

function getTarEntryType(entry: tar.ReadEntry | Stats): string {
  if (entry instanceof tar.ReadEntry) {
    return entry.type;
  }
  if (entry.isFile()) return 'File';
  if (entry.isDirectory()) return 'Directory';
  return '';
}

function isTarEntryFile(entry: tar.ReadEntry | Stats): boolean {
  const type = getTarEntryType(entry);
  return type === 'File' || type === 'OldFile' || type === 'ContiguousFile';
}

async function extractTar(
  filePath: string,
  extractDir: string,
  limits: DownloadLimits
): Promise<void> {
  const state: ExtractState = { bytes: 0, entries: 0 };
  let validationError: ArchiveValidationError | undefined;

  await tar.x({
    strict: true,
    filter(entryPath, entry) {
      if (validationError) return false;

      try {
        const safePath = validateArchivePath(entryPath);
        if (safePath === null) {
          throw new ArchiveValidationError(`Archive contains unsafe path: ${entryPath}`);
        }

        const targetPath = join(extractDir, safePath);
        if (!isPathSafe(extractDir, targetPath)) {
          throw new ArchiveValidationError(`Archive contains unsafe path: ${entryPath}`);
        }

        incrementEntry(state, entry.size, limits);

        if (isTarEntryFile(entry)) {
          return true;
        }

        return getTarEntryType(entry) === 'Directory';
      } catch (error) {
        if (error instanceof ArchiveValidationError) {
          validationError = error;
          return false;
        }
        throw error;
      }
    },
    cwd: extractDir,
    preservePaths: false,
    noChmod: true,
    file: filePath,
  });

  if (validationError) {
    throw validationError;
  }
}

async function tryExtractArchive(
  filePath: string,
  extractDir: string,
  limits: DownloadLimits
): Promise<boolean> {
  const header = await readFile(filePath).then((buffer) => buffer.subarray(0, 512));
  const isZip = header[0] === 0x50 && header[1] === 0x4b;
  const isGzip = header[0] === 0x1f && header[1] === 0x8b;

  try {
    if (isZip) {
      await extractZip(filePath, extractDir, limits);
      return true;
    }

    if (isGzip) {
      await extractTar(filePath, extractDir, limits);
      return true;
    }

    await extractTar(filePath, extractDir, limits);
    return true;
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(extractDir, { recursive: true });
    if (error instanceof ArchiveValidationError) {
      throw error;
    }
    return false;
  }
}

async function getSingleTopLevelDirectory(dir: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => entry.name !== '__MACOSX');
  if (visibleEntries.length !== 1 || !visibleEntries[0]!.isDirectory()) return null;
  return join(dir, visibleEntries[0]!.name);
}

export async function downloadSource(
  url: string,
  options: DownloadSourceOptions = {}
): Promise<DownloadedSource> {
  const limits = getDownloadLimits(options);
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-download-'));
  const downloadedFile = join(tempDir, 'source.download');
  const extractDir = join(tempDir, 'extract');

  try {
    await downloadToFile(url, downloadedFile, limits);

    const downloadedStats = await stat(downloadedFile);
    if (downloadedStats.size === 0) {
      throw new Error('Downloaded URL is empty');
    }

    if (await isValidSkillMarkdown(downloadedFile)) {
      const skillDir = join(tempDir, 'skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), await readFile(downloadedFile));
      return { rootDir: skillDir, tempDir, kind: 'skill-md' };
    }

    await mkdir(extractDir, { recursive: true });
    if (await tryExtractArchive(downloadedFile, extractDir, limits)) {
      const rootDir = (await getSingleTopLevelDirectory(extractDir)) ?? extractDir;
      return { rootDir, tempDir, kind: 'archive' };
    }

    throw new Error('Downloaded URL is not a valid SKILL.md file or supported archive');
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
