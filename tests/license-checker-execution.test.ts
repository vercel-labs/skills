import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const rootDir = join(import.meta.dirname, '..');
const tempDirs: string[] = [];

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'skills-licenses-'));
  tempDirs.push(dir);
  copyFileSync(join(rootDir, 'package.json'), join(dir, 'package.json'));
  copyFileSync(join(rootDir, 'scripts/generate-licenses.ts'), join(dir, 'generate-licenses.ts'));
  return dir;
}

function generateLicenses(dir: string) {
  // No package manager or other executable is available through PATH.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')
  );
  return spawnSync(process.execPath, [join(dir, 'generate-licenses.ts')], {
    cwd: dir,
    env: { ...env, PATH: '' },
    encoding: 'utf-8',
    timeout: 30000,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('license generation', () => {
  it('runs the installed scanner without a package manager on PATH', () => {
    const dir = createProject();
    symlinkSync(join(rootDir, 'node_modules'), join(dir, 'node_modules'), 'junction');

    const result = generateLicenses(dir);

    expect(result.status, result.stderr).toBe(0);
    const notices = readFileSync(join(dir, 'ThirdPartyNoticeText.txt'), 'utf-8');
    expect(notices).toContain('Package: picocolors@');
    expect(notices).toContain('License: ISC');
  });

  it('fails when the scanner is not installed', () => {
    const dir = createProject();

    const result = generateLicenses(dir);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND');
    expect(result.stderr).toContain('license-checker');
    expect(existsSync(join(dir, 'ThirdPartyNoticeText.txt'))).toBe(false);
  });
});
