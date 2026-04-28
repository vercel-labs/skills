import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { hasGitignorePattern, updateGitignore } from '../src/gitignore.ts';

describe('gitignore', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-gitignore-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('hasGitignorePattern', () => {
    it('returns false when .gitignore does not exist', async () => {
      expect(await hasGitignorePattern(testDir)).toBe(false);
    });

    it('returns false when pattern is not present', async () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n');
      expect(await hasGitignorePattern(testDir)).toBe(false);
    });

    it('returns true when pattern is present', async () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n**/skills/npm-*\n');
      expect(await hasGitignorePattern(testDir)).toBe(true);
    });
  });

  describe('updateGitignore', () => {
    it('creates .gitignore when it does not exist', async () => {
      const result = await updateGitignore(testDir);
      expect(result).toEqual({ updated: true, created: true });

      const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('**/skills/npm-*');
      expect(content).toContain('# Agent skills from npm packages');
    });

    it('appends pattern to existing .gitignore', async () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n');

      const result = await updateGitignore(testDir);
      expect(result).toEqual({ updated: true, created: false });

      const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('node_modules');
      expect(content).toContain('**/skills/npm-*');
    });

    it('does not modify when pattern already exists', async () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n**/skills/npm-*\n');

      const result = await updateGitignore(testDir);
      expect(result).toEqual({ updated: false, created: false });
    });

    it('replaces legacy pattern', async () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\nskills/npm-*\n');

      const result = await updateGitignore(testDir);
      expect(result).toEqual({ updated: true, created: false });

      const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
      expect(content).toContain('**/skills/npm-*');
      expect(content).not.toMatch(/^skills\/npm-\*/m);
    });

    it('does not write in dry-run mode', async () => {
      const result = await updateGitignore(testDir, true);
      expect(result).toEqual({ updated: true, created: true });
      expect(existsSync(join(testDir, '.gitignore'))).toBe(false);
    });
  });
});
