import { readdir, readFile, realpath, stat } from 'fs/promises';
import { join, sep } from 'path';
import { createHash } from 'crypto';

/**
 * The content hash recorded as `computedHash` in skills-lock.json (v2).
 * The algorithm is documented in README.md ("Lock file content hash"). Change
 * it only with a lock version bump.
 */

const EXCLUDE_FILES = new Set(['metadata.json']);
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

/** Whether the installer leaves out an entry named `name`. */
export function isExcluded(name: string, isDirectory: boolean = false): boolean {
  if (EXCLUDE_FILES.has(name)) return true;
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  return false;
}

/** isExcluded() for a file path relative to the skill folder. */
export function isExcludedPath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  return parts.some((part, index) => isExcluded(part, index < parts.length - 1));
}

export interface HashedFile {
  /** Path relative to the skill folder, `/`-separated. */
  path: string;
  content: Buffer | string;
}

/**
 * Hash a skill's files: sorted by the UTF-8 bytes of their paths, each framed
 * as `path NUL length NUL content`, with CRLF turned into LF in text files.
 */
export function hashSkillFiles(files: HashedFile[]): string {
  const entries = files.map((file) => ({
    path: Buffer.from(file.path.split('\\').join('/'), 'utf-8'),
    content: normalizeLineEndings(
      typeof file.content === 'string' ? Buffer.from(file.content, 'utf-8') : file.content
    ),
  }));
  entries.sort((a, b) => Buffer.compare(a.path, b.path));

  const hash = createHash('sha256');
  for (const { path, content } of entries) {
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

/** A file is text when it has no NUL byte; text files get CRLF replaced by LF. */
function normalizeLineEndings(content: Buffer): Buffer {
  if (content.includes(0) || !content.includes('\r\n')) return content;
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

/**
 * Hash the files the installer would write for the skill folder at `skillDir`:
 * excluded names are skipped, symlinks count as the content they point to, and
 * links that are broken, cyclic, or leave the folder are left out.
 */
export async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const root = await realpath(skillDir);
  const files: HashedFile[] = [];
  await collectFiles(skillDir, '', root, new Set(), files);
  return hashSkillFiles(files);
}

async function collectFiles(
  dir: string,
  prefix: string,
  root: string,
  ancestors: ReadonlySet<string>,
  results: HashedFile[]
): Promise<void> {
  const realDir = await realpath(dir);
  if (ancestors.has(realDir)) return;
  const branch = new Set(ancestors).add(realDir);

  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (isExcluded(entry.name, entry.isDirectory())) return;
      const fullPath = join(dir, entry.name);
      const path = prefix + entry.name;
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        const target = await realpath(fullPath).catch(() => null);
        if (!target || (target !== root && !target.startsWith(root + sep))) return;
        isDirectory = (await stat(target)).isDirectory();
        if (isDirectory && isExcluded(entry.name, true)) return;
      } else if (!isDirectory && !entry.isFile()) {
        return;
      }
      if (isDirectory) {
        await collectFiles(fullPath, `${path}/`, root, branch, results);
      } else {
        results.push({ path, content: await readFile(fullPath) });
      }
    })
  );
}
