import { parseSource } from './source-parser.ts';
import { parseOwnerRepo } from './source-parser.ts';
import { getGitHubToken } from './skill-lock.ts';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const BOLD = '\x1b[1m';
const YELLOW = '\x1b[33m';

/**
 * Fetch a file's content from GitHub using the Contents API.
 * Returns the decoded text content, or null on failure.
 */
async function fetchGitHubFileContent(
  owner: string,
  repo: string,
  path: string,
  token: string | null
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'skills-cli',
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: string; encoding?: string };
    if (data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strip YAML frontmatter (--- ... ---) from the beginning of a markdown file.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (match) {
    return content.slice(match[0].length);
  }
  return content;
}

/**
 * Extract frontmatter fields from SKILL.md content.
 */
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key && val) fields[key] = val;
    }
  }
  return fields;
}

export async function runInfo(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(`${YELLOW}Usage: skills info <source>${RESET}`);
    console.log();
    console.log(`${DIM}Examples:${RESET}`);
    console.log(
      `  ${DIM}$${RESET} ${TEXT}skills info vercel-labs/agent-skills@vercel-react-best-practices${RESET}`
    );
    console.log(
      `  ${DIM}$${RESET} ${TEXT}skills info vercel-labs/agent-skills/tree/main/skills/pr-review${RESET}`
    );
    console.log();
    process.exit(1);
  }

  const input = args[0]!;

  // Handle owner/repo@skill-name shorthand
  const atMatch = input.match(/^([^@]+)@(.+)$/);
  let owner: string;
  let repo: string;
  let skillPath: string;

  if (atMatch) {
    const ownerRepo = parseOwnerRepo(atMatch[1]!);
    if (!ownerRepo) {
      console.log(`${YELLOW}Invalid source: ${input}${RESET}`);
      console.log(`${DIM}Expected format: owner/repo@skill-name${RESET}`);
      process.exit(1);
    }
    owner = ownerRepo.owner;
    repo = ownerRepo.repo;
    // Try common skill paths: skills/<name>/SKILL.md
    skillPath = `skills/${atMatch[2]}/SKILL.md`;
  } else {
    // Parse as a full source reference
    const parsed = parseSource(input);
    if (parsed.type === 'local') {
      console.log(
        `${YELLOW}Local paths are not supported by info. Read the file directly.${RESET}`
      );
      process.exit(1);
    }

    const ownerRepo = parseOwnerRepo(
      parsed.url.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
    );
    if (!ownerRepo) {
      console.log(`${YELLOW}Could not parse owner/repo from: ${input}${RESET}`);
      process.exit(1);
    }
    owner = ownerRepo.owner;
    repo = ownerRepo.repo;

    if (parsed.subpath) {
      skillPath = parsed.subpath.endsWith('SKILL.md')
        ? parsed.subpath
        : `${parsed.subpath}/SKILL.md`;
    } else {
      skillPath = 'SKILL.md';
    }
  }

  const token = getGitHubToken();
  const content = await fetchGitHubFileContent(owner, repo, skillPath, token);

  if (!content) {
    // Try without skills/ prefix if the first attempt failed
    if (atMatch) {
      const altPath = `${atMatch[2]}/SKILL.md`;
      const altContent = await fetchGitHubFileContent(owner, repo, altPath, token);
      if (altContent) {
        printSkillInfo(altContent, owner, repo, altPath);
        return;
      }
    }

    console.log(`${YELLOW}Could not find SKILL.md at ${owner}/${repo}/${skillPath}${RESET}`);
    console.log(`${DIM}Make sure the path is correct and the repository is accessible.${RESET}`);
    process.exit(1);
  }

  printSkillInfo(content, owner, repo, skillPath);
}

function printSkillInfo(content: string, owner: string, repo: string, path: string): void {
  const fm = parseFrontmatter(content);
  const body = stripFrontmatter(content).trim();

  // Print metadata header
  if (fm.name || fm.description) {
    console.log();
    if (fm.name) console.log(`${BOLD}${fm.name}${RESET}`);
    if (fm.description) console.log(`${DIM}${fm.description}${RESET}`);
    console.log(`${DIM}source: ${owner}/${repo}/${path}${RESET}`);
    console.log();
  }

  // Print body (the actual skill instructions)
  console.log(body);
  console.log();
}
