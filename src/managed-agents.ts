import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { sanitizeName } from './installer.ts';

/**
 * Claude Managed Agents support.
 *
 * Skills for the `claude-managed-agents` target are not copied to a directory;
 * they are uploaded to the Anthropic Skills API, where they become available
 * to the user's managed agents (and to the Messages API code-execution
 * container). See https://platform.claude.com/docs/en/agents-and-tools/agent-skills
 *
 * Endpoints (beta `skills-2025-10-02`):
 *   POST /v1/skills                     create a skill (multipart `files[]`)
 *   GET  /v1/skills?source=custom       list custom skills
 *   POST /v1/skills/{id}/versions       create a new version of a skill
 *
 * Each multipart file part is named `files[]` and its filename carries the
 * skill-relative path prefixed with the skill directory name, e.g.
 * `my-skill/SKILL.md`.
 */

const SKILLS_BETA = 'skills-2025-10-02';
const OAUTH_BETA = 'oauth-2025-04-20';
const ANTHROPIC_VERSION = '2023-06-01';

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

const EXCLUDE_FILES = new Set(['metadata.json']);
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

/**
 * Collect a skill directory's files for upload, applying the same exclusion
 * rules as filesystem installs (see installer.ts copyDirectory).
 */
export async function collectSkillFiles(
  skillDir: string,
  relativeDir = ''
): Promise<SkillUploadFile[]> {
  const files: SkillUploadFile[] = [];
  const entries = await readdir(skillDir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(skillDir, entry.name);
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      try {
        isDirectory = (await stat(entryPath)).isDirectory();
      } catch {
        // Broken symlink — skip, matching copyDirectory behavior
        continue;
      }
    }

    if (isDirectory) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      files.push(...(await collectSkillFiles(entryPath, relativePath)));
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      files.push({ path: relativePath, content: await readFile(entryPath) });
    }
  }

  return files;
}

export class ManagedAgentsApiError extends Error {
  status: number;
  apiMessage: string;

  constructor(status: number, apiMessage: string, context: string) {
    super(`${context}: ${apiMessage} (HTTP ${status})`);
    this.name = 'ManagedAgentsApiError';
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function buildHeaders(auth: AnthropicAuth): Record<string, string> {
  return {
    ...auth.headers,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': [...auth.betas, SKILLS_BETA].join(','),
  };
}

function buildSkillForm(directory: string, displayTitle: string | null, files: SkillUploadFile[]) {
  const form = new FormData();
  if (displayTitle !== null) {
    form.append('display_title', displayTitle);
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
  display_title: string | null;
  latest_version: string | null;
}

interface SkillVersionResponse {
  skill_id: string;
  version: string;
}

interface SkillListResponse {
  data: SkillResponse[];
  has_more: boolean;
  last_id: string | null;
}

/**
 * Find an existing custom skill by display title. Used to upgrade a create
 * into a new-version upload when the skill already exists.
 */
async function findSkillByDisplayTitle(
  displayTitle: string,
  auth: AnthropicAuth
): Promise<SkillResponse | null> {
  const headers = buildHeaders(auth);
  let afterId: string | null = null;

  // Paginate defensively; orgs can accumulate many custom skills.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ beta: 'true', source: 'custom', limit: '100' });
    if (afterId) params.set('after_id', afterId);

    const response = await fetch(`${getApiBaseUrl()}/v1/skills?${params}`, { headers });
    if (!response.ok) {
      throw new ManagedAgentsApiError(
        response.status,
        await readApiError(response),
        'Failed to list skills'
      );
    }

    const body = (await response.json()) as SkillListResponse;
    const match = body.data.find((skill) => skill.display_title === displayTitle);
    if (match) return match;
    if (!body.has_more || !body.last_id) return null;
    afterId = body.last_id;
  }

  return null;
}

export interface ManagedSkillUploadResult {
  skillId: string;
  version: string;
  action: 'created' | 'updated';
}

/**
 * Upload a skill to the Anthropic Skills API. Creates the skill if it doesn't
 * exist; if a skill with the same display title already exists, uploads the
 * files as a new version of that skill instead.
 */
export async function uploadSkillToManagedAgents(
  skill: { name: string; files: SkillUploadFile[] },
  auth: AnthropicAuth
): Promise<ManagedSkillUploadResult> {
  if (!skill.files.some((file) => file.path === 'SKILL.md')) {
    throw new Error('Skill is missing a SKILL.md at its root');
  }

  const directory = sanitizeName(skill.name);
  const headers = buildHeaders(auth);
  const baseUrl = getApiBaseUrl();

  const createResponse = await fetch(`${baseUrl}/v1/skills?beta=true`, {
    method: 'POST',
    headers,
    body: buildSkillForm(directory, skill.name, skill.files),
  });

  if (createResponse.ok) {
    const created = (await createResponse.json()) as SkillResponse;
    return { skillId: created.id, version: created.latest_version ?? 'latest', action: 'created' };
  }

  const createError = await readApiError(createResponse);
  const isDisplayTitleConflict =
    createResponse.status === 400 && /display_title/i.test(createError);

  if (!isDisplayTitleConflict) {
    throw new ManagedAgentsApiError(createResponse.status, createError, 'Failed to create skill');
  }

  // A skill with this display title already exists — upload a new version.
  const existing = await findSkillByDisplayTitle(skill.name, auth);
  if (!existing) {
    throw new ManagedAgentsApiError(createResponse.status, createError, 'Failed to create skill');
  }

  const versionResponse = await fetch(
    `${baseUrl}/v1/skills/${encodeURIComponent(existing.id)}/versions?beta=true`,
    {
      method: 'POST',
      headers,
      body: buildSkillForm(directory, null, skill.files),
    }
  );

  if (!versionResponse.ok) {
    throw new ManagedAgentsApiError(
      versionResponse.status,
      await readApiError(versionResponse),
      'Failed to create skill version'
    );
  }

  const version = (await versionResponse.json()) as SkillVersionResponse;
  return { skillId: version.skill_id, version: version.version, action: 'updated' };
}
