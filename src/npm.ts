import { spawn } from 'child_process';
import { mkdtemp, readdir, rm, stat } from 'fs/promises';
import { tmpdir, platform } from 'os';
import { join, normalize, resolve, sep } from 'path';

const DEFAULT_NPM_TIMEOUT_MS = 300_000; // 5 minutes
const NPM_TIMEOUT_MS = (() => {
  const raw = process.env.SKILLS_NPM_TIMEOUT_MS;
  if (!raw) return DEFAULT_NPM_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NPM_TIMEOUT_MS;
})();

export class NpmPackError extends Error {
  readonly spec: string;
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;

  constructor(message: string, spec: string, isTimeout = false, isAuthError = false) {
    super(message);
    this.name = 'NpmPackError';
    this.spec = spec;
    this.isTimeout = isTimeout;
    this.isAuthError = isAuthError;
  }
}

/**
 * Spawn a child process and resolve with its stdout/stderr/exit info.
 * Rejects with NpmPackError on timeout or spawn failure.
 */
function runCommand(
  command: string,
  args: string[],
  spec: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWindows = platform() === 'win32';
    const child = spawn(command, args, {
      // npm.cmd on Windows requires shell: true to be located on PATH
      shell: isWindows,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, NPM_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        rejectPromise(
          new NpmPackError(
            `'${command}' not found on PATH. Install Node.js (which provides npm) and tar to use npm: sources.`,
            spec
          )
        );
        return;
      }
      rejectPromise(new NpmPackError(`Failed to run '${command}': ${err.message}`, spec));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const seconds = Math.round(NPM_TIMEOUT_MS / 1000);
        rejectPromise(
          new NpmPackError(
            `'${command} ${args.join(' ')}' timed out after ${seconds}s. ` +
              `Raise the timeout with SKILLS_NPM_TIMEOUT_MS=600000 (10m).`,
            spec,
            true
          )
        );
        return;
      }
      resolvePromise({ stdout, stderr, code });
    });
  });
}

/**
 * Download an npm package as a tarball using `npm pack` and extract it
 * into a fresh temp directory. Returns the path to the extracted package
 * directory (the "package/" folder inside the tarball).
 *
 * Uses the user's npm configuration (registry, auth, proxy). Does NOT
 * install dependencies and does NOT run install scripts.
 *
 * Requires `npm` and `tar` on PATH. Both ship with the standard Node.js
 * install on macOS/Linux and with Windows 10+ (tar.exe is built in).
 */
export async function npmPackAndExtract(spec: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-npm-'));
  try {
    // 1. Download the tarball into tempDir
    const packResult = await runCommand(
      'npm',
      ['pack', spec, '--pack-destination', tempDir, '--silent'],
      spec
    );

    if (packResult.code !== 0) {
      const stderr = packResult.stderr.trim();
      const isAuthError = /401|403|EAUTHIP|EAUTH|forbidden|unauthorized|authentication/i.test(
        stderr
      );
      throw new NpmPackError(
        `'npm pack ${spec}' failed${stderr ? `:\n${stderr}` : ''}`,
        spec,
        false,
        isAuthError
      );
    }

    // 2. Locate the .tgz that npm pack wrote
    const entries = await readdir(tempDir);
    const tarballName = entries.find((name) => name.endsWith('.tgz'));
    if (!tarballName) {
      throw new NpmPackError(
        `'npm pack ${spec}' completed but no .tgz file was found in ${tempDir}`,
        spec
      );
    }
    const tarballPath = join(tempDir, tarballName);

    // 3. Validate the tarball is inside tempDir before invoking tar.
    // Defends against pathological filenames (npm doesn't produce them, but be safe).
    const normalizedTarball = normalize(resolve(tarballPath));
    const normalizedTempDir = normalize(resolve(tempDir));
    if (!normalizedTarball.startsWith(normalizedTempDir + sep)) {
      throw new NpmPackError(`Tarball path escaped temp dir: ${tarballPath}`, spec);
    }

    // 4. Extract: tar -xzf <tarball> -C <tempDir>
    // npm tarballs unpack into a top-level "package/" directory by convention.
    const tarResult = await runCommand('tar', ['-xzf', tarballPath, '-C', tempDir], spec);
    if (tarResult.code !== 0) {
      throw new NpmPackError(
        `'tar -xzf ${tarballName}' failed${tarResult.stderr ? `:\n${tarResult.stderr.trim()}` : ''}`,
        spec
      );
    }

    // 5. Confirm the expected package/ directory was produced
    const packageDir = join(tempDir, 'package');
    try {
      const stats = await stat(packageDir);
      if (!stats.isDirectory()) {
        throw new NpmPackError(`Expected '${packageDir}' to be a directory after extraction`, spec);
      }
    } catch (err) {
      if (err instanceof NpmPackError) throw err;
      throw new NpmPackError(
        `Tarball did not contain a 'package/' directory after extraction`,
        spec
      );
    }

    return packageDir;
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Clean up a temp directory created by npmPackAndExtract.
 *
 * The argument is the package/ subdirectory; we walk one level up so the
 * tarball, the extracted folder, and the mkdtemp root all get removed.
 */
export async function cleanupNpmTempDir(packageDir: string): Promise<void> {
  const normalizedPkg = normalize(resolve(packageDir));
  const normalizedTmp = normalize(resolve(tmpdir()));
  if (!normalizedPkg.startsWith(normalizedTmp + sep)) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  // packageDir = <tmp>/skills-npm-XXXX/package — clean up the parent
  const tempRoot = normalize(resolve(packageDir, '..'));
  if (!tempRoot.startsWith(normalizedTmp + sep)) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }
  await rm(tempRoot, { recursive: true, force: true });
}
