/**
 * Regression tests for global installs of universal agents (#1874, #294).
 *
 * Global installs write to the user's home directory, so all tests run with
 * HOME (and friends) stubbed to a temp directory. The agents module caches
 * homedir() at import time, so modules must be re-imported after stubbing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readlink,
  realpath,
  readFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WellKnownSkill } from '../src/providers/wellknown.ts';
import { createTestHomeEnvironment } from '../src/test-utils.ts';

let installer: typeof import('../src/installer.ts');
let agentsModule: typeof import('../src/agents.ts');
let testHome: string;

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf-8');
  return dir;
}

describe('global universal-agent installs', () => {
  beforeAll(async () => {
    testHome = await mkdtemp(join(tmpdir(), 'skills-global-universal-home-'));

    for (const [name, value] of Object.entries(createTestHomeEnvironment(testHome))) {
      vi.stubEnv(name, value);
    }

    vi.resetModules();
    agentsModule = await import('../src/agents.ts');
    installer = await import('../src/installer.ts');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(testHome, { recursive: true, force: true });
  });

  it('agentReadsCanonicalGlobally: only agents whose native dir IS canonical (or Copilot) read canonical directly', () => {
    // Native dir differs from canonical (e.g. ~/.gemini/antigravity-cli/skills):
    // the agent needs a symlink in its own dir.
    for (const agentType of [
      'antigravity-cli',
      'antigravity',
      'gemini-cli',
      'codex',
      'cursor',
      'deepagents',
      'firebender',
      'opencode',
      'amp',
      'replit',
      'universal',
    ]) {
      expect(installer.agentReadsCanonicalGlobally(agentType as any), agentType).toBe(false);
      expect(installer.getUniversalGlobalSkillTarget(agentType as any, 'foo'), agentType).toBe(
        join(
          agentsModule.agents[agentType as keyof typeof agentsModule.agents].globalSkillsDir ?? '',
          'foo'
        )
      );
    }

    // Native dir IS canonical (~/.agents/skills): no symlink needed.
    for (const agentType of ['cline', 'dexto', 'kimi-code-cli', 'loaf', 'warp', 'zed']) {
      expect(installer.agentReadsCanonicalGlobally(agentType as any), agentType).toBe(true);
      expect(installer.getUniversalGlobalSkillTarget(agentType as any, 'foo'), agentType).toBe(
        undefined
      );
    }

    // GitHub Copilot reads ~/.agents/skills natively on top of ~/.copilot/skills
    // (see #294): a symlink there would duplicate skills in VS Code.
    expect(installer.agentReadsCanonicalGlobally('github-copilot')).toBe(true);
    expect(installer.getUniversalGlobalSkillTarget('github-copilot', 'foo')).toBe(undefined);

    // Non-universal agents are unaffected by the universal global logic.
    expect(installer.agentReadsCanonicalGlobally('claude-code')).toBe(false);
    expect(installer.getUniversalGlobalSkillTarget('claude-code', 'foo')).toBe(undefined);
  });

  it('creates a symlink in the native global dir for universal agents whose dir differs from canonical', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-global-universal-'));
    const skillName = 'native-dir-symlink-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installer.installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'antigravity-cli',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const nativeDir = join(testHome, '.gemini', 'antigravity-cli', 'skills', skillName);

      // Skill lives as a real directory in canonical ~/.agents/skills
      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);
      expect(result.path).toBe(canonicalDir);
      expect(result.canonicalPath).toBe(canonicalDir);

      // Agent's native global dir holds a symlink to canonical
      const nativeStats = await lstat(nativeDir);
      expect(nativeStats.isSymbolicLink()).toBe(true);
      expect(await realpath(nativeDir)).toBe(await realpath(canonicalDir));
      const linkTarget = await readlink(nativeDir);
      expect(linkTarget).toContain('.agents');

      // Skill content is readable through the symlink
      await expect(readFile(join(nativeDir, 'SKILL.md'), 'utf-8')).resolves.toContain(skillName);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not create a symlink for GitHub Copilot global installs (regression for #294)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-global-universal-'));
    const skillName = 'copilot-skip-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installer.installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'github-copilot',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(testHome, '.agents', 'skills', skillName));

      const copilotDir = join(testHome, '.copilot', 'skills', skillName);
      await expect(lstat(copilotDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not create a symlink when the native global dir IS canonical (cline)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-global-universal-'));
    const skillName = 'canonical-native-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installer.installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'cline',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(testHome, '.agents', 'skills', skillName));

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const stats = await lstat(canonicalDir);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copies to both canonical and the native global dir in copy mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-global-universal-'));
    const skillName = 'copy-mode-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installer.installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'antigravity-cli',
        { global: true, mode: 'copy' }
      );

      expect(result.success).toBe(true);

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const nativeDir = join(testHome, '.gemini', 'antigravity-cli', 'skills', skillName);

      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      // Copy mode writes real files to the native dir (no symlink)
      const nativeStats = await lstat(nativeDir);
      expect(nativeStats.isDirectory()).toBe(true);
      expect(nativeStats.isSymbolicLink()).toBe(false);
      await expect(readFile(join(nativeDir, 'SKILL.md'), 'utf-8')).resolves.toContain(skillName);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates the native-dir symlink for blob installs on global installs', async () => {
    const skillName = 'blob-global-skill';

    try {
      const result = await installer.installBlobSkillForAgent(
        {
          installName: skillName,
          files: [
            {
              path: 'SKILL.md',
              contents: `---\nname: ${skillName}\ndescription: test\n---\n`,
            },
          ],
        },
        'antigravity-cli',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(true);

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const nativeDir = join(testHome, '.gemini', 'antigravity-cli', 'skills', skillName);

      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      const nativeStats = await lstat(nativeDir);
      expect(nativeStats.isSymbolicLink()).toBe(true);
      expect(await realpath(nativeDir)).toBe(await realpath(canonicalDir));
    } finally {
      await rm(join(testHome, '.agents', 'skills', skillName), { recursive: true, force: true });
    }
  });

  it('creates the native-dir symlink for remote installs on global installs', async () => {
    const skillName = 'remote-global-skill';

    try {
      const result = await installer.installRemoteSkillForAgent(
        {
          name: skillName,
          description: 'test',
          content: `---\nname: ${skillName}\ndescription: test\n---\n`,
          installName: skillName,
          sourceUrl: 'https://example.com/skill',
          providerId: 'test',
          sourceIdentifier: 'example.com',
        },
        'antigravity-cli',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(true);

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const nativeDir = join(testHome, '.gemini', 'antigravity-cli', 'skills', skillName);

      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      const nativeStats = await lstat(nativeDir);
      expect(nativeStats.isSymbolicLink()).toBe(true);
      expect(await realpath(nativeDir)).toBe(await realpath(canonicalDir));
    } finally {
      await rm(join(testHome, '.agents', 'skills', skillName), { recursive: true, force: true });
    }
  });

  it('creates the native-dir symlink for well-known installs on global installs', async () => {
    const skillName = 'wellknown-global-skill';
    const skill = {
      name: skillName,
      description: 'test',
      content: `---\nname: ${skillName}\ndescription: test\n---\n`,
      installName: skillName,
      sourceUrl: 'https://example.com/skill',
      providerId: 'well-known',
      sourceIdentifier: 'example.com',
      files: new Map([['SKILL.md', `---\nname: ${skillName}\ndescription: test\n---\n`]]),
      indexEntry: {
        name: skillName,
        type: 'skill-md',
        description: 'test',
        url: 'https://example.com/skill',
      },
    } as unknown as WellKnownSkill;

    try {
      const result = await installer.installWellKnownSkillForAgent(skill, 'antigravity-cli', {
        global: true,
        mode: 'symlink',
      });

      expect(result.success).toBe(true);

      const canonicalDir = join(testHome, '.agents', 'skills', skillName);
      const nativeDir = join(testHome, '.gemini', 'antigravity-cli', 'skills', skillName);

      const canonicalStats = await lstat(canonicalDir);
      expect(canonicalStats.isDirectory()).toBe(true);
      expect(canonicalStats.isSymbolicLink()).toBe(false);

      const nativeStats = await lstat(nativeDir);
      expect(nativeStats.isSymbolicLink()).toBe(true);
      expect(await realpath(nativeDir)).toBe(await realpath(canonicalDir));
    } finally {
      await rm(join(testHome, '.agents', 'skills', skillName), { recursive: true, force: true });
    }
  });
});
