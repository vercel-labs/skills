import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('skill-cui package', () => {
  const packageDir = join(import.meta.dirname, '..', 'packages', 'skill-cui');

  it('defines a standalone npx executable package', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf-8'));

    expect(pkg.name).toBe('skill-cui');
    expect(pkg.version).not.toBe('0.0.0');
    expect(pkg.bin).toEqual({ 'skill-cui': './bin/skill-cui.mjs' });
    expect(pkg.files).toEqual(['bin', 'lib', 'README.md']);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/smota/skills.git',
      directory: 'packages/skill-cui',
    });
    expect(pkg.homepage).toBe(
      'https://github.com/smota/skills/tree/main/packages/skill-cui#readme'
    );
    expect(pkg.bugs).toEqual({ url: 'https://github.com/smota/skills/issues' });
    expect(pkg.author).toBe('smota');
    expect(pkg.contributors).toContain('vercel-labs/skills contributors');
    expect(pkg.engines.node).toBe('>=18');
    expect(pkg.keywords).toEqual(expect.arrayContaining(['skills', 'agent-skills', 'cui']));
    expect(pkg.license).toBe('MIT');
  });

  it('ships the executable and does not import private skills internals', () => {
    const binPath = join(packageDir, 'bin', 'skill-cui.mjs');
    const source = readFileSync(binPath, 'utf-8');

    expect(existsSync(binPath)).toBe(true);
    expect(source.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(source).toContain('npx');
    expect(source).toContain('skills');
    expect(source).not.toContain("from '../../src");
    expect(source).not.toContain("from '../src");
    expect(source).not.toContain('@vr_patel' + '/tui');

    const helperPath = join(packageDir, 'lib', 'terminal-ui.mjs');
    const helperSource = readFileSync(helperPath, 'utf-8');
    expect(existsSync(helperPath)).toBe(true);
    expect(helperSource).not.toContain('@vr_patel' + '/tui');
  });

  it('documents standalone behavior and safety', () => {
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf-8');

    expect(readme).toContain('npx skill-cui');
    expect(readme).toContain('npm install -g skill-cui');
    expect(readme).toContain('public `npx skills` command');
    expect(readme).toContain('--no-confirmation');
    expect(readme).toContain('smota/skills');
    expect(readme).toContain('vercel-labs/skills');
  });
});
