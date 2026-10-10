import * as readline from 'readline';
import { runAdd, parseAddOptions } from './add.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { track } from './telemetry.ts';
import { isRepoPrivate } from './source-parser.ts';
import { isRunningInAgent } from './detect-agent.ts';
import { rankSkills, type SearchSkill, type SearchOutcome, type ApiSearchSkill } from './search-core.ts';
import { describeFailure } from './search-coordinator.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';

// API endpoint for skills search
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';
const SEARCH_RESULT_LIMIT = '20';
/**
 * Search is an interactive action, so the bound is far tighter than the 30s
 * used for source downloads. A user staring at an empty prompt for 30s has
 * already concluded the tool is broken.
 */
const SEARCH_TIMEOUT_MS = Number.parseInt(process.env.SKILLS_SEARCH_TIMEOUT_MS || '', 10) || 8_000;

function formatInstalls(count: number): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
  return `${count} install${count === 1 ? '' : 's'}`;
}

/**
 * Re-exported from `search-core.ts` so existing importers of `find.ts` keep
 * working; the canonical definition (which adds `relevanceRank`) lives there.
 */
export type { SearchSkill } from './search-core.ts';

export interface FindOptions {
  owner?: string;
}

export interface ParseFindOptionsResult {
  query: string;
  options: FindOptions;
  errors: string[];
}

const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;

export function parseFindOptions(args: string[]): ParseFindOptionsResult {
  const queryParts: string[] = [];
  const options: FindOptions = {};
  const errors: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    let ownerValue: string | undefined;
    if (arg === '--owner') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        errors.push('--owner requires a GitHub owner');
        continue;
      }
      ownerValue = value;
      i++;
    } else if (arg.startsWith('--owner=')) {
      ownerValue = arg.slice('--owner='.length);
      if (!ownerValue) {
        errors.push('--owner requires a GitHub owner');
        continue;
      }
    } else {
      queryParts.push(arg);
      continue;
    }

    const owner = ownerValue.trim().toLowerCase();
    if (!GITHUB_OWNER_PATTERN.test(owner)) {
      errors.push('--owner must be a valid GitHub owner');
      continue;
    }
    options.owner = owner;
  }

  return { query: queryParts.join(' '), options, errors };
}

// Search via API
/**
 * Hardened search entry point.
 *
 * Behaviour changes vs. the original implementation:
 *  - Failures are returned as a typed outcome instead of a bare `[]`, so a
 *    network/server failure can never be reported to the user as
 *    "No skills found".
 *  - The request is bounded by an AbortSignal (the download path already had a
 *    30s bound; this path had none).
 *
 * Success path is unchanged: same endpoint, same parameters, same field names.
 */
export async function searchSkillsAPI(query: string, owner?: string): Promise<SearchOutcome> {
  const params = new URLSearchParams({ q: query, limit: SEARCH_RESULT_LIMIT });
  if (owner) params.set('owner', owner);
  const url = `${SEARCH_API_BASE}/api/search?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : String(error);
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'timeout', ms: SEARCH_TIMEOUT_MS };
    }
    return { kind: 'network-error', cause: name ? `${name}: ${message}` : message };
  }

  if (!res.ok) {
    return { kind: 'server-error', status: res.status };
  }

  let payload: { skills?: ApiSearchSkill[] };
  try {
    payload = (await res.json()) as { skills?: ApiSearchSkill[] };
  } catch (error) {
    return {
      kind: 'network-error',
      cause: `malformed response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const raw = payload.skills;
  if (!Array.isArray(raw)) {
    return { kind: 'network-error', cause: 'response is missing a "skills" array' };
  }
  if (raw.length === 0) {
    return { kind: 'empty', query };
  }

  return {
    kind: 'ok',
    skills: rankSkills(
      raw.map((skill, index) => ({
        name: sanitizeMetadata(skill.name),
        slug: sanitizeMetadata(skill.id),
        source: sanitizeMetadata(skill.source || ''),
        installs: Number.isFinite(skill.installs) ? skill.installs : 0,
        relevanceRank: index,
      }))
    ),
  };
}

/** Backwards-compatible helper: returns skills, or an empty array on any failure. */
export async function searchSkillsOrEmpty(query: string, owner?: string): Promise<SearchSkill[]> {
  const outcome = await searchSkillsAPI(query, owner);
  return outcome.kind === 'ok' ? outcome.skills : [];
}

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

// Custom fzf-style search prompt using raw readline
async function runSearchPrompt(initialQuery = '', owner?: string): Promise<SearchSkill | null> {
  let results: SearchSkill[] = [];
  let selectedIndex = 0;
  let query = initialQuery;
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLines = 0;
  let failureMessage: string | null = null;

  /**
   * Monotonic request counter + TTL cache.
   *
   * debounce alone only throttles the *rate* of requests; it does not stop a
   * slow response for an older query from landing after and overwriting a newer
   * one. Every settled request carries its sequence number and stale results
   * are discarded.
   */
  let requestSeq = 0;
  const cache = new Map<string, { at: number; skills: SearchSkill[] }>();
  const CACHE_TTL_MS = 60_000;

  // Enable raw mode for keypress events
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Setup readline for keypress events but don't let it echo
  readline.emitKeypressEvents(process.stdin);

  // Resume stdin to start receiving events
  process.stdin.resume();

  // Hide cursor during selection
  process.stdout.write(HIDE_CURSOR);

  function render(): void {
    // Move cursor up to overwrite previous render
    if (lastRenderedLines > 0) {
      process.stdout.write(MOVE_UP(lastRenderedLines) + MOVE_TO_COL(1));
    }

    // Clear from cursor to end of screen (removes ghost trails)
    process.stdout.write(CLEAR_DOWN);

    const lines: string[] = [];

    // Search input line with cursor
    const cursor = `${BOLD}_${RESET}`;
    lines.push(`${TEXT}Search skills:${RESET} ${query}${cursor}`);
    lines.push('');

    // Results - keep showing existing results while loading new ones
    if (failureMessage) {
      lines.push(`${DIM}${failureMessage}${RESET}`);
    } else if (!query || query.length < 2) {
      lines.push(`${DIM}Start typing to search (min 2 chars)${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching…${RESET}`);
    } else if (results.length === 0) {
      lines.push(`${DIM}No skills found${RESET}`);
    } else {
      const maxVisible = 8;
      const visible = results.slice(0, maxVisible);

      for (let i = 0; i < visible.length; i++) {
        const skill = visible[i]!;
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? `${BOLD}>${RESET}` : ' ';
        const name = isSelected ? `${BOLD}${skill.name}${RESET}` : `${TEXT}${skill.name}${RESET}`;
        const source = skill.source ? ` ${DIM}${skill.source}${RESET}` : '';
        const installs = formatInstalls(skill.installs);
        const installsBadge = installs ? ` ${CYAN}${installs}${RESET}` : '';
        const loadingIndicator = loading && i === 0 ? ` ${DIM}…${RESET}` : '';

        lines.push(`  ${arrow} ${name}${source}${installsBadge}${loadingIndicator}`);
      }
    }

    lines.push('');
    lines.push(`${DIM}up/down navigate | enter select | esc cancel${RESET}`);

    // Write each line
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    lastRenderedLines = lines.length;
  }

  function triggerSearch(q: string): void {
    // Always clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Always reset loading state when starting a new search
    loading = false;

    if (!q || q.length < 2) {
      results = [];
      selectedIndex = 0;
      failureMessage = null;
      render();
      return;
    }

    const cacheKey = `${owner ?? '*'}::${q.toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      results = cached.skills;
      selectedIndex = 0;
      loading = false;
      failureMessage = null;
      render();
      return;
    }

    // Claim a sequence number BEFORE awaiting so late arrivals can be dropped.
    const seq = ++requestSeq;

    loading = true;
    failureMessage = null;
    render();

    // Adaptive debounce: shorter queries = longer wait (user still typing)
    // 2 chars: 250ms, 3 chars: 200ms, 4 chars: 150ms, 5+ chars: 150ms
    const debounceMs = Math.max(150, 350 - q.length * 50);

    debounceTimer = setTimeout(async () => {
      const outcome = await searchSkillsAPI(q, owner);
      if (seq !== requestSeq) return; // stale response — discard
      if (outcome.kind === 'ok') {
        results = outcome.skills;
        cache.set(cacheKey, { at: Date.now(), skills: outcome.skills });
        failureMessage = null;
      } else if (outcome.kind === 'empty') {
        results = [];
        failureMessage = null;
      } else {
        results = [];
        failureMessage = 'Search unavailable — check network. This does NOT mean no matches exist.';
      }
      selectedIndex = 0;
      loading = false;
      debounceTimer = null;
      render();
    }, debounceMs);
  }

  // Trigger initial search if there's a query, then render
  if (initialQuery) {
    triggerSearch(initialQuery);
  }
  render();

  return new Promise((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(SHOW_CURSOR);
      // Pause stdin to fully release it for child processes
      process.stdin.pause();
    }

    function handleKeypress(_ch: string | undefined, key: readline.Key): void {
      if (!key) return;

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Cancel
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'return') {
        // Submit
        cleanup();
        resolve(results[selectedIndex] || null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, results.length - 1), selectedIndex + 1);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          triggerSearch(query);
        }
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        const char = key.sequence;
        if (char >= ' ' && char <= '~') {
          query += char;
          triggerSearch(query);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

// Parse owner/repo from a package string (for the find command)
function getOwnerRepoFromString(pkg: string): { owner: string; repo: string } | null {
  // Handle owner/repo or owner/repo@skill
  const atIndex = pkg.lastIndexOf('@');
  const repoPath = atIndex > 0 ? pkg.slice(0, atIndex) : pkg;
  const match = repoPath.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

async function isRepoPublic(owner: string, repo: string): Promise<boolean> {
  const isPrivate = await isRepoPrivate(owner, repo);
  // Return true only if we know it's public (isPrivate === false)
  // Return false if private or unable to determine
  return isPrivate === false;
}

export async function runFind(args: string[]): Promise<void> {
  const { query, options: findOptions, errors } = parseFindOptions(args);
  const owner = findOptions.owner;
  const isNonInteractive = !process.stdin.isTTY;
  const agentTip = `${DIM}Tip: if running in a coding agent, follow these steps:${RESET}
${DIM}  1) npx skills find [query] [--owner <owner>]${RESET}
${DIM}  2) npx skills add <owner/repo@skill>${RESET}`;

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error('Usage: npx skills find <query> [--owner <owner>]');
    return;
  }

  // Non-interactive mode: just print results and exit
  if (query) {
    const outcome = await searchSkillsAPI(query, owner);

    // Track telemetry for non-interactive search
    track({
      event: 'find',
      query,
      resultCount: String(outcome.kind === 'ok' ? outcome.skills.length : 0),
    });

    // Distinguish "the service failed" from "nothing matched". Reporting a
    // network outage as "No skills found" is a factual error, so failures go
    // to stderr with a non-zero exit code and explicit wording.
    const failure = describeFailure(outcome);
    if (failure) {
      console.error(failure);
      process.exitCode = 1;
      return;
    }

    if (outcome.kind === 'empty') {
      const ownerSuffix = owner ? ` from owner "${owner}"` : '';
      console.log(`${DIM}No skills found for "${outcome.query}"${ownerSuffix}${RESET}`);
      return;
    }

    if (outcome.kind !== 'ok') return; // defensive: only 'ok' carries skills
    const results = outcome.skills;

    console.log(`${DIM}Install with${RESET} npx skills add <owner/repo@skill>`);
    console.log();

    for (const skill of results) {
      const pkg = skill.source || skill.slug;
      const installs = formatInstalls(skill.installs);
      console.log(
        `${TEXT}${pkg}@${skill.name}${RESET}${installs ? ` ${CYAN}${installs}${RESET}` : ''}`
      );
      console.log(`${DIM}└ https://skills.sh/${skill.slug}${RESET}`);
      console.log();
    }
    return;
  }

  // Skip interactive search when running inside an AI agent or non-TTY
  if (isNonInteractive || (await isRunningInAgent())) {
    console.log(agentTip);
    console.log();
    console.log(`${DIM}Usage: npx skills find <query> [--owner <owner>]${RESET}`);
    return;
  }

  const selected = await runSearchPrompt('', owner);

  // Track telemetry for interactive search
  track({
    event: 'find',
    query: '',
    resultCount: selected ? '1' : '0',
    interactive: '1',
  });

  if (!selected) {
    console.log(`${DIM}Search cancelled${RESET}`);
    console.log();
    return;
  }

  // Use source (owner/repo) and skill name for installation
  const pkg = selected.source || selected.slug;
  const skillName = selected.name;

  console.log();
  console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}…`);
  console.log();

  // Run add directly since we're in the same CLI
  const { source, options: addOptions } = parseAddOptions([pkg, '--skill', skillName]);
  await runAdd(source, addOptions);

  console.log();

  const info = getOwnerRepoFromString(pkg);
  if (info && (await isRepoPublic(info.owner, info.repo))) {
    console.log(
      `${DIM}View the skill at${RESET} ${TEXT}https://skills.sh/${selected.slug}${RESET}`
    );
  } else {
    console.log(`${DIM}Discover more skills at${RESET} ${TEXT}https://skills.sh${RESET}`);
  }

  console.log();
}
