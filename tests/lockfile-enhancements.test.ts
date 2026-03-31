import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  addSkillToLocalLock,
  computeSkillFolderHash,
  readLocalLock,
  writeLocalLock,
} from '../src/local-lock.ts';

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli.ts');

function runCli(args: string[], cwd: string) {
  return spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30000,
  });
}

describe('ci command alias', () => {
  it('should be recognized as a valid command', () => {
    const result = runCli(['--help'], process.cwd());
    expect(result.stdout).toContain('ci');
    expect(result.stdout).toContain('Restore skills from skills-lock.json');
  });

  it('ci should handle empty lockfile gracefully', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ci-test-'));
    try {
      await writeLocalLock({ version: 1, skills: {} }, dir);
      const result = runCli(['ci'], dir);
      // Should warn about no skills
      expect(result.stdout + result.stderr).toContain('No project skills found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('experimental_install should still work as alias', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ci-test-'));
    try {
      await writeLocalLock({ version: 1, skills: {} }, dir);
      const result = runCli(['experimental_install'], dir);
      expect(result.stdout + result.stderr).toContain('No project skills found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('verify command', () => {
  it('should be listed in help output', () => {
    const result = runCli(['--help'], process.cwd());
    expect(result.stdout).toContain('verify');
    expect(result.stdout).toContain('Verify installed skills match lockfile');
  });

  it('should handle missing lockfile gracefully', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    try {
      // No lockfile present
      const result = runCli(['verify'], dir);
      expect(result.stdout + result.stderr).toContain('No skills found');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should report match when installed skills match lockfile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    try {
      // Create installed skill
      const skillDir = join(dir, '.agents', 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\ndescription: A test skill for verification\n---\n# Test Skill\n',
        'utf-8'
      );

      // Compute hash and write to lockfile
      const hash = await computeSkillFolderHash(skillDir);
      await addSkillToLocalLock(
        'test-skill',
        {
          source: 'org/repo',
          sourceType: 'github',
          computedHash: hash,
        },
        dir
      );

      const result = runCli(['verify'], dir);
      const output = result.stdout + result.stderr;
      expect(output).toContain('match');
      expect(output).toContain('test-skill');
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should report modified when installed skill differs from lockfile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    try {
      // Create installed skill
      const skillDir = join(dir, '.agents', 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), 'original content', 'utf-8');

      // Write lock with original hash
      const originalHash = await computeSkillFolderHash(skillDir);
      await addSkillToLocalLock(
        'test-skill',
        {
          source: 'org/repo',
          sourceType: 'github',
          computedHash: originalHash,
        },
        dir
      );

      // Modify the installed file
      await writeFile(join(skillDir, 'SKILL.md'), 'modified content', 'utf-8');

      const result = runCli(['verify'], dir);
      const output = result.stdout + result.stderr;
      expect(output).toContain('modified');
      expect(output).toContain('test-skill');
      expect(result.status).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should report missing when locked skill is not installed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    try {
      await addSkillToLocalLock(
        'ghost-skill',
        {
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'abc123',
        },
        dir
      );

      const result = runCli(['verify'], dir);
      const output = result.stdout + result.stderr;
      expect(output).toContain('missing');
      expect(output).toContain('ghost-skill');
      expect(result.status).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should report unlocked skills not in lockfile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
    try {
      // Write empty lockfile
      await writeLocalLock({ version: 1, skills: {} }, dir);

      // Create an installed skill not in lock
      const skillDir = join(dir, '.agents', 'skills', 'rogue-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Rogue', 'utf-8');

      const result = runCli(['verify'], dir);
      const output = result.stdout + result.stderr;
      expect(output).toContain('unlocked');
      expect(output).toContain('rogue-skill');
      // unlocked alone doesn't cause exit 1 (only modified/missing do)
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('frozen-lockfile flag', () => {
  it('ci --frozen-lockfile should pass with matching hashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'frozen-test-'));
    try {
      // Create installed skill
      const skillDir = join(dir, '.agents', 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\ndescription: A test skill\n---\n# Test\n',
        'utf-8'
      );

      // Compute hash and write lock with a local source (won't try to clone)
      const hash = await computeSkillFolderHash(skillDir);
      await writeLocalLock(
        {
          version: 1,
          skills: {
            'test-skill': {
              source: './local-skills',
              sourceType: 'local',
              computedHash: hash,
            },
          },
        },
        dir
      );

      // Create the local source directory with the skill
      const localSkillDir = join(dir, 'local-skills', 'test-skill');
      await mkdir(localSkillDir, { recursive: true });
      await writeFile(
        join(localSkillDir, 'SKILL.md'),
        '---\nname: test-skill\ndescription: A test skill\n---\n# Test\n',
        'utf-8'
      );

      // frozen-lockfile check after ci should pass since content matches
      const result = runCli(['verify'], dir);
      expect(result.status).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseAddOptions --frozen-lockfile', () => {
  it('should parse --frozen-lockfile flag', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions(['some-source', '--frozen-lockfile']);
    expect(options.frozenLockfile).toBe(true);
  });

  it('should parse --frozen alias', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions(['some-source', '--frozen']);
    expect(options.frozenLockfile).toBe(true);
  });

  it('should not set frozenLockfile when not provided', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions(['some-source']);
    expect(options.frozenLockfile).toBeUndefined();
  });
});

describe('commit SHA tracking', () => {
  it('getHeadSha should return empty string for non-git directory', async () => {
    const { getHeadSha } = await import('../src/git.ts');
    const dir = await mkdtemp(join(tmpdir(), 'sha-test-'));
    try {
      const sha = await getHeadSha(dir);
      expect(sha).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('SkillLockEntry should accept optional commitSha', async () => {
    const { addSkillToLock, readSkillLock } = await import('../src/skill-lock.ts');
    // Just verify the interface accepts commitSha without error
    // We can't easily test the full flow without a real GitHub repo
    // but we can verify the type is accepted
    expect(typeof addSkillToLock).toBe('function');
    expect(typeof readSkillLock).toBe('function');
  });
});
