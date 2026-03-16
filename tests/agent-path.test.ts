/**
 * Unit tests for agent path calculation in telemetry.
 *
 * These tests verify that the relativePath calculation for agentFiles
 * correctly produces paths relative to the repo root, not the search path.
 * Tests cover both Unix and Windows path styles.
 */

import { describe, it, expect } from 'vitest';
import { sep } from 'path';

/**
 * Simulates the relativePath calculation from add.ts (cross-platform version)
 */
function calculateRelativePath(
  tempDir: string | null,
  agentPath: string,
  pathSep: string = sep
): string | null {
  if (tempDir && agentPath === tempDir) {
    // Agent is at root level of repo
    return 'AGENT.md';
  } else if (tempDir && agentPath.startsWith(tempDir + pathSep)) {
    // Compute path relative to repo root (tempDir)
    // Use forward slashes for telemetry (URL-style paths)
    return (
      agentPath
        .slice(tempDir.length + 1)
        .split(pathSep)
        .join('/') + '/AGENT.md'
    );
  } else {
    // Local path - skip telemetry
    return null;
  }
}

describe('calculateRelativePath (Unix paths)', () => {
  // Explicitly use '/' as separator for Unix-style paths
  const unixSep = '/';

  it('agent at repo root', () => {
    const tempDir = '/tmp/abc123';
    const agentPath = '/tmp/abc123';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBe('AGENT.md');
  });

  it('agent in agents/ subdirectory', () => {
    const tempDir = '/tmp/abc123';
    const agentPath = '/tmp/abc123/agents/my-agent';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBe('agents/my-agent/AGENT.md');
  });

  it('agent in .claude/agents/ directory', () => {
    const tempDir = '/tmp/abc123';
    const agentPath = '/tmp/abc123/.claude/agents/my-agent';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBe('.claude/agents/my-agent/AGENT.md');
  });

  it('agent in nested subdirectory', () => {
    const tempDir = '/tmp/abc123';
    const agentPath = '/tmp/abc123/agents/.curated/advanced-agent';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBe('agents/.curated/advanced-agent/AGENT.md');
  });

  it('local path returns null', () => {
    const tempDir = null;
    const agentPath = '/Users/me/projects/my-agent';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBeNull();
  });

  it('path not under tempDir returns null', () => {
    const tempDir = '/tmp/abc123';
    const agentPath = '/tmp/other/my-agent';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBeNull();
  });

  it('onmax/nuxt-agents: agent in agents/ts-library', () => {
    const tempDir = '/tmp/clone-xyz';
    // discoverAgents finds /tmp/clone-xyz/agents/ts-library/AGENT.md
    // agent.path = dirname(agentMdPath) = /tmp/clone-xyz/agents/ts-library
    const agentPath = '/tmp/clone-xyz/agents/ts-library';
    const result = calculateRelativePath(tempDir, agentPath, unixSep);
    expect(result).toBe('agents/ts-library/AGENT.md');
  });
});

describe('calculateRelativePath (Windows paths)', () => {
  it('agent at repo root (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const agentPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBe('AGENT.md');
  });

  it('agent in agents\\ subdirectory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const agentPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\agents\\my-agent';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBe('agents/my-agent/AGENT.md');
  });

  it('agent in .claude\\agents\\ directory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const agentPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\.claude\\agents\\my-agent';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBe('.claude/agents/my-agent/AGENT.md');
  });

  it('agent in nested subdirectory (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const agentPath =
      'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\agents\\.curated\\advanced-agent';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBe('agents/.curated/advanced-agent/AGENT.md');
  });

  it('path not under tempDir returns null (Windows)', () => {
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123';
    const agentPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\other\\my-agent';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBeNull();
  });

  it('handles similar path prefixes correctly (Windows)', () => {
    // This tests that we don't match partial directory names
    const tempDir = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc';
    const agentPath = 'C:\\Users\\test\\AppData\\Local\\Temp\\abc123\\agents\\my-agent';
    const result = calculateRelativePath(tempDir, agentPath, '\\');
    expect(result).toBeNull();
  });
});
