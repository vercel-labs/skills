import { createHash } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';

const EXCLUDED_FILES = new Set(['metadata.json']);
const EXCLUDED_DIRS = new Set(['.git']);

function isTrackedEntry(name: string, isDirectory: boolean): boolean {
  if (EXCLUDED_FILES.has(name)) return false;
  if (name.startsWith('_')) return false;
  if (isDirectory && EXCLUDED_DIRS.has(name)) return false;
  return true;
}

export async function computeTrackedSkillDirectoryHash(skillDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  await collectTrackedFiles(skillDir, skillDir, files);

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

export function computeTextFileHash(files: Iterable<[string, string]>): string {
  const sortedFiles = Array.from(files).sort(([left], [right]) => left.localeCompare(right));
  const hash = createHash('sha256');

  for (const [filePath, content] of sortedFiles) {
    hash.update(filePath);
    hash.update(content, 'utf-8');
  }

  return hash.digest('hex');
}

async function collectTrackedFiles(
  baseDir: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: Buffer }>
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => isTrackedEntry(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await collectTrackedFiles(baseDir, fullPath, results);
          return;
        }

        if (!entry.isFile()) {
          return;
        }

        const content = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split('\\').join('/');
        results.push({ relativePath, content });
      })
  );
}
