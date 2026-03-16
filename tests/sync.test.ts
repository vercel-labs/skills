import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('experimental_sync command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-sync-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('node_modules discovery', () => {
    it('should find AGENT.md at package root', () => {
      // Create a package with AGENT.md at root
      const pkgDir = join(testDir, 'node_modules', 'my-agent-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: root-agent
description: A agent at package root
---

# Root Agent
Instructions.
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('root-agent');
      expect(result.stdout).toContain('my-agent-pkg');
    });

    it('should find agents in agents/ subdirectory', () => {
      const agentDir = join(testDir, 'node_modules', 'my-lib', 'agents', 'helper-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: helper-agent
description: A helper agent in agents/ dir
---

# Helper
Instructions.
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('helper-agent');
      expect(result.stdout).toContain('my-lib');
    });

    it('should find agents in scoped packages', () => {
      const pkgDir = join(testDir, 'node_modules', '@acme', 'tools');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: acme-tool
description: A agent from a scoped package
---

# Acme Tool
Instructions.
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('acme-tool');
      expect(result.stdout).toContain('@acme/tools');
    });

    it('should show no agents found when node_modules is empty', () => {
      mkdirSync(join(testDir, 'node_modules'), { recursive: true });

      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No agents found');
    });

    it('should show no agents found when no node_modules exists', () => {
      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No agents found');
    });
  });

  describe('agents-lock.json', () => {
    it('should write agents-lock.json after sync', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: lock-test-agent
description: Test lock file writing
---

# Lock Test
Instructions.
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lockPath = join(testDir, 'agents-lock.json');
      expect(existsSync(lockPath)).toBe(true);

      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(lock.version).toBe(1);
      expect(lock.agents['lock-test-agent']).toBeDefined();
      expect(lock.agents['lock-test-agent'].source).toBe('my-pkg');
      expect(lock.agents['lock-test-agent'].sourceType).toBe('node_modules');
      expect(lock.agents['lock-test-agent'].computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not have timestamps in lock entries', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: no-timestamp-agent
description: No timestamps
---

# Test
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'agents-lock.json'), 'utf-8'));
      const entry = lock.agents['no-timestamp-agent'];
      expect(entry.installedAt).toBeUndefined();
      expect(entry.updatedAt).toBeUndefined();
    });

    it('should sort agents alphabetically in lock file', () => {
      // Create three packages in reverse order
      for (const name of ['zebra-agent', 'alpha-agent', 'mid-agent']) {
        const pkgDir = join(testDir, 'node_modules', name);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
          join(pkgDir, 'AGENT.md'),
          `---
name: ${name}
description: ${name} description
---

# ${name}
`
        );
      }

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const raw = readFileSync(join(testDir, 'agents-lock.json'), 'utf-8');
      const keys = Object.keys(JSON.parse(raw).agents);
      expect(keys).toEqual(['alpha-agent', 'mid-agent', 'zebra-agent']);
    });

    it('should skip unchanged agents on second sync', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: cached-agent
description: Test caching
---

# Cached
`
      );

      // First sync
      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      // Second sync - should say up to date
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('up to date');
    });

    it('should reinstall when --force is used', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'AGENT.md'),
        `---
name: force-agent
description: Test force
---

# Force
`
      );

      // First sync
      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      // Second sync with --force should reinstall
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code', '--force'], testDir);
      expect(result.stdout).toContain('force-agent');
      expect(result.stdout).not.toContain('All agents are up to date');
    });
  });

  describe('CLI routing', () => {
    it('should show experimental_sync in help output', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('experimental_sync');
    });

    it('should show experimental_sync in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('experimental_sync');
    });
  });

  describe('multiple agents from one package', () => {
    it('should discover multiple agents in agents/ subdirectory', () => {
      const pkg = join(testDir, 'node_modules', 'multi-agent-pkg');
      for (const name of ['agent-one', 'agent-two']) {
        const dir = join(pkg, 'agents', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'AGENT.md'),
          `---
name: ${name}
description: ${name} from multi package
---

# ${name}
`
        );
      }

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('agent-one');
      expect(result.stdout).toContain('agent-two');
      expect(result.stdout).toContain('multi-agent-pkg');
    });
  });
});
