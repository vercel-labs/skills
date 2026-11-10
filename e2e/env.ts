/**
 * Variables a child process may inherit. Everything else is dropped so the CLI
 * cannot see the developer's agent session (CLAUDECODE, AI_AGENT, ...), config
 * overrides (CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_*), or CI markers that switch
 * defaults such as --frozen-lockfile. Only reachability (PATH, proxies, CAs) and
 * GitHub credentials (to avoid anonymous rate limits) pass through.
 */
const PASSTHROUGH = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'ComSpec',
  'WINDIR',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'GIT_SSL_CAINFO',
  'npm_config_registry',
  'GITHUB_TOKEN',
  'GH_TOKEN',
];

export function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.DISABLE_TELEMETRY = '1';
  env.NO_COLOR = '1';
  // Keep git from reading the developer's ~/.gitconfig or /etc/gitconfig.
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
