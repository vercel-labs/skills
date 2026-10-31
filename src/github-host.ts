const DEFAULT_GITHUB_HOST = 'github.com';

/**
 * Return the GitHub host selected by the GitHub CLI.
 *
 * GH_HOST is expected to be a hostname, not a URL.
 * Invalid values fall back to github.com instead of being interpolated into
 * clone URLs.
 */
export function getGitHubHost(): string {
  const configuredHost = process.env.GH_HOST?.trim();
  if (!configuredHost) {
    return DEFAULT_GITHUB_HOST;
  }

  try {
    const parsed = new URL(`https://${configuredHost}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return DEFAULT_GITHUB_HOST;
    }
    return parsed.hostname;
  } catch {
    return DEFAULT_GITHUB_HOST;
  }
}

/** Whether a host is GitHub.com or the configured GitHub Enterprise host. */
export function isGitHubHost(host: string): boolean {
  const normalizedHost = host.toLowerCase();
  return normalizedHost === DEFAULT_GITHUB_HOST || normalizedHost === getGitHubHost().toLowerCase();
}
