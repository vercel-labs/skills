import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildThirdPartyNotice } from '../scripts/generate-licenses.ts';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'skills-generate-licenses-'));
  tempDirs.push(dir);
  return dir;
}

function writePackage(dir: string, pkgName: string, files: Record<string, string>) {
  const pkgDir = join(dir, ...pkgName.split('/'));
  mkdirSync(pkgDir, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(pkgDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return pkgDir;
}

function writePnpmPackage(
  rootDir: string,
  storeEntry: string,
  pkgName: string,
  files: Record<string, string>
) {
  return writePackage(
    join(rootDir, 'node_modules', '.pnpm', storeEntry, 'node_modules'),
    pkgName,
    files
  );
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('generate-licenses', () => {
  it('includes bundled transitive deps and ignores bogus README license files', () => {
    const fixtureRoot = createTempDir();

    const promptsDir = writePackage(join(fixtureRoot, 'node_modules'), '@clack/prompts', {
      LICENSE: 'PROMPTS LICENSE',
    });
    const coreDir = writePnpmPackage(fixtureRoot, '@clack+core@0.5.0', '@clack/core', {
      'package.json': JSON.stringify(
        {
          version: '0.5.0',
          license: 'MIT',
          repository: { url: 'https://github.com/bombshell-dev/clack.git' },
          author: { name: 'Nate Moore' },
        },
        null,
        2
      ),
      LICENSE: 'CORE LICENSE',
    });
    const sisteransiDir = writePnpmPackage(fixtureRoot, 'sisteransi@1.0.5', 'sisteransi', {
      'package.json': JSON.stringify(
        {
          version: '1.0.5',
          license: 'MIT',
          repository: { url: 'https://github.com/terkelg/sisteransi' },
          author: { name: 'Terkel Gjervig Nielsen' },
        },
        null,
        2
      ),
      LICENSE: 'SISTERANSI LICENSE',
    });
    const simpleGitDir = writePackage(join(fixtureRoot, 'node_modules'), 'simple-git', {
      LICENSE: 'SIMPLE GIT LICENSE',
      README: 'THIS SHOULD NOT BE USED AS LICENSE TEXT',
    });
    writePackage(join(fixtureRoot, 'node_modules'), 'picocolors', {
      'package.json': JSON.stringify({ version: '1.1.1', license: 'ISC' }, null, 2),
      LICENSE: 'PICOCOLORS LICENSE',
    });
    writePackage(join(fixtureRoot, 'node_modules'), 'gray-matter', {
      'package.json': JSON.stringify({ version: '4.0.3', license: 'MIT' }, null, 2),
      LICENSE: 'GRAY MATTER LICENSE',
    });
    writePackage(join(fixtureRoot, 'node_modules'), 'xdg-basedir', {
      'package.json': JSON.stringify({ version: '5.1.0', license: 'MIT' }, null, 2),
      LICENSE: 'XDG LICENSE',
    });

    const previousCwd = process.cwd();
    process.chdir(fixtureRoot);
    try {
      const notice = buildThirdPartyNotice({
        '@clack/prompts@0.11.0': {
          licenses: 'MIT',
          repository: 'https://github.com/bombshell-dev/clack',
          licenseFile: join(promptsDir, 'LICENSE'),
          path: promptsDir,
        },
        'simple-git@3.30.0': {
          licenses: 'MIT',
          repository: 'https://github.com/steveukx/git-js',
          licenseFile: join(simpleGitDir, 'README'),
          path: simpleGitDir,
        },
      });

      expect(notice).toContain('Package: @clack/core@0.5.0');
      expect(notice).toContain('CORE LICENSE');
      expect(notice).toContain('Package: sisteransi@1.0.5');
      expect(notice).toContain('SISTERANSI LICENSE');
      expect(notice).toContain('Package: simple-git@3.30.0');
      expect(notice).toContain('SIMPLE GIT LICENSE');
      expect(notice).not.toContain('THIS SHOULD NOT BE USED AS LICENSE TEXT');

      // Sanity-check fallback metadata path wiring was used.
      expect(coreDir).toContain('@clack');
      expect(sisteransiDir).toContain('sisteransi');
    } finally {
      process.chdir(previousCwd);
    }
  });
});
