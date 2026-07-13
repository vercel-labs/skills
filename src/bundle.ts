/**
 * `bundle` command group.
 *
 * A bundle is a curated set of skills, described by a `bundle.yaml` that
 * lives at `bundles/<name>/bundle.yaml` in the same repo as the skills it
 * bundles (co-location is required). Bundle operations are a thin composition
 * layer on top of the existing skill install pipeline:
 *
 *   bundle install <org>/<repo>@<name>
 *     → read bundles/<name>/bundle.yaml
 *     → resolve each member skill by its exact (repo, path) coordinate
 *     → delegate to runAdd() with the skills tagged as the bundle
 *
 * Member skills are resolved by repo-relative path, never by name, so the
 * right skill is installed even when names collide within or across repos.
 * Everything downstream (cloning, agent selection, symlinking, lockfile
 * writing, and list/remove grouping) is reused unchanged — the bundle tag is
 * recorded on each lock entry as `bundleName` (distinct from `pluginName`,
 * which the plugin-manifest grouping owns), which list/remove/update
 * group on.
 */

import { join } from 'path';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import pc from 'picocolors';

import { runAdd, parseAddOptions } from './add.ts';
import { parseSource, getOwnerRepo } from './source-parser.ts';
import { getGitHubToken, getAllLockedSkills } from './skill-lock.ts';
import { readLocalLock } from './local-lock.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { isRunningInAgent } from './detect-agent.ts';
import { interactiveSearch } from './search-prompt.ts';

const FETCH_TIMEOUT = 10_000;

// Display name for the CLI in help/error text, and the API base for bundle
// search. Kept as locals so branded distributions can override them in one spot.
const CLI_NAME = 'npx skills';
const API_BASE = 'https://skills.sh';

/** Parsed `bundle.yaml` descriptor. */
export interface BundleManifest {
  name: string;
  version?: string;
  description?: string;
  /** Repo-root-relative paths to skill directories, co-located with the bundle. */
  skills: string[];
}

/** Strip trailing slashes from a manifest skill path. */
function normalizeSkillPath(path: string): string {
  return path.replace(/\/+$/, '');
}

/**
 * Validate and normalize a parsed bundle.yaml object.
 * Throws with a clear message when required fields are missing or mistyped.
 * Enforces co-location statically: every skill entry must be a bare
 * repo-relative path (no absolute paths, no `..` traversal) — existence
 * within the repo is verified at install time.
 */
export function normalizeBundleManifest(raw: unknown, ref: string): BundleManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${ref}: bundle.yaml must be a YAML mapping.`);
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new Error(`${ref}: bundle.yaml is missing a string 'name'.`);
  }
  if (
    !Array.isArray(obj.skills) ||
    obj.skills.length === 0 ||
    !obj.skills.every((s) => typeof s === 'string')
  ) {
    throw new Error(`${ref}: bundle.yaml 'skills' must be a non-empty list of paths.`);
  }
  const skills = (obj.skills as string[]).map(normalizeSkillPath);
  for (const path of skills) {
    if (!path || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(
        `${ref}: bundle.yaml skill path '${path}' must be a repo-relative path inside the bundle's repository.`
      );
    }
  }
  return {
    name: obj.name,
    version: typeof obj.version === 'string' ? obj.version : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    skills,
  };
}

/**
 * Fetch bundle.yaml text from a GitHub repo without a full clone, using the
 * Contents API (works for private repos with a token). Returns null if the
 * file can't be fetched this way (caller falls back to cloning).
 */
async function fetchBundleYamlViaApi(
  ownerRepo: string,
  bundleName: string,
  ref: string | undefined
): Promise<string | null> {
  const path = `bundles/${bundleName}/bundle.yaml`;
  const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const url = `https://api.github.com/repos/${ownerRepo}/contents/${path}${refQuery}`;

  const attempt = async (token: string | null): Promise<string | null> => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3.raw',
      'User-Agent': 'skills-cli',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT) });
      if (res.ok) return await res.text();
      return null;
    } catch {
      return null;
    }
  };

  // Unauthenticated first (public repos); fall back to a token for private/rate-limited.
  const unauth = await attempt(null);
  if (unauth !== null) return unauth;
  const token = getGitHubToken();
  if (!token) return null;
  return attempt(token);
}

/**
 * Load a bundle manifest for `<ownerRepo>@<bundleName>`.
 * Tries the GitHub Contents API first, then falls back to a shallow clone.
 */
export async function loadBundleManifest(
  ownerRepo: string,
  bundleName: string,
  cloneUrl: string,
  ref?: string
): Promise<BundleManifest> {
  const displayRef = `${ownerRepo}@${bundleName}`;

  const viaApi = await fetchBundleYamlViaApi(ownerRepo, bundleName, ref);
  if (viaApi !== null) {
    return normalizeBundleManifest(parseYaml(viaApi), displayRef);
  }

  // Fallback: clone and read from disk (handles non-GitHub hosts and private
  // repos where only git credentials — not an API token — are available).
  let tempDir: string | null = null;
  try {
    tempDir = await cloneRepo(cloneUrl, ref);
    const manifestPath = join(tempDir, 'bundles', bundleName, 'bundle.yaml');
    let text: string;
    try {
      text = await readFile(manifestPath, 'utf-8');
    } catch {
      throw new Error(
        `Bundle '${bundleName}' not found in ${ownerRepo} (expected bundles/${bundleName}/bundle.yaml).`
      );
    }
    return normalizeBundleManifest(parseYaml(text), displayRef);
  } finally {
    if (tempDir) await cleanupTempDir(tempDir);
  }
}

// --------------------------------------------------------------------------- #
// Subcommands
// --------------------------------------------------------------------------- #

async function runBundleInstall(args: string[]): Promise<void> {
  const { source, options } = parseAddOptions(args);
  const rawSource = source[0];

  if (!rawSource) {
    console.error(pc.red('Missing bundle source.'));
    console.error(pc.dim(`Usage: ${CLI_NAME} bundle install <org>/<repo>@<bundle-name>`));
    process.exit(1);
  }

  const parsed = parseSource(rawSource);
  const bundleName = parsed.skillFilter;
  if (!bundleName) {
    console.error(pc.red('Specify the bundle name: <org>/<repo>@<bundle-name>'));
    process.exit(1);
  }

  const ownerRepo = getOwnerRepo(parsed);
  if (
    !ownerRepo ||
    (parsed.type !== 'github' && parsed.type !== 'git' && parsed.type !== 'gitlab')
  ) {
    console.error(pc.red('bundle install requires a Git repository source (e.g. org/repo).'));
    process.exit(1);
  }

  let manifest: BundleManifest;
  try {
    manifest = await loadBundleManifest(ownerRepo, bundleName, parsed.url, parsed.ref);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  console.log(
    pc.dim(
      `Bundle ${pc.cyan(manifest.name)}${manifest.version ? ` v${manifest.version}` : ''} → ` +
        `${manifest.skills.length} skill${manifest.skills.length !== 1 ? 's' : ''}: ${manifest.skills.join(', ')}`
    )
  );

  // Rebuild a clean source string (drop the @bundle fragment, preserve ref) and
  // delegate to the standard add pipeline. Members are pinned by their exact
  // repo-relative paths (skillPaths), never resolved by name.
  const cleanSource = parsed.ref ? `${ownerRepo}#${parsed.ref}` : ownerRepo;
  await runAdd([cleanSource], {
    ...options,
    skillPaths: manifest.skills,
    bundleName: manifest.name,
  });
}

interface BundleMember {
  skillName: string;
  /** Repo-relative path to the member's SKILL.md, when the lock recorded it. */
  skillPath?: string;
  global: boolean;
}

interface InstalledBundle {
  members: BundleMember[];
  /** Scope the bundle's skills live in. A globally-installed member pins the bundle to global for management. */
  global: boolean;
}

/**
 * Group installed skills by the bundle that installed them, across BOTH the
 * global and project-scoped locks. Bundles install to whichever scope the user
 * chose, so both must be consulted or `list`/`remove`/`update` would miss them.
 */
async function installedByBundle(): Promise<Map<string, InstalledBundle>> {
  const byBundle = new Map<string, InstalledBundle>();

  const record = (bundleName: string, member: BundleMember) => {
    const existing = byBundle.get(bundleName);
    if (existing) {
      existing.members.push(member);
      existing.global = existing.global || member.global;
    } else {
      byBundle.set(bundleName, { members: [member], global: member.global });
    }
  };

  const globalLocked = await getAllLockedSkills();
  for (const [skillName, entry] of Object.entries(globalLocked)) {
    if (entry.bundleName) {
      record(entry.bundleName, { skillName, skillPath: entry.skillPath, global: true });
    }
  }

  const localLock = await readLocalLock();
  for (const [skillName, entry] of Object.entries(localLock.skills)) {
    if (entry.bundleName) {
      record(entry.bundleName, { skillName, skillPath: entry.skillPath, global: false });
    }
  }

  return byBundle;
}

async function runBundleList(): Promise<void> {
  const byBundle = await installedByBundle();
  if (byBundle.size === 0) {
    console.log('No bundles installed.');
    console.log(pc.dim(`Install one with: ${CLI_NAME} bundle install <org>/<repo>@<bundle-name>`));
    return;
  }
  for (const bundleName of [...byBundle.keys()].sort()) {
    const entry = byBundle.get(bundleName)!;
    console.log(pc.bold(bundleName) + (entry.global ? pc.dim(' (global)') : ''));
    const sorted = [...entry.members].sort((a, b) => a.skillName.localeCompare(b.skillName));
    for (const member of sorted) {
      console.log(`  ${pc.cyan(member.skillName)}`);
    }
  }
}

async function runBundleRemove(args: string[]): Promise<void> {
  const { skills: positional, options } = parseRemoveOptions(args);
  const bundleName = positional[0];
  if (!bundleName) {
    console.error(pc.red(`Usage: ${CLI_NAME} bundle remove <bundle-name>`));
    process.exit(1);
  }

  const byBundle = await installedByBundle();
  const installed = byBundle.get(bundleName);
  if (!installed || installed.members.length === 0) {
    console.error(pc.red(`Bundle '${bundleName}' is not installed.`));
    process.exit(1);
  }

  const skillNames = installed.members.map((m) => m.skillName);
  console.log(pc.dim(`Removing bundle ${pc.cyan(bundleName)} (${skillNames.length} skills)`));
  // Delegate file/lock/hook removal to the existing remove flow, targeting the
  // scope the bundle was installed into (the user need not repeat -g).
  await removeCommand(skillNames, { ...options, global: installed.global });
}

/** Directory coordinate of a lock entry's skillPath ('skills/x/SKILL.md' → 'skills/x'). */
function memberDir(member: BundleMember): string | undefined {
  if (!member.skillPath) return undefined;
  return member.skillPath.replace(/\/?SKILL\.md$/, '');
}

async function runBundleUpdate(args: string[]): Promise<void> {
  const { source, options } = parseAddOptions(args);
  const rawSource = source[0];
  if (!rawSource) {
    console.error(pc.red(`Usage: ${CLI_NAME} bundle update <org>/<repo>@<bundle-name>`));
    process.exit(1);
  }

  const parsed = parseSource(rawSource);
  const bundleName = parsed.skillFilter;
  const ownerRepo = getOwnerRepo(parsed);
  if (!bundleName || !ownerRepo) {
    console.error(pc.red('Specify the bundle as <org>/<repo>@<bundle-name>.'));
    process.exit(1);
  }

  const byBundle = await installedByBundle();
  const installed = byBundle.get(bundleName);
  if (!installed || installed.members.length === 0) {
    console.error(pc.red(`Bundle '${bundleName}' is not installed. Use 'bundle install' instead.`));
    process.exit(1);
  }

  let manifest: BundleManifest;
  try {
    manifest = await loadBundleManifest(ownerRepo, bundleName, parsed.url, parsed.ref);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const desiredDirs = new Set(manifest.skills);
  const currentDirs = new Set(
    installed.members.map(memberDir).filter((d): d is string => d !== undefined)
  );
  const addedCount = manifest.skills.filter((d) => !currentDirs.has(d)).length;

  // Re-install the full desired set by coordinate so version bumps to retained
  // skills also land, pinned to the scope the bundle already lives in.
  const cleanSource = parsed.ref ? `${ownerRepo}#${parsed.ref}` : ownerRepo;
  await runAdd([cleanSource], {
    ...options,
    yes: true,
    global: installed.global,
    skillPaths: manifest.skills,
    bundleName: manifest.name,
  });

  // Any member still tagged with this bundle whose recorded coordinate is no
  // longer in the manifest was dropped. Retained members were just
  // re-installed, refreshing their skillPath — so entries without one (from
  // pre-coordinate installs) are dropped members too.
  const afterInstall = (await installedByBundle()).get(manifest.name);
  const toRemove = (afterInstall?.members ?? []).filter((m) => {
    const dir = memberDir(m);
    return dir === undefined || !desiredDirs.has(dir);
  });

  if (toRemove.length > 0) {
    const names = toRemove.map((m) => m.skillName);
    console.log(pc.dim(`Removing dropped skills: ${names.join(', ')}`));
    await removeCommand(names, { yes: true, global: installed.global });
  }

  console.log(
    pc.green(
      `Updated ${manifest.name}: ${addedCount} added, ${toRemove.length} removed, ` +
        `${manifest.skills.length - addedCount} retained.`
    )
  );
}

interface BundleSearchHit {
  name: string;
  description?: string;
  source?: string;
}

// Query the bundle search API. Returns [] on any failure so the interactive
// prompt degrades to "no results" rather than throwing mid-render.
async function searchBundlesAPI(query: string): Promise<BundleSearchHit[]> {
  const url = `${API_BASE}/api/bundles/search${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) return [];
    const data = (await res.json()) as { bundles?: BundleSearchHit[] };
    return data.bundles ?? [];
  } catch {
    return [];
  }
}

// Interactive bundle search: like `find`, nothing is shown until the user types
// a query (results appear once the query reaches the minimum length).
async function runBundleSearchPrompt(): Promise<BundleSearchHit | null> {
  return interactiveSearch<BundleSearchHit>({
    label: 'Search bundles:',
    minChars: 2,
    emptyMessage: 'No bundles found',
    search: (q) => searchBundlesAPI(q),
    renderRow: (bundle, selected) => {
      const name = selected ? pc.bold(bundle.name) : pc.cyan(bundle.name);
      const source = bundle.source ? ` ${pc.dim(bundle.source)}` : '';
      const desc = bundle.description ? ` ${pc.dim(`— ${bundle.description}`)}` : '';
      return `${name}${source}${desc}`;
    },
  });
}

async function runBundleSearch(args: string[]): Promise<void> {
  const query = args.filter((a) => !a.startsWith('-')).join(' ');

  // With no query and a real terminal, search interactively (like `find`).
  if (!query && process.stdin.isTTY && !(await isRunningInAgent())) {
    const selected = await runBundleSearchPrompt();
    if (!selected) {
      console.log(pc.dim('Search cancelled.'));
      return;
    }
    if (!selected.source) {
      console.error(pc.red(`Cannot install '${selected.name}': the registry returned no source.`));
      return;
    }
    console.log();
    console.log(pc.dim(`Installing bundle ${pc.cyan(selected.name)} from ${selected.source}...`));
    console.log();
    await runBundleInstall([`${selected.source}@${selected.name}`]);
    return;
  }

  // Query given, or non-interactive: print results.
  const url = `${API_BASE}/api/bundles/search${query ? `?q=${encodeURIComponent(query)}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
  } catch {
    console.error(pc.red('Could not reach the bundles API.'));
    return;
  }

  if (res.status === 404) {
    console.log(pc.yellow('Bundle search is not available yet on this registry.'));
    console.log(
      pc.dim(`You can still install a known bundle: ${CLI_NAME} bundle install <org>/<repo>@<name>`)
    );
    return;
  }
  if (!res.ok) {
    console.error(pc.red(`Bundle search failed (${res.status}).`));
    return;
  }

  const data = (await res.json()) as {
    bundles?: Array<{ name: string; description?: string; source?: string }>;
  };
  const bundles = data.bundles ?? [];
  if (bundles.length === 0) {
    console.log('No bundles found.');
    return;
  }
  for (const bundle of bundles) {
    console.log(pc.bold(bundle.name));
    if (bundle.description) console.log(`  ${pc.dim(bundle.description)}`);
    const target = bundle.source
      ? `${bundle.source}@${bundle.name}`
      : `<org>/<repo>@${bundle.name}`;
    console.log(`  ${pc.dim(`${CLI_NAME} bundle install ${target}`)}`);
  }
}

function showBundleHelp(): void {
  console.log(`
Usage: ${CLI_NAME} bundle <subcommand> [options]

Install curated sets of skills together.

Subcommands:
  install <org>/<repo>@<name>   Install a bundle's skills
  list                          List installed bundles and their skills
  update <org>/<repo>@<name>    Re-sync a bundle to its current manifest
  remove <name>                 Remove an installed bundle's skills
  search [query]                Search for bundles (interactive when no query given)

Options are forwarded to the underlying install/remove flow
(e.g. -g/--global, -a/--agent, -y/--yes, --copy).

Examples:
  ${CLI_NAME} bundle install org/repo@my-bundle
  ${CLI_NAME} bundle list
  ${CLI_NAME} bundle remove my-bundle
`);
}

/**
 * Entry point for the `bundle` command group. `args` is everything after
 * `bundle` on the command line (subcommand + its args).
 */
export async function runBundle(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case 'install':
    case 'add':
    case 'i':
      await runBundleInstall(rest);
      break;
    case 'list':
    case 'ls':
      await runBundleList();
      break;
    case 'remove':
    case 'rm':
      await runBundleRemove(rest);
      break;
    case 'update':
    case 'upgrade':
      await runBundleUpdate(rest);
      break;
    case 'search':
    case 'find':
      await runBundleSearch(rest);
      break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      showBundleHelp();
      break;
    default:
      console.error(pc.red(`Unknown bundle subcommand: ${subcommand}`));
      showBundleHelp();
      process.exit(1);
  }
}
