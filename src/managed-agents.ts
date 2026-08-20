import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile, readdir, realpath, stat } from 'fs/promises';
import { homedir } from 'os';
import { join, sep } from 'path';
import { sanitizeName, EXCLUDE_FILES, EXCLUDE_DIRS } from './installer.ts';

/**
 * Claude Managed Agents support.
 *
 * Skills for the `claude-managed-agents` target are not copied to a directory;
 * they are uploaded to the Anthropic Skills API, where they become available
 * to the user's managed agents (and to the Messages API code-execution
 * container). See https://platform.claude.com/docs/en/managed-agents/skills
 *
 * Endpoints:
 *   POST /v1/skills                     create a skill (multipart `files[]`)
 *   GET  /v1/skills?source=custom       list the workspace's custom skills
 *   POST /v1/skills/{id}/versions       create a new version of a skill
 *
 * Each multipart file part is named `files[]` and its filename carries the
 * skill-relative path prefixed with the skill directory name, e.g.
 * `my-skill/SKILL.md`.
 */

const OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_VERSION = '2023-06-01';
const FETCH_TIMEOUT_MS = 30000;
const ANT_CLI_TIMEOUT_MS = 10000;

export interface AnthropicAuth {
  /** Credential headers (x-api-key or Authorization, plus workspace binding). */
  headers: Record<string, string>;
  /** Extra anthropic-beta values required by this credential kind. */
  betas: string[];
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.access_token}`,
  };
  if (credentials.workspace_id) {
    headers['anthropic-workspace-id'] = credentials.workspace_id;
  }
  return { headers, betas: [OAUTH_BETA], source };
}

/**
 * Read credentials written by `ant auth login` directly from disk. Used only
 * when the `ant` binary itself isn't available; unlike the CLI this cannot
 * refresh expired tokens, so expired credentials are rejected.
 */
async function readAntCredentialsFile(): Promise<AnthropicAuth | null> {
  try {
    const configDir = getAntConfigDir();
    let profile = process.env.ANTHROPIC_PROFILE?.trim();
    if (!profile) {
      const activeConfigPath = join(configDir, 'active_config');
      profile = existsSync(activeConfigPath)
        ? (await readFile(activeConfigPath, 'utf-8')).trim() || 'default'
        : 'default';
    }

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
    const credentials = JSON.parse(output) as AntCredentials;
    return authFromOAuthToken(credentials, 'ant CLI');
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
  if (apiKey) {
    return { headers: { 'x-api-key': apiKey }, betas: [], source: 'ANTHROPIC_API_KEY' };
  }

  const authToken = process.env.ANTHROPIC_AUTH_TOKEN?.trim();
  if (authToken) {
    return {
      headers: { Authorization: `Bearer ${authToken}` },
      betas: [],
      source: 'ANTHROPIC_AUTH_TOKEN',
    };
  }

  const fromCli = readAntCliCredentials();
  if (fromCli) return fromCli;

  return readAntCredentialsFile();
}

export const MANAGED_AGENTS_AUTH_GUIDANCE =
  'Log in with the Anthropic CLI (`ant auth login`) or set the ANTHROPIC_API_KEY environment variable.';

function getApiBaseUrl(): string {
  const base = process.env.ANTHROPIC_BASE_URL?.trim();
  return (base || 'https://api.anthropic.com').replace(/\/+$/, '');
}

export interface SkillUploadFile {
  /** Path relative to the skill directory, using forward slashes. */
  path: string;
  content: string | Uint8Array;
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
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
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
      if (target !== rootReal && !target.startsWith(rootReal + sep)) {
        console.warn(`Skipping symlink outside skill directory: ${relativePath}`);
        continue;
      }
      isDirectory = (await stat(target)).isDirectory();
    }

    if (isDirectory) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      files.push(...(await collectSkillFilesWithin(entryPath, rootReal, relativePath)));
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      files.push({ path: relativePath, content: await readFile(entryPath) });
    }
  }

  return files;
}

/** A non-2xx response from the Skills API. */
export class ManagedAgentsApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ManagedAgentsApiError';
    this.status = status;
  }

  static async from(response: Response, context: string): Promise<ManagedAgentsApiError> {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body.error?.message || detail;
    } catch {
      // Non-JSON error body; the status text will do.
    }
    return new ManagedAgentsApiError(
      response.status,
      `${context}: ${detail} (HTTP ${response.status})`
    );
  }
}

function buildHeaders(auth: AnthropicAuth): Record<string, string> {
  const headers: Record<string, string> = {
    ...auth.headers,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (auth.betas.length > 0) {
    headers['anthropic-beta'] = auth.betas.join(',');
  }
  return headers;
}

function buildSkillForm(directory: string, displayName: string | null, files: SkillUploadFile[]) {
  const form = new FormData();
  if (displayName !== null) {
    form.append('display_name', displayName);
  }
  for (const file of files) {
    // The multipart filename carries the file's path within the skill,
    // prefixed with the skill's top-level directory name.
    const content = typeof file.content === 'string' ? file.content : new Uint8Array(file.content);
    form.append('files[]', new File([content], `${directory}/${file.path}`));
  }
  return form;
}

interface SkillResponse {
  id: string;
  display_name: string;
  latest_version_id: string;
}

interface SkillVersionResponse {
  id: string;
  skill_id: string;
}

interface SkillListResponse {
  data: SkillResponse[];
  next_page: string | null;
}

/**
 * Find the workspace's most recently created custom skill with this display
 * name. Display names are not unique, so this is a best-effort match used
 * only when the lock has no recorded skill id; the list is newest-first.
 */
async function findSkillByDisplayName(
  displayName: string,
  auth: AnthropicAuth
): Promise<SkillResponse | null> {
  const headers = buildHeaders(auth);
  let page: string | null = null;

  // Paginate defensively; workspaces can accumulate many custom skills.
  for (let i = 0; i < 20; i++) {
    const params = new URLSearchParams({ source: 'custom', limit: '100' });
    if (page) params.set('page', page);

    const response = await fetch(`${getApiBaseUrl()}/v1/skills?${params}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw await ManagedAgentsApiError.from(response, 'Failed to list skills');

    const body = (await response.json()) as SkillListResponse;
    const match = body.data.find((skill) => skill.display_name === displayName);
    if (match) return match;
    if (!body.next_page) return null;
    page = body.next_page;
  }

  return null;
}

export interface ManagedSkillUploadResult {
  skillId: string;
  versionId: string;
  action: 'created' | 'updated';
}

/** Upload `files` as a new version of an existing skill. */
async function uploadSkillVersion(
  skillId: string,
  directory: string,
  files: SkillUploadFile[],
  headers: Record<string, string>
): Promise<ManagedSkillUploadResult> {
  const response = await fetch(
    `${getApiBaseUrl()}/v1/skills/${encodeURIComponent(skillId)}/versions`,
    {
      method: 'POST',
      headers,
      body: buildSkillForm(directory, null, files),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw await ManagedAgentsApiError.from(response, 'Failed to create skill version');
  }
  const version = (await response.json()) as SkillVersionResponse;
  return { skillId: version.skill_id, versionId: version.id, action: 'updated' };
}

/**
 * Like uploadSkillVersion, but returns null when the target skill can't take
 * the upload: 404 (deleted, or credentials now point at another workspace)
 * or 400 (malformed id from a hand-edited lock, or a skill whose `name` slug
 * differs from this upload's). The caller then moves on to the next
 * candidate; a 400 caused by the files themselves fails identically at
 * create time and is surfaced there.
 */
async function tryUploadSkillVersion(
  ...args: Parameters<typeof uploadSkillVersion>
): Promise<ManagedSkillUploadResult | null> {
  try {
    return await uploadSkillVersion(...args);
  } catch (error) {
    const status = error instanceof ManagedAgentsApiError ? error.status : 0;
    if (status === 404 || status === 400) return null;
    throw error;
  }
}

/**
 * Upload a skill to the Anthropic Skills API as a new version of an existing
 * skill when one can be found, otherwise as a new skill.
 *
 * Candidates for versioning, in order: `knownSkillId` (recorded in the lock
 * file by a previous upload), then the newest workspace skill whose display
 * name equals the skill name. The API doesn't enforce unique names, so
 * without the display-name lookup every install from a project with no lock
 * entry would create a duplicate skill in the workspace.
 */
export async function uploadSkillToManagedAgents(
  skill: { name: string; files: SkillUploadFile[] },
  auth: AnthropicAuth,
  knownSkillId?: string
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
  const headers = buildHeaders(auth);

  if (knownSkillId) {
    const result = await tryUploadSkillVersion(knownSkillId, directory, files, headers);
    if (result) return result;
  }

  const existing = await findSkillByDisplayName(skill.name, auth);
  if (existing && existing.id !== knownSkillId) {
    const result = await tryUploadSkillVersion(existing.id, directory, files, headers);
    if (result) return result;
  }

  const response = await fetch(`${getApiBaseUrl()}/v1/skills`, {
    method: 'POST',
    headers,
    body: buildSkillForm(directory, skill.name, files),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw await ManagedAgentsApiError.from(response, 'Failed to create skill');
  const created = (await response.json()) as SkillResponse;
  return { skillId: created.id, versionId: created.latest_version_id, action: 'created' };
}
