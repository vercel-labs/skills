import { runAdd, parseAddOptions } from './add.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { track } from './telemetry.ts';
import { isRepoPrivate } from './source-parser.ts';
import { isRunningInAgent } from './detect-agent.ts';
import { interactiveSearch } from './search-prompt.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';

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
export async function searchSkillsAPI(query: string, owner?: string): Promise<SearchSkill[]> {
  try {
    const params = new URLSearchParams({ q: query, limit: '10' });
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

    return data.skills
      .map((skill) => ({
        name: sanitizeMetadata(skill.name),
        slug: sanitizeMetadata(skill.id),
        source: sanitizeMetadata(skill.source || ''),
        installs: skill.installs,
      }))
      .sort((a, b) => (b.installs || 0) - (a.installs || 0));
  } catch {
    return [];
  }
}

// Interactive skill search, backed by the shared fzf-style prompt.
async function runSearchPrompt(owner?: string): Promise<SearchSkill | null> {
  return interactiveSearch<SearchSkill>({
    label: 'Search skills:',
    minChars: 2,
    emptyMessage: 'No skills found',
    search: (q) => searchSkillsAPI(q, owner),
    renderRow: (skill, selected) => {
      const name = selected ? `${BOLD}${skill.name}${RESET}` : `${TEXT}${skill.name}${RESET}`;
      const source = skill.source ? ` ${DIM}${skill.source}${RESET}` : '';
      const installs = formatInstalls(skill.installs);
      const installsBadge = installs ? ` ${CYAN}${installs}${RESET}` : '';
      return `${name}${source}${installsBadge}`;
    },
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
    const results = await searchSkillsAPI(query, owner);

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

    for (const skill of results.slice(0, 6)) {
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

  const selected = await runSearchPrompt(owner);

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
  console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}...`);
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
