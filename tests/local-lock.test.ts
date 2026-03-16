import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readLocalLock,
  writeLocalLock,
  addAgentToLocalLock,
  removeAgentFromLocalLock,
  computeAgentFolderHash,
  getLocalLockPath,
} from '../src/local-lock.ts';

describe('local-lock', () => {
  describe('getLocalLockPath', () => {
    it('returns agents-lock.json in given directory', () => {
      const result = getLocalLockPath('/some/project');
      expect(result).toBe(join('/some/project', 'agents-lock.json'));
    });

    it('uses cwd when no directory given', () => {
      const result = getLocalLockPath();
      expect(result).toBe(join(process.cwd(), 'agents-lock.json'));
    });
  });

  describe('readLocalLock', () => {
    it('returns empty lock when file does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, agents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('reads a valid lock file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const content = {
          version: 1,
          agents: {
            'my-agent': {
              source: 'vercel-labs/agents',
              sourceType: 'github',
              computedHash: 'abc123',
            },
          },
        };
        await writeFile(join(dir, 'agents-lock.json'), JSON.stringify(content), 'utf-8');

        const lock = await readLocalLock(dir);
        expect(lock.version).toBe(1);
        expect(lock.agents['my-agent']).toEqual({
          source: 'vercel-labs/agents',
          sourceType: 'github',
          computedHash: 'abc123',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns empty lock for corrupted JSON (merge conflict markers)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const conflicted = `{
  "version": 1,
  "agents": {
<<<<<<< HEAD
    "agent-a": { "source": "org/repo-a", "sourceType": "github", "computedHash": "aaa" }
=======
    "agent-b": { "source": "org/repo-b", "sourceType": "github", "computedHash": "bbb" }
>>>>>>> feature-branch
  }
}`;
        await writeFile(join(dir, 'agents-lock.json'), conflicted, 'utf-8');

        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, agents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns empty lock for invalid structure (missing agents key)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await writeFile(join(dir, 'agents-lock.json'), '{"version": 1}', 'utf-8');
        const lock = await readLocalLock(dir);
        expect(lock).toEqual({ version: 1, agents: {} });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('writeLocalLock', () => {
    it('writes sorted JSON with trailing newline', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await writeLocalLock(
          {
            version: 1,
            agents: {
              'zebra-agent': {
                source: 'org/z',
                sourceType: 'github',
                computedHash: 'zzz',
              },
              'alpha-agent': {
                source: 'org/a',
                sourceType: 'github',
                computedHash: 'aaa',
              },
              'middle-agent': {
                source: 'org/m',
                sourceType: 'github',
                computedHash: 'mmm',
              },
            },
          },
          dir
        );

        const raw = await readFile(join(dir, 'agents-lock.json'), 'utf-8');
        expect(raw.endsWith('\n')).toBe(true);

        const parsed = JSON.parse(raw);
        const keys = Object.keys(parsed.agents);
        expect(keys).toEqual(['alpha-agent', 'middle-agent', 'zebra-agent']);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('addAgentToLocalLock', () => {
    it('adds a new agent to an empty lock', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addAgentToLocalLock(
          'new-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'hash123' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(lock.agents['new-agent']).toEqual({
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'hash123',
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('updates an existing agent hash', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addAgentToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'old-hash' },
          dir
        );
        await addAgentToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'new-hash' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(lock.agents['my-agent']!.computedHash).toBe('new-hash');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('preserves other agents when adding', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addAgentToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );
        await addAgentToLocalLock(
          'agent-b',
          { source: 'org/b', sourceType: 'github', computedHash: 'bbb' },
          dir
        );

        const lock = await readLocalLock(dir);
        expect(Object.keys(lock.agents)).toHaveLength(2);
        expect(lock.agents['agent-a']!.computedHash).toBe('aaa');
        expect(lock.agents['agent-b']!.computedHash).toBe('bbb');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('removeAgentFromLocalLock', () => {
    it('removes an existing agent', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        await addAgentToLocalLock(
          'my-agent',
          { source: 'org/repo', sourceType: 'github', computedHash: 'hash' },
          dir
        );

        const removed = await removeAgentFromLocalLock('my-agent', dir);
        expect(removed).toBe(true);

        const lock = await readLocalLock(dir);
        expect(lock.agents['my-agent']).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('returns false for non-existent agent', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const removed = await removeAgentFromLocalLock('no-such-agent', dir);
        expect(removed).toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('computeAgentFolderHash', () => {
    it('produces a deterministic SHA-256 hash', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir = join(dir, 'my-agent');
        await mkdir(agentDir, { recursive: true });
        await writeFile(
          join(agentDir, 'AGENT.md'),
          '---\nname: test\ndescription: test\n---\n# Test\n',
          'utf-8'
        );

        const hash1 = await computeAgentFolderHash(agentDir);
        const hash2 = await computeAgentFolderHash(agentDir);
        expect(hash1).toBe(hash2);
        expect(hash1).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('changes when file content changes', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir = join(dir, 'my-agent');
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, 'AGENT.md'), 'version 1', 'utf-8');

        const hash1 = await computeAgentFolderHash(agentDir);

        await writeFile(join(agentDir, 'AGENT.md'), 'version 2', 'utf-8');

        const hash2 = await computeAgentFolderHash(agentDir);
        expect(hash1).not.toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('changes when a file is added', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir = join(dir, 'my-agent');
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, 'AGENT.md'), 'content', 'utf-8');

        const hash1 = await computeAgentFolderHash(agentDir);

        await writeFile(join(agentDir, 'extra.txt'), 'extra file', 'utf-8');

        const hash2 = await computeAgentFolderHash(agentDir);
        expect(hash1).not.toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('changes when a file is renamed', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir1 = join(dir, 'agent-v1');
        await mkdir(agentDir1, { recursive: true });
        await writeFile(join(agentDir1, 'old-name.md'), 'content', 'utf-8');

        const agentDir2 = join(dir, 'agent-v2');
        await mkdir(agentDir2, { recursive: true });
        await writeFile(join(agentDir2, 'new-name.md'), 'content', 'utf-8');

        const hash1 = await computeAgentFolderHash(agentDir1);
        const hash2 = await computeAgentFolderHash(agentDir2);
        expect(hash1).not.toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('includes nested files in subdirectories', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir = join(dir, 'my-agent');
        await mkdir(join(agentDir, 'sub'), { recursive: true });
        await writeFile(join(agentDir, 'AGENT.md'), 'root', 'utf-8');
        await writeFile(join(agentDir, 'sub', 'helper.md'), 'nested', 'utf-8');

        const hash1 = await computeAgentFolderHash(agentDir);

        // Changing nested file should change hash
        await writeFile(join(agentDir, 'sub', 'helper.md'), 'changed', 'utf-8');

        const hash2 = await computeAgentFolderHash(agentDir);
        expect(hash1).not.toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('ignores .git and node_modules directories', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        const agentDir = join(dir, 'my-agent');
        await mkdir(agentDir, { recursive: true });
        await writeFile(join(agentDir, 'AGENT.md'), 'content', 'utf-8');

        const hash1 = await computeAgentFolderHash(agentDir);

        // Adding files in .git and node_modules should NOT change hash
        await mkdir(join(agentDir, '.git'), { recursive: true });
        await writeFile(join(agentDir, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf-8');
        await mkdir(join(agentDir, 'node_modules', 'foo'), { recursive: true });
        await writeFile(join(agentDir, 'node_modules', 'foo', 'index.js'), 'noop', 'utf-8');

        const hash2 = await computeAgentFolderHash(agentDir);
        expect(hash1).toBe(hash2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('merge conflict friendliness', () => {
    it('produces no-conflict output when two agents are added independently', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'lock-test-'));
      try {
        // Simulate branch A adding agent-a
        await addAgentToLocalLock(
          'agent-a',
          { source: 'org/a', sourceType: 'github', computedHash: 'aaa' },
          dir
        );
        const branchA = await readFile(join(dir, 'agents-lock.json'), 'utf-8');

        // Reset to empty
        await writeFile(join(dir, 'agents-lock.json'), '{"version":1,"agents":{}}', 'utf-8');

        // Simulate branch B adding agent-b
        await addAgentToLocalLock(
          'agent-b',
          { source: 'org/b', sourceType: 'github', computedHash: 'bbb' },
          dir
        );
        const branchB = await readFile(join(dir, 'agents-lock.json'), 'utf-8');

        // Both branches produce valid JSON with no timestamps to conflict on
        const parsedA = JSON.parse(branchA);
        const parsedB = JSON.parse(branchB);
        expect(parsedA.agents['agent-a']).toBeDefined();
        expect(parsedA.agents['agent-a'].computedHash).toBeDefined();
        expect(parsedB.agents['agent-b']).toBeDefined();
        expect(parsedB.agents['agent-b'].computedHash).toBeDefined();

        // No timestamps present
        expect(parsedA.agents['agent-a'].installedAt).toBeUndefined();
        expect(parsedA.agents['agent-a'].updatedAt).toBeUndefined();
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
