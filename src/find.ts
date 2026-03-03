import * as readline from 'readline';
import { runAdd, parseAddOptions } from './add.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { track, fetchAuditData, type SkillAuditData } from './telemetry.ts';
import { isRepoPrivate } from './source-parser.ts';
import { isRunningInAgent } from './detect-agent.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

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
  audit?: SkillAuditData;
}

type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
  unknown: 5,
};

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RISK_RANK, value);
}

function getEffectiveRisk(audit: SkillAuditData | undefined): RiskLevel {
  if (!audit || Object.keys(audit).length === 0) {
    return 'unknown';
  }

  let worst: RiskLevel = 'safe';
  let hasRiskData = false;
  let hasSocketAlerts = false;

  for (const partner of Object.values(audit)) {
    if (isRiskLevel(partner.risk)) {
      hasRiskData = true;
      if (RISK_RANK[partner.risk] > RISK_RANK[worst]) {
        worst = partner.risk;
      }
    }
    if ((partner.alerts ?? 0) > 0) {
      hasSocketAlerts = true;
    }
  }

  if (!hasRiskData) {
    return hasSocketAlerts ? 'medium' : 'unknown';
  }

  if (hasSocketAlerts && RISK_RANK[worst] < RISK_RANK.medium) {
    return 'medium';
  }

  return worst;
}

function formatAuditBadge(audit: SkillAuditData | undefined): string {
  const risk = getEffectiveRisk(audit);
  switch (risk) {
    case 'safe':
    case 'low':
      return `${GREEN}audit: pass${RESET}`;
    case 'medium':
      return `${YELLOW}audit: medium risk${RESET}`;
    case 'high':
      return `${RED}audit: high risk${RESET}`;
    case 'critical':
      return `${RED}audit: critical risk${RESET}`;
    default:
      return `${DIM}audit: unknown${RESET}`;
  }
}

function isSafeForFilter(audit: SkillAuditData | undefined): boolean {
  const risk = getEffectiveRisk(audit);
  return risk === 'safe' || risk === 'low';
}

export function parseFindArgs(args: string[]): { query: string; allowUnsafe: boolean } {
  const queryParts: string[] = [];
  let allowUnsafe = false;

  for (const arg of args) {
    if (arg === '--unsafe') {
      allowUnsafe = true;
      continue;
    }
    queryParts.push(arg);
  }

  return {
    query: queryParts.join(' ').trim(),
    allowUnsafe,
  };
}

// Search via API
export async function searchSkillsAPI(
  query: string,
  options: { allowUnsafe?: boolean } = {}
): Promise<SearchSkill[]> {
  try {
    const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=10`;
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

    const mapped = data.skills
      .map((skill) => ({
        name: sanitizeMetadata(skill.name),
        slug: sanitizeMetadata(skill.id),
        source: sanitizeMetadata(skill.source || ''),
        installs: skill.installs,
      }))
      .sort((a, b) => (b.installs || 0) - (a.installs || 0));

    const sourceToSkillNames = new Map<string, Set<string>>();
    for (const skill of mapped) {
      if (!skill.source) continue;
      if (!sourceToSkillNames.has(skill.source)) {
        sourceToSkillNames.set(skill.source, new Set());
      }
      sourceToSkillNames.get(skill.source)!.add(skill.name);
    }

    const auditsBySource = new Map<string, Record<string, SkillAuditData>>();
    await Promise.all(
      Array.from(sourceToSkillNames.entries()).map(async ([source, names]) => {
        const auditData = await fetchAuditData(source, Array.from(names), 1500);
        if (auditData) {
          auditsBySource.set(source, auditData);
        }
      })
    );

    const withAudits = mapped.map((skill) => {
      const sourceAudits = auditsBySource.get(skill.source);
      return {
        ...skill,
        audit: sourceAudits?.[skill.name] || sourceAudits?.[skill.slug],
      };
    });

    if (!options.allowUnsafe) {
      return withAudits.filter((skill) => isSafeForFilter(skill.audit));
    }

    return withAudits;
  } catch {
    return [];
  }
}

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

// Custom fzf-style search prompt using raw readline
async function runSearchPrompt(
  initialQuery = '',
  allowUnsafe = false
): Promise<SearchSkill | null> {
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
    if (!allowUnsafe) {
      lines.push(`${DIM}Filter: safe audits only (use --unsafe to show risky skills)${RESET}`);
    }
    lines.push('');

    // Results - keep showing existing results while loading new ones
    if (!query || query.length < 2) {
      lines.push(`${DIM}Start typing to search (min 2 chars)${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching...${RESET}`);
    } else if (results.length === 0) {
      lines.push(
        !allowUnsafe
          ? `${DIM}No safe skills found (use --unsafe to show risky skills)${RESET}`
          : `${DIM}No skills found${RESET}`
      );
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
        const auditBadge = ` ${formatAuditBadge(skill.audit)}`;
        const loadingIndicator = loading && i === 0 ? ` ${DIM}...${RESET}` : '';

        lines.push(`  ${arrow} ${name}${source}${installsBadge}${auditBadge}${loadingIndicator}`);
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
        results = await searchSkillsAPI(q, { allowUnsafe });
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
  const { query, allowUnsafe } = parseFindArgs(args);
  const isNonInteractive = !process.stdin.isTTY;
  const agentTip = `${DIM}Tip: if running in a coding agent, follow these steps:${RESET}
${DIM}  1) npx skills find [query]${RESET}
${DIM}  2) npx skills add <owner/repo@skill>${RESET}`;

  // Non-interactive mode: just print results and exit
  if (query) {
    const results = await searchSkillsAPI(query, { allowUnsafe });

    // Track telemetry for non-interactive search
    track({
      event: 'find',
      query,
      resultCount: String(results.length),
    });

    if (results.length === 0) {
      if (!allowUnsafe) {
        console.log(`${DIM}No safe skills found for "${query}"${RESET}`);
        console.log(`${DIM}Use --unsafe to show risky/unknown skills${RESET}`);
      } else {
        console.log(`${DIM}No skills found for "${query}"${RESET}`);
      }
      return;
    }

    if (!allowUnsafe) {
      console.log(`${DIM}Showing only skills with safe/low audit results${RESET}`);
      console.log();
    }

    console.log(`${DIM}Install with${RESET} npx skills add <owner/repo@skill>`);
    console.log();

    for (const skill of results.slice(0, 6)) {
      const pkg = skill.source || skill.slug;
      const installs = formatInstalls(skill.installs);
      const audit = formatAuditBadge(skill.audit);
      console.log(
        `${TEXT}${pkg}@${skill.name}${RESET}${installs ? ` ${CYAN}${installs}${RESET}` : ''} ${audit}`
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
    console.log(`${DIM}Usage: npx skills find <query>${RESET}`);
    return;
  }

  const selected = await runSearchPrompt('', allowUnsafe);

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
  const { source, options } = parseAddOptions([pkg, '--skill', skillName]);
  await runAdd(source, options);

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
