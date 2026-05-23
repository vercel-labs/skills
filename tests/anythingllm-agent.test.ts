import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
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
import {
  getAgentBaseDir,
  installRemoteSkillForAgent,
  installSkillForAgent,
} from '../src/installer.ts';

function readAnythingLLMManifest(skillDir: string) {
  return JSON.parse(readFileSync(join(skillDir, 'plugin.json'), 'utf-8')) as {
    active: boolean;
    hubId: string;
    name: string;
    schema: string;
    description: string;
    entrypoint: { file: string; params: Record<string, unknown> };
    imported: boolean;
  };
}

function expectAnythingLLMPlugin(skillDir: string, hubId: string, name: string) {
  expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
  expect(existsSync(join(skillDir, 'handler.js'))).toBe(true);

  const manifest = readAnythingLLMManifest(skillDir);
  expect(manifest).toMatchObject({
    active: false,
    hubId,
    name,
    schema: 'skill-1.0.0',
    entrypoint: {
      file: 'handler.js',
    },
    imported: true,
  });
  expect(manifest.entrypoint.params).toHaveProperty('request');
}

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
    expectAnythingLLMPlugin(
      join(anythingllmSkillsDir, 'example-anythingllm-skill'),
      'example-anythingllm-skill',
      'Example AnythingLLM Skill'
    );
    expect(getAgentSkillsDir('anythingllm', { cwd: tempDir })).toBe(anythingllmSkillsDir);
  });

  it('creates AnythingLLM wrappers in default symlink mode', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-anythingllm-symlink-'));
    const skillDir = join(tempDir, 'source-skill');
    const storageDir = join(tempDir, 'anythingllm-storage');
    const anythingllmSkillsDir = join(storageDir, 'plugins', 'agent-skills');

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: Linked AnythingLLM Skill',
        'description: Linked test skill',
        '---',
        '',
        '# Linked AnythingLLM Skill',
        '',
      ].join('\n')
    );
    process.env.STORAGE_DIR = storageDir;

    const result = await installSkillForAgent(
      {
        name: 'Linked AnythingLLM Skill',
        description: 'Linked test skill',
        path: skillDir,
      },
      'anythingllm',
      { cwd: tempDir }
    );

    expect(result).toMatchObject({
      success: true,
      path: join(anythingllmSkillsDir, 'linked-anythingllm-skill'),
      canonicalPath: join(tempDir, '.agents', 'skills', 'linked-anythingllm-skill'),
      mode: 'symlink',
    });
    expectAnythingLLMPlugin(
      join(anythingllmSkillsDir, 'linked-anythingllm-skill'),
      'linked-anythingllm-skill',
      'Linked AnythingLLM Skill'
    );
  });

  it('creates AnythingLLM imported plugin wrappers for remote skills', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-anythingllm-remote-'));
    const storageDir = join(tempDir, 'anythingllm-storage');
    process.env.STORAGE_DIR = storageDir;

    const result = await installRemoteSkillForAgent(
      {
        name: 'Remote AnythingLLM Skill',
        description: 'Remote test skill',
        content: [
          '---',
          'name: Remote AnythingLLM Skill',
          'description: Remote test skill',
          '---',
          '',
          '# Remote AnythingLLM Skill',
          '',
        ].join('\n'),
        installName: 'Remote AnythingLLM Skill',
        sourceUrl: 'https://example.com/skill',
        providerId: 'test',
        sourceIdentifier: 'test/example',
      },
      'anythingllm',
      { cwd: tempDir, mode: 'copy' }
    );

    const skillDir = join(storageDir, 'plugins', 'agent-skills', 'remote-anythingllm-skill');
    expect(result).toMatchObject({
      success: true,
      path: skillDir,
      mode: 'copy',
    });
    expectAnythingLLMPlugin(skillDir, 'remote-anythingllm-skill', 'Remote AnythingLLM Skill');
  });

  it('preserves native AnythingLLM plugin files when a skill already provides them', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'skills-anythingllm-native-'));
    const skillDir = join(tempDir, 'source-skill');
    const storageDir = join(tempDir, 'anythingllm-storage');
    const nativeManifest = {
      active: true,
      hubId: 'native-anythingllm-skill',
      name: 'Native AnythingLLM Skill',
      schema: 'skill-1.0.0',
      version: '2.0.0',
      description: 'Already packaged for AnythingLLM',
      entrypoint: { file: 'handler.js', params: {} },
      imported: true,
    };

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      ['---', 'name: Native AnythingLLM Skill', 'description: Native test skill', '---', ''].join(
        '\n'
      )
    );
    writeFileSync(join(skillDir, 'plugin.json'), `${JSON.stringify(nativeManifest, null, 2)}\n`);
    writeFileSync(
      join(skillDir, 'handler.js'),
      'module.exports.runtime = { handler: async () => "native" };\n'
    );
    process.env.STORAGE_DIR = storageDir;

    const result = await installSkillForAgent(
      {
        name: 'Native AnythingLLM Skill',
        description: 'Native test skill',
        path: skillDir,
      },
      'anythingllm',
      { cwd: tempDir, mode: 'copy' }
    );

    expect(result.success).toBe(true);
    expect(readAnythingLLMManifest(result.path)).toMatchObject(nativeManifest);
    expect(readFileSync(join(result.path, 'handler.js'), 'utf-8')).toContain('"native"');
  });
});
