import { execFileSync } from 'child_process';
import { readFile, readdir, realpath, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { sanitizeName, isExcluded, isPathSafe } from './installer.ts';
import { readLocalLock } from './local-lock.ts';
import { readSkillLock } from './skill-lock.ts';

/**
 * Claude Managed Agents support.
 *
 * Skills for the `claude-managed-agents` target are not copied to a directory;
 * they are uploaded to the Anthropic Skills API (`/v1/skills`), where they
 * become available to the user's managed agents (and to the Messages API
 * code-execution container). See https://platform.claude.com/docs/en/managed-agents/skills
 */

const ANTHROPIC_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 30000;
const ANT_CLI_TIMEOUT_MS = 10000;

export interface AnthropicAuth {
  /** Request headers this credential needs (key or bearer token, workspace, betas). */
  headers: Record<string, string>;
  /** Where the credential came from, for user-facing messages. */
  source: 'ANTHROPIC_API_KEY' | 'ANTHROPIC_AUTH_TOKEN' | 'ant CLI' | 'ant credentials file';
}

interface AntCredentials {
  type?: string;
  access_token?: string;
  expires_at?: number;
  workspace_id?: string;
}

function getAntConfigDir(): string {
  const fromEnv = process.env.ANTHROPIC_CONFIG_DIR?.trim();
  if (fromEnv) return fromEnv;
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return join(xdg, 'anthropic');
  return join(homedir(), '.config', 'anthropic');
}

function authFromOAuthToken(
  credentials: AntCredentials,
  source: AnthropicAuth['source']
): AnthropicAuth | null {
  if (!credentials.access_token) return null;
  return {
    headers: {
      Authorization: `Bearer ${credentials.access_token}`,
      // OAuth access tokens are accepted on the API behind this beta.
      'anthropic-beta': 'oauth-2025-04-20',
      ...(credentials.workspace_id && { 'anthropic-workspace-id': credentials.workspace_id }),
    },
    source,
  };
}

/**
 * Read credentials written by `ant auth login` directly from disk. Used only
 * when the `ant` binary itself isn't available; unlike the CLI this cannot
 * refresh expired tokens, so expired credentials are rejected.
 */
async function readAntCredentialsFile(): Promise<AnthropicAuth | null> {
  try {
    const configDir = getAntConfigDir();
    const profile =
      process.env.ANTHROPIC_PROFILE?.trim() ||
      (await readFile(join(configDir, 'active_config'), 'utf-8').catch(() => '')).trim() ||
      'default';
    const credentialsPath = join(configDir, 'credentials', `${profile}.json`);
    const credentials = JSON.parse(await readFile(credentialsPath, 'utf-8')) as AntCredentials;

    // `type` may be omitted by external writers, but anything else is not an
    // OAuth token we know how to use.
    if (credentials.type !== undefined && credentials.type !== 'oauth_token') {
      return null;
    }
    // Leave a minute of headroom; without the ant binary we cannot refresh.
    if (
      typeof credentials.expires_at === 'number' &&
      credentials.expires_at * 1000 < Date.now() + 60_000
    ) {
      return null;
    }

    return authFromOAuthToken(credentials, 'ant credentials file');
  } catch {
    return null;
  }
}

/**
 * Shell out to `ant auth print-credentials`, which resolves the active
 * profile and refreshes the OAuth access token if it is expired or close to
 * expiry.
 */
function readAntCliCredentials(): AnthropicAuth | null {
  try {
    const output = execFileSync('ant', ['auth', 'print-credentials'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Don't hang the CLI on an ant binary that prompts or stalls on a
      // token refresh; the credentials-file fallback still gets a chance.
      timeout: ANT_CLI_TIMEOUT_MS,
    });
    return authFromOAuthToken(JSON.parse(output) as AntCredentials, 'ant CLI');
  } catch {
    // ant not installed or not logged in
    return null;
  }
}

/**
 * Resolve a credential for the Anthropic API, in the same precedence order
 * the Anthropic CLI uses: explicit env vars first, then the ant CLI's stored
 * (and auto-refreshed) OAuth credentials.
 */
export async function resolveAnthropicAuth(): Promise<AnthropicAuth | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) return { headers: { 'x-api-key': apiKey }, source: 'ANTHROPIC_API_KEY' };

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) {
    return { headers: { Authorization: `Bearer ${authToken}` }, source: 'ANTHROPIC_AUTH_TOKEN' };
  }

  return readAntCliCredentials() ?? readAntCredentialsFile();
}

export const MANAGED_AGENTS_AUTH_GUIDANCE =
  'Log in with the Anthropic CLI (`ant auth login`) or set the ANTHROPIC_API_KEY environment variable.';

export interface SkillUploadFile {
  /** Path relative to the skill directory, using forward slashes. */
  path: string;
  contents: string | Uint8Array;
}

/**
 * Collect a skill directory's files for upload, applying the same exclusion
 * rules as filesystem installs (see installer.ts copyDirectory).
 *
 * Symlinks are followed only when they resolve inside the skill directory.
 * Unlike a filesystem install, an upload sends file contents off the machine,
 * so a cloned repo must not be able to smuggle local files (e.g. a symlink to
 * an absolute path under the user's home) into the uploaded bundle.
 */
export async function collectSkillFiles(skillDir: string): Promise<SkillUploadFile[]> {
  const rootReal = await realpath(skillDir);
  return collectSkillFilesWithin(skillDir, rootReal, '');
}

async function collectSkillFilesWithin(
  dir: string,
  rootReal: string,
  relativeDir: string
): Promise<SkillUploadFile[]> {
  const files: SkillUploadFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(entryPath);
      } catch {
        // Broken symlink — skip, matching copyDirectory behavior
        continue;
      }
      if (!isPathSafe(rootReal, target)) {
        console.warn(`Skipping symlink outside skill directory: ${relativePath}`);
        continue;
      }
      isDirectory = (await stat(target)).isDirectory();
    }

    if (isExcluded(entry.name, isDirectory)) continue;
    if (isDirectory) {
      files.push(...(await collectSkillFilesWithin(entryPath, rootReal, relativePath)));
    } else {
      files.push({ path: relativePath, contents: await readFile(entryPath) });
    }
  }
  return files;
}

/** Call the Anthropic API with this credential's headers and a timeout. */
function skillsApi(auth: AnthropicAuth, path: string, init: RequestInit = {}): Promise<Response> {
  const base = (process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(
    /\/+$/,
    ''
  );
  return fetch(`${base}${path}`, {
    ...init,
    headers: { ...auth.headers, 'anthropic-version': ANTHROPIC_VERSION },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function apiError(response: Response, context: string): Promise<Error> {
  let detail = response.statusText;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    detail = body.error?.message || detail;
  } catch {
    // Non-JSON error body; the status text will do.
  }
  return new Error(`${context}: ${detail} (HTTP ${response.status})`);
}

/**
 * Multipart body for a create or version upload. Each part is named
 * `files[]`; its filename carries the file's path within the skill, prefixed
 * with the skill's top-level directory name (e.g. `my-skill/SKILL.md`).
 */
function buildSkillForm(directory: string, displayName: string | null, files: SkillUploadFile[]) {
  const form = new FormData();
  if (displayName !== null) form.append('display_name', displayName);
  for (const file of files) {
    form.append('files[]', new File([file.contents], `${directory}/${file.path}`));
  }
  return form;
}

const LIST_PAGE_SIZE = 1000; // the API maximum
const MAX_LIST_PAGES = 10;

/** Resolves a display name to the id of the newest custom skill carrying it. */
export type ManagedSkillLookup = (displayName: string) => Promise<string | null>;

/**
 * A lookup that lists the workspace's custom skills once, on first use, and
 * answers every later query from that snapshot — one listing per run rather
 * than one per uploaded skill.
 */
export function createManagedSkillLookup(auth: AnthropicAuth): ManagedSkillLookup {
  let listing: Promise<Map<string, string>> | undefined;
  return async (displayName) => {
    listing ??= listSkillIdsByDisplayName(auth);
    return (await listing).get(displayName) ?? null;
  };
}

/**
 * List the workspace's custom skills into a display name → skill id map.
 * Display names are not unique; the API lists newest first and the map
 * keeps the first (newest) id seen for each name.
 */
async function listSkillIdsByDisplayName(auth: AnthropicAuth): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let page: string | null = null;

  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    const params = new URLSearchParams({ source: 'custom', limit: String(LIST_PAGE_SIZE) });
    if (page) params.set('page', page);

    const response = await skillsApi(auth, `/v1/skills?${params}`);
    if (!response.ok) throw await apiError(response, 'Failed to list skills');

    const body = (await response.json()) as {
      data: Array<{ id: string; display_name: string }>;
      next_page: string | null;
    };
    for (const skill of body.data) {
      if (!ids.has(skill.display_name)) ids.set(skill.display_name, skill.id);
    }
    if (!body.next_page) return ids;
    page = body.next_page;
  }

  console.warn(
    `Only the newest ${MAX_LIST_PAGES * LIST_PAGE_SIZE} custom skills were listed; ` +
      'an older skill with a matching name would be re-created rather than versioned.'
  );
  return ids;
}

export interface ManagedSkillUploadResult {
  skillId: string;
  action: 'created' | 'updated';
}

/**
 * Upload `files` as a new version of `skillId`. Returns null when that skill
 * can't take the upload: 404 (deleted, or credentials now point at another
 * workspace) or 400 (malformed id from a hand-edited lock, or a skill whose
 * `name` slug differs from this upload's). The caller then moves on to the
 * next candidate; a 400 caused by the files themselves fails identically at
 * create time and is surfaced there.
 */
async function tryUploadSkillVersion(
  auth: AnthropicAuth,
  skillId: string,
  directory: string,
  files: SkillUploadFile[]
): Promise<ManagedSkillUploadResult | null> {
  const response = await skillsApi(auth, `/v1/skills/${encodeURIComponent(skillId)}/versions`, {
    method: 'POST',
    body: buildSkillForm(directory, null, files),
  });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw await apiError(response, 'Failed to create skill version');
  const version = (await response.json()) as { skill_id: string };
  return { skillId: version.skill_id, action: 'updated' };
}

/**
 * Upload a skill to the Anthropic Skills API as a new version of an existing
 * skill when one can be found, otherwise as a new skill.
 *
 * Candidates for versioning, in order: `knownSkillId` (recorded in the lock
 * file by a previous upload), then the newest workspace skill whose display
 * name equals the skill name. The API doesn't enforce unique names, so
 * without the display-name lookup every install from a project with no
 * usable lock entry would create a duplicate skill in the workspace. Pass one
 * `lookup` per run so the workspace is listed once.
 */
export async function uploadSkillToManagedAgents(
  skill: { name: string; files: SkillUploadFile[] },
  auth: AnthropicAuth,
  options: { knownSkillId?: string; lookup?: ManagedSkillLookup } = {}
): Promise<ManagedSkillUploadResult> {
  // Case-insensitive filesystems discover a lowercase `skill.md`, but the
  // API requires the exact-case name — normalize instead of rejecting a
  // skill that installs fine to filesystem agents.
  const files = skill.files.map((file) =>
    file.path.toLowerCase() === 'skill.md' && file.path !== 'SKILL.md'
      ? { ...file, path: 'SKILL.md' }
      : file
  );
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('Skill is missing a SKILL.md at its root');
  }

  const directory = sanitizeName(skill.name);
  const { knownSkillId, lookup = createManagedSkillLookup(auth) } = options;

  if (knownSkillId) {
    const result = await tryUploadSkillVersion(auth, knownSkillId, directory, files);
    if (result) return result;
  }

  const existingId = await lookup(skill.name);
  if (existingId && existingId !== knownSkillId) {
    const result = await tryUploadSkillVersion(auth, existingId, directory, files);
    if (result) return result;
  }

  const response = await skillsApi(auth, '/v1/skills', {
    method: 'POST',
    body: buildSkillForm(directory, skill.name, files),
  });
  if (!response.ok) throw await apiError(response, 'Failed to create skill');
  const created = (await response.json()) as { id: string };
  return { skillId: created.id, action: 'created' };
}

/**
 * Sentinel written in place of a content hash or digest when part of a
 * requested install (filesystem copy or upload) did not complete. Never
 * equal to a real hash, so a later `update` sees the entry as changed and
 * retries the whole install instead of treating the skill as current.
 */
export const PENDING_INSTALL_HASH = 'pending-install';

export interface ManagedUploadOutcome {
  skill: string;
  success: boolean;
  skillId?: string;
  action?: 'created' | 'updated';
  error?: string;
}

/**
 * Skills API ids a previous run recorded in the lock, restricted to entries
 * whose source matches this run's, so a same-named skill from another source
 * doesn't take the recorded id as a direct-version shortcut.
 */
export function knownManagedIds(
  entries: Record<string, { source: string; managedSkillId?: string }>,
  sourceKey: string | null
): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.managedSkillId && entry.source === sourceKey) ids.set(name, entry.managedSkillId);
  }
  return ids;
}

/**
 * Shape one run's upload outcomes for the lock writes. `requested` says
 * which halves of the install (filesystem copy, upload) this run asked for.
 */
export function summarizeManagedUploads(
  outcomes: ManagedUploadOutcome[],
  knownIds: Map<string, string>,
  requested: { upload: boolean; fs: boolean }
) {
  const uploaded = new Map(
    outcomes.filter((o) => o.success && o.skillId).map((o) => [o.skill, o.skillId!])
  );
  return {
    outcomes,
    /** Number of skills that reached the Skills API this run. */
    uploads: uploaded.size,
    /**
     * Lock bookkeeping for one skill, or null when neither its copy nor its
     * upload landed. `hash` swaps in PENDING_INSTALL_HASH when a requested
     * half didn't complete, so `update` retries it; `managedSkillId` is this
     * run's upload, else the id already recorded for this source.
     */
    lockEntry(name: string, fsSucceeded: boolean) {
      if (!fsSucceeded && !uploaded.has(name)) return null;
      const complete = (!requested.fs || fsSucceeded) && (!requested.upload || uploaded.has(name));
      return {
        hash: (real: string) => (complete ? real : PENDING_INSTALL_HASH),
        managedSkillId: uploaded.get(name) ?? knownIds.get(name),
      };
    },
  };
}

export type ManagedUploadPass = ReturnType<typeof summarizeManagedUploads>;

/**
 * Upload pass for the Claude Managed Agents target. Skills with an id
 * recorded in this scope's lock are versioned directly; the rest are matched
 * by display name or created. One skill at a time; a failure doesn't stop
 * the rest. Without credentials nothing is uploaded, but recorded ids still
 * flow into `lockEntry` so a filesystem-only re-add keeps them in the lock.
 */
export async function runManagedUploads(
  run: { auth: AnthropicAuth | null; uploadRequested: boolean; fsRequested: boolean },
  skills: Array<{ name: string; files: () => SkillUploadFile[] | Promise<SkillUploadFile[]> }>,
  scope: { installGlobally: boolean; cwd: string; sourceKey: string | null }
): Promise<ManagedUploadPass> {
  const lock = scope.installGlobally ? await readSkillLock() : await readLocalLock(scope.cwd);
  const knownIds = knownManagedIds(lock.skills, scope.sourceKey);

  const outcomes: ManagedUploadOutcome[] = [];
  if (run.auth) {
    const lookup = createManagedSkillLookup(run.auth);
    for (const skill of skills) {
      try {
        const result = await uploadSkillToManagedAgents(
          { name: skill.name, files: await skill.files() },
          run.auth,
          { knownSkillId: knownIds.get(skill.name), lookup }
        );
        outcomes.push({ skill: skill.name, success: true, ...result });
      } catch (error) {
        outcomes.push({
          skill: skill.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }
  return summarizeManagedUploads(outcomes, knownIds, {
    upload: run.uploadRequested,
    fs: run.fsRequested,
  });
}
