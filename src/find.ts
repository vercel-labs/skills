import * as readline from 'readline';
import type { Diagnostic } from 'nostics';
import { runAdd, parseAddOptions } from './add.ts';
import { diagnostics, formatError } from './diagnostics.ts';
import { parseCliArgs } from './cli-args.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { track } from './telemetry.ts';
import { isRepoPrivate } from './source-parser.ts';
import { isRunningInAgent } from './detect-agent.ts';
import { BOLD, CYAN, DIM, RESET, TEXT, YELLOW } from './color.ts';

// API endpoint for skills search
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';

function formatInstalls(count: number): string {
  if (!count || count <= 0) return '';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}K installs`;
  return `${count} install${count === 1 ? '' : 's'}`;
}

export interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

export interface FindOptions {
  owner?: string;
}

export interface ParseFindOptionsResult {
  query: string;
  options: FindOptions;
  errors: Diagnostic[];
}

const GITHUB_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;

export function parseFindOptions(args: string[]): ParseFindOptionsResult {
  const { values, positionals, errors } = parseCliArgs(args, {
    owner: { type: 'string', value: 'a GitHub owner' },
  });
  const options: FindOptions = {};

  const ownerValue = values.owner?.at(-1);
  if (ownerValue !== undefined) {
    const owner = ownerValue.trim().toLowerCase();
    if (GITHUB_OWNER_PATTERN.test(owner)) {
      options.owner = owner;
    } else {
      errors.push(
        diagnostics.SKILLS_INVALID_OPTION_VALUE({
          option: '--owner',
          expected: 'a valid GitHub owner',
        })
      );
    }
  }

  return { query: positionals.join(' '), options, errors };
}

// Search via API
export async function searchSkillsAPI(query: string, owner?: string): Promise<SearchSkill[]> {
  try {
    const params = new URLSearchParams({ q: query });
    if (owner) params.set('owner', owner);
    const url = `${SEARCH_API_BASE}/api/search?${params.toString()}`;
    const res = await fetch(url);

    if (!res.ok) return [];

    const data = (await res.json()) as {
      skills: Array<{
        id: string;
        name: string;
        installs: number;
        source: string;
      }>;
    };

    return data.skills.map((skill) => ({
      name: sanitizeMetadata(skill.name),
      slug: sanitizeMetadata(skill.id),
      source: sanitizeMetadata(skill.source || ''),
      installs: skill.installs,
    }));
  } catch {
    return [];
  }
}

// The search API requires every query term to match, so one extra word (e.g.
// "next bundle analyzer") can hide an otherwise relevant skill. When a
// multi-term query returns few results, retry with each term dropped and
// append those partial matches after the exact ones.
const MIN_EXACT_RESULTS = 10;
const MAX_FALLBACK_TERMS = 6;
const MAX_MERGED_RESULTS = 25;

export interface SearchResult {
  skills: SearchSkill[];
  /** Number of leading results that matched every query term. */
  exactCount: number;
}

export async function searchSkills(query: string, owner?: string): Promise<SearchResult> {
  const exact = await searchSkillsAPI(query, owner);
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))];

  if (exact.length >= MIN_EXACT_RESULTS || terms.length < 2 || terms.length > MAX_FALLBACK_TERMS) {
    return { skills: exact, exactCount: exact.length };
  }

  const subqueries = terms.map((_, i) => terms.filter((_, j) => j !== i).join(' '));
  const partialLists = await Promise.all(subqueries.map((q) => searchSkillsAPI(q, owner)));

  const seen = new Set(exact.map((skill) => skill.slug));
  const candidates = new Map<string, { skill: SearchSkill; hits: number; bestRank: number }>();
  for (const list of partialLists) {
    list.forEach((skill, rank) => {
      if (seen.has(skill.slug)) return;
      const entry = candidates.get(skill.slug);
      if (entry) {
        entry.hits++;
        entry.bestRank = Math.min(entry.bestRank, rank);
      } else {
        candidates.set(skill.slug, { skill, hits: 1, bestRank: rank });
      }
    });
  }

  const partial = [...candidates.values()]
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        a.bestRank - b.bestRank ||
        (b.skill.installs || 0) - (a.skill.installs || 0)
    )
    .slice(0, Math.max(0, MAX_MERGED_RESULTS - exact.length))
    .map((entry) => entry.skill);

  return { skills: [...exact, ...partial], exactCount: exact.length };
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
    if (!query || query.length < 2) {
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
      render();
      return;
    }

    // Use API search for all queries (debounced)
    loading = true;
    render();

    // Adaptive debounce: shorter queries = longer wait (user still typing)
    // 2 chars: 250ms, 3 chars: 200ms, 4 chars: 150ms, 5+ chars: 150ms
    const debounceMs = Math.max(150, 350 - q.length * 50);

    debounceTimer = setTimeout(async () => {
      try {
        results = (await searchSkills(q, owner)).skills;
        selectedIndex = 0;
      } catch {
        results = [];
      } finally {
        loading = false;
        debounceTimer = null;
        render();
      }
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
    for (const error of errors) console.error(formatError(error));
    console.error('Usage: npx skills find <query> [--owner <owner>]');
    return;
  }

  // Non-interactive mode: just print results and exit
  if (query) {
    const { skills: results, exactCount } = await searchSkills(query, owner);

    // Track telemetry for non-interactive search
    track({
      event: 'find',
      query,
      resultCount: String(results.length),
    });

    if (results.length === 0) {
      const ownerSuffix = owner ? ` from owner "${owner}"` : '';
      console.log(`${DIM}No skills found for "${query}"${ownerSuffix}${RESET}`);
      return;
    }

    console.log(`${DIM}Install with${RESET} npx skills add <owner/repo@skill>`);
    console.log();

    for (const [index, skill] of results.entries()) {
      if (index === exactCount) {
        console.log(
          exactCount === 0
            ? `${DIM}No skills matched every term in "${query}". Partial matches:${RESET}`
            : `${DIM}Partial matches (some terms of "${query}"):${RESET}`
        );
        console.log();
      }
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
