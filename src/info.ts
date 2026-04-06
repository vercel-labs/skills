import { readSkillLock, getGitHubToken } from './skill-lock.ts';
import { parseSource } from './source-parser.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

/**
 * Fetch SKILL.md content from a GitHub repo.
 */
async function fetchSkillMd(
  ownerRepo: string,
  skillPath: string | undefined,
  token: string | null
): Promise<string | null> {
  // Determine the path to SKILL.md
  let filePath = 'SKILL.md';
  if (skillPath) {
    filePath = skillPath.replace(/\\/g, '/');
    if (!filePath.endsWith('SKILL.md')) {
      filePath = filePath.endsWith('/') ? `${filePath}SKILL.md` : `${filePath}/SKILL.md`;
    }
  }

  const branches = ['main', 'master'];
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'skills-cli',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/contents/${filePath}?ref=${branch}`;
      const response = await fetch(url, { headers });
      if (response.ok) {
        return await response.text();
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Strip YAML frontmatter from markdown content.
 */
function stripFrontmatter(content: string): string {
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      return content.slice(endIndex + 3).trimStart();
    }
  }
  return content;
}

/**
 * Run the `skills info` command.
 *
 * Usage:
 *   skills info <name>           — show info for an installed skill
 *   skills info owner/repo@skill — fetch SKILL.md from GitHub
 */
export async function runInfo(args: string[]): Promise<void> {
  const target = args[0];

  if (!target) {
    console.log(`${BOLD}Usage:${RESET} skills info <name|owner/repo@skill>`);
    console.log();
    console.log(`${DIM}Examples:${RESET}`);
    console.log(`  ${DIM}$${RESET} skills info my-skill`);
    console.log(`  ${DIM}$${RESET} skills info vercel-labs/agent-skills@pr-review`);
    return;
  }

  const token = getGitHubToken();

  // Check if it's an installed skill (by name)
  const lock = readSkillLock();
  const entry = lock.skills[target];

  if (entry) {
    // Show metadata for installed skill
    console.log(`${BOLD}${target}${RESET}`);
    console.log();
    console.log(`  ${DIM}Source:${RESET}    ${TEXT}${entry.source}${RESET}`);
    console.log(`  ${DIM}Type:${RESET}      ${TEXT}${entry.sourceType}${RESET}`);
    console.log(`  ${DIM}URL:${RESET}       ${TEXT}${entry.sourceUrl}${RESET}`);
    if (entry.skillPath) {
      console.log(`  ${DIM}Path:${RESET}      ${TEXT}${entry.skillPath}${RESET}`);
    }
    console.log(`  ${DIM}Installed:${RESET} ${TEXT}${entry.installedAt}${RESET}`);
    console.log(`  ${DIM}Updated:${RESET}   ${TEXT}${entry.updatedAt}${RESET}`);

    // Try to fetch and display SKILL.md content
    if (entry.sourceType === 'github' && entry.source) {
      console.log();
      const content = await fetchSkillMd(entry.source, entry.skillPath, token);
      if (content) {
        console.log(`${DIM}--- SKILL.md ---${RESET}`);
        console.log(stripFrontmatter(content));
      }
    }
    return;
  }

  // Try to parse as owner/repo@skill format
  const atIndex = target.lastIndexOf('@');
  if (atIndex > 0) {
    const repoSource = target.slice(0, atIndex);
    const skillName = target.slice(atIndex + 1);
    const parsed = parseSource(repoSource);

    if (parsed.type === 'github') {
      // Try common skill paths
      const possiblePaths = [
        `${skillName}/SKILL.md`,
        `.claude/skills/${skillName}/SKILL.md`,
        `skills/${skillName}/SKILL.md`,
      ];

      // Extract owner/repo
      const match = parsed.url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
      const ownerRepo = match ? match[1]!.replace(/\.git$/, '') : repoSource;

      for (const path of possiblePaths) {
        const content = await fetchSkillMd(ownerRepo, path, token);
        if (content) {
          console.log(`${BOLD}${skillName}${RESET} ${DIM}(${ownerRepo})${RESET}`);
          console.log();
          console.log(stripFrontmatter(content));
          return;
        }
      }

      console.log(`${DIM}Could not find SKILL.md for "${skillName}" in ${ownerRepo}${RESET}`);
      return;
    }
  }

  console.log(`${DIM}Skill "${target}" not found.${RESET}`);
  console.log(`${DIM}Try: skills info owner/repo@skill-name${RESET}`);
}
