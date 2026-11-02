import { createHash } from 'crypto';
import { lstat, readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

// Mirrors how skills.sh reads a skill folder and hashes it for pack pins.
// Keep in sync with the leaderboard's lib/telemetry/github-tarball.ts (file
// filter) and lib/pack-tree-hash.ts (hash). A mismatch is safe: callers treat
// it as "not the pinned content" and fall back to the pack's copy.
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz',
  '.mp4', '.mov', '.mp3', '.wav', '.woff', '.woff2', '.ttf', '.otf', '.wasm',
  '.parquet', '.arrow', '.pickle', '.pkl', '.npy', '.npz', '.model', '.onnx',
  '.pt', '.pth', '.h5', '.hdf5', '.safetensors',
]); // prettier-ignore

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
]);

function extname(path: string): string {
  const base = path.toLowerCase().split('/').pop() ?? '';
  const index = base.lastIndexOf('.');
  return index === -1 ? '' : base.slice(index);
}

async function collect(root: string, dir: string, out: Array<{ path: string; contents: string }>) {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    // lstat: symlinks are skipped, as skills.sh only reads regular files.
    const info = await lstat(full);
    if (info.isDirectory()) {
      if (!EXCLUDED_SEGMENTS.has(entry)) await collect(root, full, out);
    } else if (info.isFile()) {
      const path = relative(root, full).split('\\').join('/');
      if (BINARY_EXTENSIONS.has(extname(path))) continue;
      out.push({ path, contents: (await readFile(full)).toString('utf8') });
    }
  }
}

/** The skill folder's files as skills.sh reads them (text only, no symlinks). */
export async function collectSkillsShFiles(
  dir: string
): Promise<Array<{ path: string; contents: string }>> {
  const files: Array<{ path: string; contents: string }> = [];
  await collect(dir, dir, files);
  return files;
}

/**
 * skills.sh unambiguous tree hash (`skills-sh-tree-v2`), which pack pointers
 * pin. Every path and body is length-prefixed and files sort by code unit, so
 * no two different trees share an input. Keep in sync with the leaderboard's
 * lib/pack-tree-hash.ts.
 */
export function computeSkillsShTreeHash(files: Array<{ path: string; contents: string }>): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  hash.update(`skills-sh-tree-v2\n${sorted.length}\n`);
  for (const file of sorted) {
    const path = Buffer.from(file.path, 'utf8');
    const contents = Buffer.from(file.contents, 'utf8');
    hash.update(`${path.length}\n`);
    hash.update(path);
    hash.update(`${contents.length}\n`);
    hash.update(contents);
  }
  return hash.digest('hex');
}
