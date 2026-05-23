import { existsSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

export interface AnythingLLMProject {
  id: string;
  title: string;
  slug?: string;
  updatedAt?: string;
}

export interface AnythingLLMStoragePaths {
  storageDir: string;
  skillsDir: string;
  databasePath: string;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

export function getAnythingLLMSkillsDirCandidates(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const explicitSkillsDir = nonEmptyEnv(env.ANYTHINGLLM_SKILLS_DIR);
  if (explicitSkillsDir) return [resolve(explicitSkillsDir)];

  const storageDir = nonEmptyEnv(env.STORAGE_DIR);
  const candidates = [
    ...(storageDir ? [resolve(storageDir, 'plugins', 'agent-skills')] : []),
    resolve(cwd, 'plugins', 'agent-skills'),
    resolve(cwd, 'server', 'storage', 'plugins', 'agent-skills'),
    resolve(cwd, 'storage', 'plugins', 'agent-skills'),
    ...desktopStorageCandidates(undefined, env).map((candidate) =>
      resolve(candidate, 'plugins', 'agent-skills')
    ),
  ];

  return unique(candidates);
}

export function getAnythingLLMSkillsDir(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync
): string {
  const candidates = getAnythingLLMSkillsDirCandidates(cwd, env);
  return candidates.find(pathExists) ?? candidates[0]!;
}

export function isAnythingLLMInstalled(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync
): boolean {
  return getAnythingLLMSkillsDirCandidates(cwd, env).some(pathExists);
}

function storageDirFromSkillsDir(skillsDir: string): string | undefined {
  const normalized = resolve(skillsDir);
  const pluginsDir = dirname(normalized);
  if (basename(normalized) !== 'agent-skills' || basename(pluginsDir) !== 'plugins') {
    return undefined;
  }
  return dirname(pluginsDir);
}

function desktopStorageCandidates(homeDir = homedir(), env: NodeJS.ProcessEnv = process.env) {
  const appData = nonEmptyEnv(env.APPDATA);
  const xdgConfigHome = nonEmptyEnv(env.XDG_CONFIG_HOME);
  const candidates = [
    ...(appData ? [join(appData, 'anythingllm-desktop', 'storage')] : []),
    join(homeDir, 'Library', 'Application Support', 'anythingllm-desktop', 'storage'),
    join(xdgConfigHome || join(homeDir, '.config'), 'anythingllm-desktop', 'storage'),
  ];

  return unique(candidates);
}

export function resolveAnythingLLMStorage(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    explicitStorageDir?: string;
    pathExists?: (path: string) => boolean;
  } = {}
): AnythingLLMStoragePaths {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const pathExists = options.pathExists || existsSync;
  const explicitStorageDir = nonEmptyEnv(options.explicitStorageDir);
  const explicitSkillsDir = nonEmptyEnv(env.ANYTHINGLLM_SKILLS_DIR);
  const envStorageDir = nonEmptyEnv(env.STORAGE_DIR);

  const candidates = unique([
    ...(explicitStorageDir ? [resolve(explicitStorageDir)] : []),
    ...(explicitSkillsDir ? [storageDirFromSkillsDir(explicitSkillsDir)].filter(Boolean) : []),
    ...(envStorageDir ? [resolve(envStorageDir)] : []),
    resolve(cwd, 'server', 'storage'),
    resolve(cwd, 'storage'),
    ...desktopStorageCandidates(undefined, env).filter(pathExists),
  ] as string[]);

  const storageDir = candidates.find(pathExists) ?? candidates[0] ?? resolve(cwd, 'storage');
  return {
    storageDir,
    skillsDir: resolve(storageDir, 'plugins', 'agent-skills'),
    databasePath: resolve(storageDir, 'anythingllm.db'),
  };
}

export function resolveAnythingLLMProject(
  projects: AnythingLLMProject[],
  query: string
): AnythingLLMProject {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new Error('AnythingLLM project cannot be empty.');
  }
  const matches = projects.filter(
    (project) =>
      project.id.toLowerCase() === normalizedQuery ||
      project.slug?.toLowerCase() === normalizedQuery ||
      project.title.toLowerCase() === normalizedQuery
  );

  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Multiple AnythingLLM projects match "${query}". Use the project id or slug.`);
  }
  throw new Error(`No AnythingLLM project found matching "${query}".`);
}

async function importNodeSqlite(): Promise<{
  DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => unknown;
}> {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<{
    DatabaseSync?: new (path: string, options?: { readOnly?: boolean }) => unknown;
  }>;
  const emitWarning = process.emitWarning;

  try {
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const warningName =
        typeof args[0] === 'string'
          ? args[0]
          : typeof args[0] === 'object' && args[0] && 'type' in args[0]
            ? String((args[0] as { type?: unknown }).type)
            : undefined;
      const warningMessage = typeof warning === 'string' ? warning : warning.message;

      if (warningName === 'ExperimentalWarning' && /SQLite/i.test(warningMessage)) {
        return;
      }

      return emitWarning.call(process, warning as never, ...(args as never[]));
    }) as typeof process.emitWarning;

    return await dynamicImport('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}

export async function listAnythingLLMProjects(
  storage: Pick<AnythingLLMStoragePaths, 'databasePath'>,
  options: { pathExists?: (path: string) => boolean } = {}
): Promise<AnythingLLMProject[]> {
  const pathExists = options.pathExists || existsSync;
  if (!pathExists(storage.databasePath)) return [];

  try {
    const sqlite = await importNodeSqlite();
    if (!sqlite.DatabaseSync) return [];

    const database = new sqlite.DatabaseSync(storage.databasePath, { readOnly: true }) as {
      prepare(query: string): { all(): Array<Record<string, unknown>> };
      close(): void;
    };
    try {
      const rows = database
        .prepare('SELECT id, name, slug, lastUpdatedAt FROM workspaces ORDER BY LOWER(name), id')
        .all();
      return rows.flatMap((row) => {
        const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : '';
        const title = typeof row.name === 'string' ? row.name.trim() : '';
        if (!id || !title) return [];

        return [
          {
            id,
            title,
            slug: typeof row.slug === 'string' ? row.slug : undefined,
            updatedAt: typeof row.lastUpdatedAt === 'string' ? row.lastUpdatedAt : undefined,
          },
        ];
      });
    } finally {
      database.close();
    }
  } catch {
    return [];
  }
}
