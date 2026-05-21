import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock process.cwd for testing
let originalCwd: string;
let testRoot: string;

describe('checkAgentInstallation', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = join(tmpdir(), `agents-test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  const checkAgentInstallation = async (
    localMarker: string | undefined,
    globalMarker: string,
    cwd: string
  ): Promise<boolean> => {
    if (localMarker && existsSync(join(cwd, localMarker))) {
      return true;
    }
    return existsSync(globalMarker);
  };

  describe('basic scenarios', () => {
    it('should return true when only project marker exists', async () => {
      const projectDir = join(testRoot, 'project-with-local');
      mkdirSync(join(projectDir, '.myagent'), { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');

      const result = await checkAgentInstallation('.myagent', globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should return true when only global marker exists', async () => {
      const projectDir = join(testRoot, 'project-without-local');
      mkdirSync(projectDir, { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');
      mkdirSync(globalDir, { recursive: true });

      const result = await checkAgentInstallation('.myagent', globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should return true when both markers exist', async () => {
      const projectDir = join(testRoot, 'project-with-both');
      mkdirSync(join(projectDir, '.myagent'), { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');
      mkdirSync(globalDir, { recursive: true });

      const result = await checkAgentInstallation('.myagent', globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should return false when neither marker exists', async () => {
      const projectDir = join(testRoot, 'project-empty');
      mkdirSync(projectDir, { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');

      const result = await checkAgentInstallation('.myagent', globalDir, projectDir);
      expect(result).toBe(false);
    });

    it('should prioritize project marker over global marker', async () => {
      const projectDir = join(testRoot, 'project-priority');
      mkdirSync(join(projectDir, '.myagent'), { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');
      mkdirSync(globalDir, { recursive: true });

      // Both exist, but project should take priority
      const result = await checkAgentInstallation('.myagent', globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should return true when localMarker is undefined and global exists', async () => {
      const projectDir = join(testRoot, 'project-no-local-support');
      mkdirSync(projectDir, { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');
      mkdirSync(globalDir, { recursive: true });

      const result = await checkAgentInstallation(undefined, globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should return false when localMarker is undefined and global does not exist', async () => {
      const projectDir = join(testRoot, 'project-no-local-support-2');
      mkdirSync(projectDir, { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.myagent');

      const result = await checkAgentInstallation(undefined, globalDir, projectDir);
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle nested project markers (like windsurf with .codeium/windsurf)', async () => {
      const projectDir = join(testRoot, 'project-nested');
      mkdirSync(join(projectDir, '.codeium', 'windsurf'), { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.codeium', 'windsurf');

      const result = await checkAgentInstallation('.codeium/windsurf', globalDir, projectDir);
      expect(result).toBe(true);
    });

    it('should handle nested global markers when project does not exist', async () => {
      const projectDir = join(testRoot, 'project-nested-global');
      mkdirSync(projectDir, { recursive: true });
      const globalDir = join(testRoot, 'fake-home', '.codeium', 'windsurf');
      mkdirSync(globalDir, { recursive: true });

      const result = await checkAgentInstallation('.codeium/windsurf', globalDir, projectDir);
      expect(result).toBe(true);
    });
  });
});

describe('OpenClaw multi-marker detection', () => {
  let testRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = join(tmpdir(), `openclaw-test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  const checkOpenClawInstallation = async (cwd: string): Promise<boolean> => {
    const checkAgentInstallation = async (
      localMarker: string | undefined,
      globalMarker: string
    ): Promise<boolean> => {
      if (localMarker && existsSync(join(cwd, localMarker))) {
        return true;
      }
      return existsSync(globalMarker);
    };

    return (
      (await checkAgentInstallation('.openclaw', join(testRoot, 'home', '.openclaw'))) ||
      (await checkAgentInstallation('.clawdbot', join(testRoot, 'home', '.clawdbot'))) ||
      (await checkAgentInstallation('.moltbot', join(testRoot, 'home', '.moltbot')))
    );
  };

  it('should return true when .openclaw exists in project', async () => {
    const projectDir = join(testRoot, 'project1');
    mkdirSync(join(projectDir, '.openclaw'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when .clawdbot exists in project', async () => {
    const projectDir = join(testRoot, 'project2');
    mkdirSync(join(projectDir, '.clawdbot'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when .moltbot exists in project', async () => {
    const projectDir = join(testRoot, 'project3');
    mkdirSync(join(projectDir, '.moltbot'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when .openclaw exists in global home', async () => {
    const projectDir = join(testRoot, 'project4');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(testRoot, 'home', '.openclaw'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when any of the three global markers exists', async () => {
    const projectDir = join(testRoot, 'project5');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(testRoot, 'home', '.clawdbot'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return false when none of the markers exist', async () => {
    const projectDir = join(testRoot, 'project6');
    mkdirSync(projectDir, { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(false);
  });

  it('should prioritize project markers over global markers', async () => {
    const projectDir = join(testRoot, 'project7');
    mkdirSync(join(projectDir, '.moltbot'), { recursive: true });
    mkdirSync(join(testRoot, 'home', '.openclaw'), { recursive: true });

    const result = await checkOpenClawInstallation(projectDir);
    expect(result).toBe(true);
  });
});

describe('Codex with system marker', () => {
  let testRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = join(tmpdir(), `codex-test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  const checkCodexInstallation = async (cwd: string): Promise<boolean> => {
    const checkAgentInstallation = async (
      localMarker: string | undefined,
      globalMarker: string
    ): Promise<boolean> => {
      if (localMarker && existsSync(join(cwd, localMarker))) {
        return true;
      }
      return existsSync(globalMarker);
    };

    // Codex checks .agents in project, then global home, then /etc/codex
    return (
      (await checkAgentInstallation('.agents', join(testRoot, 'home', '.codex'))) ||
      existsSync(join(testRoot, 'etc', 'codex'))
    );
  };

  it('should return true when .agents exists in project', async () => {
    const projectDir = join(testRoot, 'project1');
    mkdirSync(join(projectDir, '.agents'), { recursive: true });

    const result = await checkCodexInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when global .codex exists', async () => {
    const projectDir = join(testRoot, 'project2');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(testRoot, 'home', '.codex'), { recursive: true });

    const result = await checkCodexInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when system marker /etc/codex exists', async () => {
    const projectDir = join(testRoot, 'project3');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(testRoot, 'etc', 'codex'), { recursive: true });

    const result = await checkCodexInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return false when no markers exist', async () => {
    const projectDir = join(testRoot, 'project4');
    mkdirSync(projectDir, { recursive: true });

    const result = await checkCodexInstallation(projectDir);
    expect(result).toBe(false);
  });
});

describe('Replit with project-only marker', () => {
  let testRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testRoot = join(tmpdir(), `replit-test-${Date.now()}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  const checkReplitInstallation = async (cwd: string): Promise<boolean> => {
    const checkAgentInstallation = async (
      localMarker: string | undefined,
      globalMarker: string
    ): Promise<boolean> => {
      if (localMarker && existsSync(join(cwd, localMarker))) {
        return true;
      }
      return existsSync(globalMarker);
    };

    // Replit checks .replit in project, falls back to global .agents
    return await checkAgentInstallation('.replit', join(testRoot, 'home', '.agents'));
  };

  it('should return true when .replit exists in project', async () => {
    const projectDir = join(testRoot, 'project1');
    mkdirSync(join(projectDir, '.replit'), { recursive: true });

    const result = await checkReplitInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return true when global .agents exists (fallback)', async () => {
    const projectDir = join(testRoot, 'project2');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(testRoot, 'home', '.agents'), { recursive: true });

    const result = await checkReplitInstallation(projectDir);
    expect(result).toBe(true);
  });

  it('should return false when neither marker exists', async () => {
    const projectDir = join(testRoot, 'project3');
    mkdirSync(projectDir, { recursive: true });

    const result = await checkReplitInstallation(projectDir);
    expect(result).toBe(false);
  });
});
