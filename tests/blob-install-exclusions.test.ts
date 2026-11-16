import { describe, it, expect } from 'vitest';
import { chmod, mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { installBlobSkillForAgent, installSkillForAgent } from '../src/installer.ts';
import type { AgentType } from '../src/types.ts';

// The same skill as a repo folder (clone path) and as a skills.sh snapshot (blob
// path). Both installers must drop the same files: metadata.json anywhere, and
// anything under .git/, __pycache__/, or __pypackages__/.
const FILES: Record<string, string> = {
  'SKILL.md': '---\nname: parity-skill\ndescription: Install parity\n---\n# Parity\n',
  'metadata.json': '{"version":"1.0.0"}\n',
  'AGENTS.md': '# Agents\n',
  'rules/a.md': '# Rule A\n',
  'rules/metadata.json': '{}\n',
  'scripts/run.py': 'print("hi")\n',
  'scripts/__pycache__/run.cpython-312.pyc': 'bytecode',
  '__pypackages__/lib/x.py': 'x = 1\n',
  '.git/HEAD': 'ref: refs/heads/main\n',
};
const EXPECTED = ['AGENTS.md', 'SKILL.md', 'rules/a.md', 'scripts/run.py'];
const EXECUTABLES = new Set(['scripts/run.py']);

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

async function listModes(dir: string): Promise<Record<string, number>> {
  const modes: Record<string, number> = {};
  for (const path of await listFiles(dir)) modes[path] = (await stat(join(dir, path))).mode & 0o777;
  return modes;
}

async function installBoth(agent: AgentType, mode: 'copy' | 'symlink') {
  const root = await mkdtemp(join(tmpdir(), 'skills-blob-exclusions-'));
  const sourceDir = join(root, 'source', 'parity-skill');
  for (const [path, contents] of Object.entries(FILES)) {
    await mkdir(dirname(join(sourceDir, path)), { recursive: true });
    await writeFile(join(sourceDir, path), contents, 'utf-8');
    if (EXECUTABLES.has(path)) await chmod(join(sourceDir, path), 0o755);
  }

  const cloneProject = join(root, 'clone');
  const blobProject = join(root, 'blob');
  await mkdir(cloneProject);
  await mkdir(blobProject);

  const clone = await installSkillForAgent(
    { name: 'parity-skill', description: 'Install parity', path: sourceDir },
    agent,
    { cwd: cloneProject, mode, global: false }
  );
  const blob = await installBlobSkillForAgent(
    {
      installName: 'parity-skill',
      files: Object.entries(FILES).map(([path, contents]) => ({ path, contents })),
      executables: EXECUTABLES,
    },
    agent,
    { cwd: blobProject, mode, global: false }
  );
  expect(clone.success).toBe(true);
  expect(blob.success).toBe(true);

  const cloneDir = join(cloneProject, '.agents', 'skills', 'parity-skill');
  const blobDir = join(blobProject, '.agents', 'skills', 'parity-skill');
  return {
    root,
    clone: await listFiles(cloneDir),
    blob: await listFiles(blobDir),
    cloneModes: await listModes(cloneDir),
    blobModes: await listModes(blobDir),
  };
}

describe('blob install exclusions', () => {
  for (const mode of ['copy', 'symlink'] as const) {
    it(`writes the same files as a clone install (${mode})`, async () => {
      const { root, clone, blob, cloneModes, blobModes } = await installBoth('codex', mode);
      try {
        expect(clone).toEqual(EXPECTED);
        expect(blob).toEqual(clone);
        expect(blobModes['scripts/run.py']).toBe(0o755 & ~process.umask());
        expect(blobModes).toEqual(cloneModes);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
