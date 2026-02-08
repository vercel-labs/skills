import { mkdir, cp, readdir, symlink, lstat, rm, readlink } from 'fs/promises';
import { join, basename, resolve, relative, dirname } from 'path';
import { platform } from 'os';

const EXCLUDE_FILES = new Set(['README.md', 'metadata.json']);
const EXCLUDE_DIRS = new Set(['.git']);

const isExcluded = (name: string, isDirectory: boolean = false): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true;
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  return false;
};

export async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  // Copy files and directories in parallel
  await Promise.all(
    entries
      .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await cp(srcPath, destPath, {
            // If the file is a symlink to elsewhere in a remote skill, it may not
            // resolve correctly once it has been copied to the local location.
            // `dereference: true` tells Node to copy the file instead of copying
            // the symlink. `recursive: true` handles symlinks pointing to directories.
            dereference: true,
            recursive: true,
          });
        }
      })
  );
}

/**
 * Cleans and recreates a directory for skill installation.
 *
 * This ensures:
 * 1. Renamed/deleted files from previous installs are removed
 * 2. Symlinks (including self-referential ones causing ELOOP) are handled
 *    when canonical and agent paths resolve to the same location
 */
export async function cleanAndCreateDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors - mkdir will fail if there's a real problem
  }
  await mkdir(path, { recursive: true });
}

/**
 * Resolve a path's parent directory through symlinks, keeping the final component.
 * This handles the case where a parent directory (e.g., ~/.claude/skills) is a symlink
 * to another location (e.g., ~/.agents/skills). In that case, computing relative paths
 * from the symlink path produces broken symlinks.
 *
 * Returns the real path of the parent + the original basename.
 * If realpath fails (parent doesn't exist), returns the original resolved path.
 */
export async function resolveParentSymlinks(path: string): Promise<string> {
  const resolved = resolve(path);
  const dir = dirname(resolved);
  const base = basename(resolved);
  try {
    const { realpath } = await import('fs/promises');
    const realDir = await realpath(dir);
    return join(realDir, base);
  } catch {
    return resolved;
  }
}

function resolveSymlinkTarget(linkPath: string, linkTarget: string): string {
  return resolve(dirname(linkPath), linkTarget);
}

/**
 * Creates a symlink, handling cross-platform differences
 * Returns true if symlink was created, false if fallback to copy is needed
 */
export async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    if (resolvedTarget === resolvedLinkPath) {
      return true;
    }

    // Also check with symlinks resolved in parent directories.
    // This handles cases where e.g. ~/.claude/skills is a symlink to ~/.agents/skills,
    // so ~/.claude/skills/<skill> and ~/.agents/skills/<skill> are physically the same.
    const realTarget = await resolveParentSymlinks(target);
    const realLinkPath = await resolveParentSymlinks(linkPath);

    if (realTarget === realLinkPath) {
      return true;
    }

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (resolveSymlinkTarget(linkPath, existingTarget) === resolvedTarget) {
          return true;
        }
        await rm(linkPath);
      } else {
        await rm(linkPath, { recursive: true });
      }
    } catch (err: unknown) {
      // ELOOP = circular symlink, ENOENT = doesn't exist
      // For ELOOP, try to remove the broken symlink
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        try {
          await rm(linkPath, { force: true });
        } catch {
          // If we can't remove it, symlink creation will fail and trigger copy fallback
        }
      }
      // For ENOENT or other errors, continue to symlink creation
    }

    const linkDir = dirname(linkPath);
    await mkdir(linkDir, { recursive: true });

    // Use the real (symlink-resolved) parent directory for computing the relative path.
    // This ensures the symlink target is correct even when the link's parent dir is a symlink.
    const realLinkDir = await resolveParentSymlinks(linkDir);
    const relativePath = relative(realLinkDir, target);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;

    await symlink(relativePath, linkPath, symlinkType);
    return true;
  } catch {
    return false;
  }
}
