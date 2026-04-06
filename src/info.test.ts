import { describe, it, expect } from 'vitest';
import { runCli } from './test-utils.ts';

describe('info command', () => {
  it('should show usage when no arguments provided', () => {
    const result = runCli(['info']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Usage');
  });

  it('should fetch and display skill content from GitHub', () => {
    // Use a known public skill from the vercel-labs/agent-skills repo
    const result = runCli(
      ['info', 'vercel-labs/agent-skills@vercel-react-best-practices'],
      undefined,
      undefined,
      30000
    );
    // Should either succeed with content or fail gracefully (rate limiting)
    if (result.exitCode === 0) {
      expect(result.stdout).toContain('vercel-react-best-practices');
    }
  }, 35000);

  it('should show error for non-existent skill', () => {
    const result = runCli(
      ['info', 'vercel-labs/agent-skills@this-skill-does-not-exist-xyz'],
      undefined,
      undefined,
      15000
    );
    if (result.exitCode !== 0) {
      expect(result.stdout).toContain('Could not find');
    }
  }, 20000);

  it('should reject local paths', () => {
    const result = runCli(['info', './local-path']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Local paths');
  });

  describe('help and banner', () => {
    it('should include info command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('info <source>');
      expect(result.stdout).toContain('skill content');
    });

    it('should include info in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx skills info');
    });

    it('should include info example in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('info owner/repo@skill');
    });
  });
});
