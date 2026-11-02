import { createHash } from 'crypto';
import { lstat, readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';

// Mirrors skills.sh's skill snapshot hash (`skillsComputedHash`), which is what
// pack pins and security audits refer to. Keep in sync with the leaderboard's
// lib/telemetry/github-tarball.ts (file filter) and lib/telemetry/blob.ts
// (hashSkillFiles). A mismatch is safe: callers treat it as "not the pinned
// content" and fall back.
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

/** skills.sh `skillsComputedHash` of the skill folder at `dir`. */
export async function computeSkillsShContentHash(dir: string): Promise<string> {
  const files: Array<{ path: string; contents: string }> = [];
  await collect(dir, dir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.contents}\0`, 'utf8');
  return hash.digest('hex');
}
