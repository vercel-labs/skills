import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as tar from 'tar';
import { describe, expect, inject, it } from 'vitest';
import { Sandbox, entries, exec } from './sandbox.ts';
import { cleanEnv } from './env.ts';

const repoPkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')
) as { version: string; dependencies: Record<string, string> };

describe('packed package', () => {
  it.skipIf(!inject('tarball'))('ships only the published files', async () => {
    const files: string[] = [];
    await tar.t({ file: inject('tarball')!, onReadEntry: (e) => files.push(e.path) });

    expect(files).toContain('package/package.json');
    expect(files).toContain('package/bin/cli.mjs');
    expect(files).toContain('package/dist/cli.mjs');
    expect(files).toContain('package/README.md');
    expect(files).toContain('package/ThirdPartyNoticeText.txt');
    // No sources, tests, or repo tooling leak into the tarball.
    const leaked = files.filter((f) =>
      /^package\/(src|tests|e2e|scripts|node_modules|\.github|\.automations|\.vc)\//.test(f)
    );
    expect(leaked).toEqual([]);
    expect(files.filter((f) => f.endsWith('.ts') && !f.endsWith('.d.mts'))).toEqual([]);
  });

  it('installs only runtime dependencies', () => {
    const installed = entries(join(inject('installDir'), 'node_modules')).filter(
      (name) => !name.startsWith('.')
    );
    for (const dep of Object.keys(repoPkg.dependencies)) expect(installed).toContain(dep);
    // Bundled libraries must not be needed at runtime.
    for (const bundled of ['@clack', 'picocolors', 'simple-git', 'xdg-basedir', 'vitest']) {
      expect(installed).not.toContain(bundled);
    }
  });

  it('exposes the programmatic API through the exports map', async () => {
    // Resolve `skills` the way a consumer would: a script in the install prefix.
    const script = [
      "const api = await import('skills');",
      'console.log(JSON.stringify({',
      '  exports: Object.keys(api).sort(),',
      "  agent: api.getSupportedAgents().some((a) => a.id === 'claude-code'),",
      '}));',
    ].join('\n');
    const result = await exec(process.execPath, ['--input-type=module', '-e', script], {
      cwd: inject('installDir'),
      env: cleanEnv(),
    });
    const { exports, agent } = JSON.parse(result.stdout) as { exports: string[]; agent: boolean };
    expect(exports).toContain('installSkills');
    expect(exports).toContain('isDiagnostic');
    expect(agent).toBe(true);
  });

  it('runs through the npm bin shim', async () => {
    const shim = join(
      inject('installDir'),
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'skills.cmd' : 'skills'
    );
    const result = await exec(shim, ['--version'], { env: cleanEnv() });
    if (!process.env.SKILLS_E2E_PACKAGE) expect(result.stdout.trim()).toBe(repoPkg.version);
    else expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prints help and the banner', async () => {
    const sandbox = await Sandbox.create('help');
    const help = await sandbox.skills(['--help']);
    expect(help.output).toContain('Usage: skills <command> [options]');
    expect(help.output).toContain('add <package>');

    const banner = await sandbox.skills([]);
    expect(banner.output).toContain('skills add');
  });

  it('lists nothing in a fresh project and home', async () => {
    const sandbox = await Sandbox.create('empty');
    expect(await sandbox.skillsJson(['ls'])).toEqual([]);
    expect(await sandbox.skillsJson(['ls', '-g'])).toEqual([]);
  });

  it('scaffolds a skill with init', async () => {
    const sandbox = await Sandbox.create('init');
    await sandbox.skills(['init', 'my-skill']);
    const body = readFileSync(sandbox.path('my-skill', 'SKILL.md'), 'utf8');
    expect(body).toMatch(/^name: my-skill$/m);
  });
});
