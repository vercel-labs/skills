import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inject } from 'vitest';
import { cleanEnv } from './env.ts';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr with ANSI escapes removed, for substring assertions. */
  output: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Fail the test when the exit code is non-zero. Default true. */
  check?: boolean;
  timeoutMs?: number;
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const isWindows = process.platform === 'win32';

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** Async spawn: tests that host a local HTTP server must not block the event loop. */
export function exec(cmd: string, args: string[], opts: RunOptions & { env: NodeJS.ProcessEnv }) {
  return new Promise<RunResult>((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows && cmd !== process.execPath,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 170_000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = { code, stdout, stderr, output: stripAnsi(stdout + stderr) };
      if (opts.check !== false && code !== 0) {
        reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with ${code}\n\n${result.output}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

/**
 * A throwaway user: its own HOME (global scope, ~/.agents lock, agent detection)
 * and an empty project directory (project scope, skills-lock.json).
 */
export class Sandbox {
  readonly home: string;
  readonly project: string;

  private constructor(readonly root: string) {
    this.home = join(root, 'home');
    this.project = join(root, 'project');
  }

  static async create(name: string): Promise<Sandbox> {
    const parent = join(inject('e2eRoot'), 'sandboxes');
    await mkdir(parent, { recursive: true });
    const sandbox = new Sandbox(await mkdtemp(join(parent, `${name}-`)));
    await mkdir(sandbox.home);
    await mkdir(sandbox.project);
    return sandbox;
  }

  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return cleanEnv({
      HOME: this.home,
      USERPROFILE: this.home,
      npm_config_cache: inject('npmCache'),
      ...extra,
    });
  }

  /** Run the installed `skills` package (never the repo sources). */
  skills(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return exec(process.execPath, [inject('skillsBin'), ...args], {
      ...opts,
      cwd: opts.cwd ?? this.project,
      env: this.env(opts.env),
    });
  }

  /** Run any other tool (npm, git, ...) with the same clean environment. */
  run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
    return exec(cmd, args, { ...opts, cwd: opts.cwd ?? this.project, env: this.env(opts.env) });
  }

  /**
   * Run `body` as an async ES module function against the installed package's
   * library entry (`import * as api from 'skills'`, resolved through its exports
   * map). Runs in a child process because agent paths are computed from HOME at
   * import time. `body` sees `api`, `project`, `home`, and `codeOf(promise)`
   * (the diagnostic code a promise rejects with, or null), and returns a
   * JSON-serializable value.
   */
  async api<T = unknown>(body: string, opts: RunOptions = {}): Promise<ApiRunResult<T>> {
    const dir = join(inject('installDir'), 'api-scripts');
    await mkdir(dir, { recursive: true });
    const id = `${basename(this.root)}-${++this.apiRuns}`;
    const script = join(dir, `${id}.mjs`);
    const out = join(dir, `${id}.json`);
    await writeFile(
      script,
      [
        "import { writeFileSync } from 'node:fs';",
        "import * as api from 'skills';",
        'const [project, home, out] = process.argv.slice(2);',
        'async function codeOf(promise) {',
        '  try { await promise; return null; } catch (error) {',
        // instanceof check through the package's own isDiagnostic, not just a `code` field.
        '    return api.isDiagnostic(error, error?.code) ? error.code : `not a diagnostic: ${error}`;',
        '  }',
        '}',
        `const value = await (async () => {\n${body}\n})();`,
        'writeFileSync(out, JSON.stringify(value ?? null));',
      ].join('\n')
    );
    // --no-warnings: Node runtime notices (e.g. proxy agents) are not package output.
    const result = await exec(
      process.execPath,
      ['--no-warnings', script, this.project, this.home, out],
      {
        ...opts,
        cwd: opts.cwd ?? this.project,
        env: this.env(opts.env),
      }
    );
    return { ...result, value: JSON.parse(readFileSync(out, 'utf8')) as T };
  }

  private apiRuns = 0;

  /** `skills <args> --json`, parsed. */
  async skillsJson<T = JsonInstallResult[]>(args: string[], opts: RunOptions = {}): Promise<T> {
    const result = await this.skills([...args, '--json'], opts);
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new Error(`Expected JSON from \`skills ${args.join(' ')} --json\`:\n${result.output}`);
    }
  }

  path(...segments: string[]): string {
    return join(this.project, ...segments);
  }

  homePath(...segments: string[]): string {
    return join(this.home, ...segments);
  }

  async writeProjectFile(relativePath: string, content: string): Promise<void> {
    await writeFile(this.path(relativePath), content);
  }

  projectLock(): LocalLock {
    return JSON.parse(readFileSync(this.path('skills-lock.json'), 'utf8')) as LocalLock;
  }

  globalLock(): GlobalLock {
    return JSON.parse(readFileSync(this.homePath('.agents', '.skill-lock.json'), 'utf8'));
  }
}

export interface ApiRunResult<T> extends RunResult {
  /** What the script body returned. */
  value: T;
}

export interface JsonInstallResult {
  name: string;
  status: 'installed' | 'failed' | string;
  source?: string;
  path?: string;
  scope?: 'project' | 'global';
  agents?: string[];
  mode?: 'symlink' | 'copy';
  error?: string;
}

export interface JsonListEntry {
  name: string;
  path: string;
  scope: 'project' | 'global';
  agents: string[];
  source: string | null;
  sourceType: string | null;
}

export interface LocalLock {
  version: number;
  skills: Record<
    string,
    { source: string; sourceType: string; computedHash: string; skillPath?: string } & Record<
      string,
      unknown
    >
  >;
}

export interface GlobalLock {
  version: number;
  skills: Record<
    string,
    { source: string; sourceType: string; skillFolderHash: string; skillPath?: string } & Record<
      string,
      unknown
    >
  >;
}

/** A valid installed skill: a directory (or link to one) whose SKILL.md names it. */
export function readSkill(dir: string): { name: string; body: string } {
  const skillMd = join(dir, 'SKILL.md');
  if (!existsSync(skillMd)) {
    const listing = existsSync(dir) ? readdirSync(dir).join(', ') : '<missing>';
    throw new Error(`No SKILL.md in ${dir} (contents: ${listing})`);
  }
  const body = readFileSync(skillMd, 'utf8');
  const name = body.match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
  if (!name) throw new Error(`SKILL.md in ${dir} has no name in its frontmatter`);
  return { name, body };
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Entries in a directory, or [] when it does not exist. */
export function entries(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}
