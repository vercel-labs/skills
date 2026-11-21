import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import { cleanEnv } from './env.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Scratch root for the whole run (outside the repo, so no node_modules leak in). */
    e2eRoot: string;
    /** Absolute path to the installed package's bin script (run with `node`). */
    skillsBin: string;
    /** Directory the package was installed into (`<dir>/node_modules/skills`). */
    installDir: string;
    /** The packed tarball, or null when SKILLS_E2E_PACKAGE points at a registry spec. */
    tarball: string | null;
    /** Shared npm cache for every npm call in the run. */
    npmCache: string;
  }
}

const repoRoot = resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';

function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit', shell: isWindows });
}

/**
 * Pack the repo (or take SKILLS_E2E_PACKAGE, e.g. `skills@latest` or a .tgz path),
 * then `npm install` it into an empty prefix with a fresh HOME and no inherited
 * npm config, which is the closest local stand-in for a user's machine.
 */
export default async function setup(project: TestProject) {
  const root = await mkdtemp(join(tmpdir(), 'skills-e2e-'));
  const npmHome = join(root, 'npm-home');
  const npmCache = join(root, 'npm-cache');
  const installDir = join(root, 'install');
  await Promise.all([mkdir(npmHome), mkdir(npmCache), mkdir(installDir)]);

  let spec = process.env.SKILLS_E2E_PACKAGE;
  let tarball: string | null = null;
  if (!spec) {
    const packDir = join(root, 'pack');
    await mkdir(packDir);
    sh('pnpm', ['build'], repoRoot);
    sh('pnpm', ['pack', '--pack-destination', packDir], repoRoot);
    const [file] = (await readdir(packDir)).filter((f) => f.endsWith('.tgz'));
    if (!file) throw new Error(`pnpm pack produced no tarball in ${packDir}`);
    tarball = spec = join(packDir, file);
  } else if (spec.endsWith('.tgz')) {
    tarball = spec = resolve(spec);
  }

  await writeFile(join(installDir, 'package.json'), '{ "private": true }\n');
  sh(
    'npm',
    ['install', '--no-audit', '--no-fund', '--no-package-lock', spec],
    installDir,
    cleanEnv({ HOME: npmHome, USERPROFILE: npmHome, npm_config_cache: npmCache })
  );

  const pkgDir = join(installDir, 'node_modules', 'skills');
  const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8')) as {
    bin: Record<string, string>;
  };
  const skillsBin = join(pkgDir, pkg.bin.skills!);

  project.provide('e2eRoot', root);
  project.provide('skillsBin', skillsBin);
  project.provide('installDir', installDir);
  project.provide('tarball', tarball);
  project.provide('npmCache', npmCache);

  return async () => {
    if (process.env.SKILLS_E2E_KEEP) {
      console.log(`\nKeeping e2e scratch dir: ${root}`);
      return;
    }
    await rm(root, { recursive: true, force: true });
  };
}
