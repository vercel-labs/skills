/**
 * Enterprise customization via environment variables:
 *
 * SKILLS_API_URL       — base URL for all skills.sh API calls AND display links
 *                        (default: "https://skills.sh"). Setting this to a custom
 *                        host points both the search API and rendered output URLs
 *                        at that host, so a self-hosted registry needs only this
 *                        one variable.
 * SKILLS_LOGO          — newline-separated ASCII art replacing the default logo;
 *                        lines may contain pre-colored ANSI escape codes (colors
 *                        are passed through as-is rather than wrapped in grays)
 * SKILLS_CLI_NAME      — CLI executable name shown in usage hints (default: "npx skills")
 * SKILLS_INSTALL_VERB  — install sub-command name (default: "add")
 * SKILLS_FIND_VERB     — find/search sub-command name (default: "find")
 */

export interface EnvConfig {
  logoLines: string[] | null;
  cliName: string;
  installVerb: string;
  findVerb: string;
  apiBase: string;
}

function parseLogoLines(): string[] | null {
  const raw = process.env.SKILLS_LOGO;
  if (!raw) return null;
  const lines = raw.split('\n');
  return lines.length > 0 ? lines : null;
}

export const envConfig: EnvConfig = {
  logoLines: parseLogoLines(),
  cliName: process.env.SKILLS_CLI_NAME || 'npx skills',
  installVerb: process.env.SKILLS_INSTALL_VERB || 'add',
  findVerb: process.env.SKILLS_FIND_VERB || 'find',
  apiBase: (process.env.SKILLS_API_URL || 'https://skills.sh').replace(/\/$/, ''),
};

/** Full install command, e.g. "npx skills add" or "playlist-skills install" */
export function installCmd(): string {
  return `${envConfig.cliName} ${envConfig.installVerb}`;
}

/** Full find command, e.g. "npx skills find" or "playlist-skills search" */
export function findCmd(): string {
  return `${envConfig.cliName} ${envConfig.findVerb}`;
}
