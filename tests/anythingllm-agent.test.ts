import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agents,
  getAgentSkillsDir,
  getAnythingLLMSkillsDir,
  getNonUniversalAgents,
  getUniversalAgents,
  isAnythingLLMInstalled,
} from '../src/agents.ts';
import { getAgentBaseDir, installSkillForAgent } from '../src/installer.ts';

describe('AnythingLLM agent support', () => {
  const originalCwd = process.cwd();
  const originalStorageDir = process.env.STORAGE_DIR;
  const originalAnythingLLMSkillsDir = process.env.ANYTHINGLLM_SKILLS_DIR;
  let tempDir: string | undefined;

  function restoreEnv(name: 'STORAGE_DIR' | 'ANYTHINGLLM_SKILLS_DIR', value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv('STORAGE_DIR', originalStorageDir);
    restoreEnv('ANYTHINGLLM_SKILLS_DIR', originalAnythingLLMSkillsDir);
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('uses the AnythingLLM custom agent skills project directory', () => {
    expect(agents.anythingllm).toMatchObject({
      name: 'anythingllm',
      displayName: 'AnythingLLM',
      skillsDir: 'plugins/agent-skills',
      globalSkillsDir: undefined,
    });
  });

  it('is selectable as an agent-specific target', () => {
    expect(getNonUniversalAgents()).toContain('anythingllm');
    expect(getUniversalAgents()).not.toContain('anythingllm');
  });

  it('detects and resolves a project-level plugins/agent-skills directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-anythingllm-'));
    process.chdir(tempDir);

    expect(await agents.anythingllm.detectInstalled()).toBe(false);

    mkdirSync(join(tempDir, 'plugins', 'agent-skills'), { recursive: true });

    expect(await agents.anythingllm.detectInstalled()).toBe(true);
    expect(getAgentSkillsDir('anythingllm', { cwd: tempDir })).toBe(
      join(tempDir, 'plugins', 'agent-skills')
    );
    expect(getAgentBaseDir('anythingllm', false, tempDir)).toBe(
      join(tempDir, 'plugins', 'agent-skills')
    );
  });

  it('resolves AnythingLLM development storage under server/storage', () => {
    const cwd = join(tmpdir(), 'anythingllm-dev');
    const devSkillsDir = join(cwd, 'server', 'storage', 'plugins', 'agent-skills');
    const exists = (path: string) => path === devSkillsDir;

    expect(isAnythingLLMInstalled(cwd, {}, exists)).toBe(true);
    expect(getAnythingLLMSkillsDir(cwd, {}, exists)).toBe(devSkillsDir);
  });

  it('prefers explicit AnythingLLM and STORAGE_DIR environment paths', () => {
    const cwd = join(tmpdir(), 'anythingllm-env');
    const explicitSkillsDir = join(tmpdir(), 'custom-anythingllm-skills');
    const storageDir = join(tmpdir(), 'anythingllm-storage');

    expect(
      getAnythingLLMSkillsDir(cwd, {
        ANYTHINGLLM_SKILLS_DIR: explicitSkillsDir,
        STORAGE_DIR: storageDir,
      })
    ).toBe(explicitSkillsDir);

    expect(getAnythingLLMSkillsDir(cwd, { STORAGE_DIR: storageDir })).toBe(
      join(storageDir, 'plugins', 'agent-skills')
    );
  });

  it('installs project skills into the resolved AnythingLLM storage directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-anythingllm-install-'));
    const skillDir = join(tempDir, 'source-skill');
    const storageDir = join(tempDir, 'anythingllm-storage');
    const anythingllmSkillsDir = join(storageDir, 'plugins', 'agent-skills');

    mkdirSync(skillDir, { recursive: true });
    mkdirSync(anythingllmSkillsDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: Example AnythingLLM Skill',
        'description: Test skill',
        '---',
        '',
        '# Example AnythingLLM Skill',
        '',
      ].join('\n')
    );

    process.env.STORAGE_DIR = storageDir;

    const result = await installSkillForAgent(
      {
        name: 'Example AnythingLLM Skill',
        description: 'Test skill',
        path: skillDir,
      },
      'anythingllm',
      { cwd: tempDir, mode: 'copy' }
    );

    expect(result).toMatchObject({
      success: true,
      path: join(anythingllmSkillsDir, 'example-anythingllm-skill'),
      mode: 'copy',
    });
    expect(getAgentSkillsDir('anythingllm', { cwd: tempDir })).toBe(anythingllmSkillsDir);
  });
});
