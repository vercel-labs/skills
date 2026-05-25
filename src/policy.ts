import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { AGENTS_DIR } from './constants.ts';
import type { ParsedSource } from './types.ts';

/**
 * Admin-managed installation policy for `skills add`.
 *
 * Lookup order (first hit wins):
 *   1. $SKILLS_POLICY (absolute path)
 *   2. <cwd>/.skills-policy.json
 *   3. ~/.agents/skills-policy.json
 *
 * If no policy file is found, defaults are: allow everything EXCEPT
 * `.well-known` resolution, which is opt-in regardless of whether a
 * policy file is present (see DEFAULT_WELL_KNOWN_DENY).
 *
 * Per-provider values cascade over a top-level `default`. Rule values:
 * "allow" | "deny" | "proxy_only". `proxy_only` rewrites the source URL
 * through `mirror.url` (GOPROXY shape: `${mirror}/${host}/${path}`)
 * provided the provider is listed in `mirror.providers`. `.well-known`
 * cannot be `proxy_only` — it has no upstream identity to mirror.
 */

export type PolicyRule = 'allow' | 'deny' | 'proxy_only';

export type ProviderId = 'github' | 'gitlab' | 'git' | '.well-known' | 'local';

/**
 * Provider classes that can route through the mirror. `.well-known` is
 * intentionally excluded: it's the catch-all "any HTTPS host" fallback
 * and has no stable upstream identity to mirror.
 */
export type MirrorableProviderId = Exclude<ProviderId, '.well-known' | 'local'>;

export interface MirrorConfig {
  /**
   * Base URL of the artifact mirror. The CLI rewrites source URLs to
   * `${url}/${originalHost}/${originalPath}` (GOPROXY shape) before any
   * fetch or clone.
   */
  url: string;
  /**
   * Provider classes that route through the mirror. Each provider in
   * `providers` must independently have `proxy_only` set (either via
   * `default` or `providers[<id>]`) for rewriting to apply.
   */
  providers: MirrorableProviderId[];
}

export interface Policy {
  version: 1;
  default?: PolicyRule;
  providers?: Partial<Record<ProviderId, PolicyRule>>;
  allow_sources?: string[];
  deny_sources?: string[];
  mirror?: MirrorConfig;
  require_locked_hash?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Human-readable reason for the decision. Surface to the user on deny. */
  reason: string;
  /** Which mechanism made the decision (for telemetry / debugging). */
  mechanism:
    | 'default'
    | 'provider'
    | 'allow_sources'
    | 'deny_sources'
    | 'well-known-default'
    | 'cli_flag'
    | 'mirror_rewrite';
  /**
   * When set, the caller must replace `parsed.url` with this value before
   * any network call. Produced by `proxy_only` + a matching `mirror.providers`
   * entry. The rewrite is a one-shot; it is not re-evaluated by the policy.
   */
  rewriteTo?: string;
}

/** Default behavior when no policy file is found AND no flag overrides it. */
export const DEFAULT_WELL_KNOWN_DENY = true;

function readJsonIfExists(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function validatePolicy(raw: unknown, sourcePath: string): Policy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Invalid policy file at ${sourcePath}: not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(
      `Invalid policy file at ${sourcePath}: unsupported version ${String(r.version)} (expected 1)`
    );
  }
  // .well-known cannot be proxy_only: there's no upstream identity to mirror.
  // Fail loud at load time rather than at fetch time.
  const providers = r.providers as Record<string, unknown> | undefined;
  if (providers && providers['.well-known'] === 'proxy_only') {
    throw new Error(
      `Invalid policy file at ${sourcePath}: providers[".well-known"] cannot be "proxy_only" — the .well-known fallback is the any-host catch-all and has no upstream to mirror. Use "allow" or "deny".`
    );
  }
  // Mirror must have a non-empty providers list — empty list is almost
  // certainly a configuration mistake (mirror configured but never used).
  const mirror = r.mirror as Record<string, unknown> | undefined;
  if (mirror) {
    if (typeof mirror.url !== 'string' || !mirror.url) {
      throw new Error(
        `Invalid policy file at ${sourcePath}: mirror.url must be a non-empty string`
      );
    }
    if (!Array.isArray(mirror.providers) || mirror.providers.length === 0) {
      throw new Error(
        `Invalid policy file at ${sourcePath}: mirror.providers must be a non-empty array`
      );
    }
    for (const p of mirror.providers) {
      if (p === '.well-known' || p === 'local') {
        throw new Error(
          `Invalid policy file at ${sourcePath}: mirror.providers cannot include "${p}"`
        );
      }
    }
  }
  return r as unknown as Policy;
}

export interface LoadedPolicy {
  policy: Policy | null;
  sourcePath: string | null;
}

/**
 * Resolve and load the active policy file. Returns `{ policy: null }` when
 * no file is found; callers fall back to built-in defaults.
 */
export function loadPolicy(cwd: string = process.cwd()): LoadedPolicy {
  const candidates: string[] = [];
  if (process.env.SKILLS_POLICY) candidates.push(process.env.SKILLS_POLICY);
  candidates.push(join(cwd, '.skills-policy.json'));
  candidates.push(join(homedir(), AGENTS_DIR, 'skills-policy.json'));

  for (const path of candidates) {
    const raw = readJsonIfExists(path);
    if (raw === null) continue;
    return { policy: validatePolicy(raw, path), sourcePath: path };
  }
  return { policy: null, sourcePath: null };
}

/**
 * Map a ParsedSource.type to the policy provider id.
 * `git` (generic non-host git URL) is grouped under `git`; well-known is
 * the catch-all "any HTTPS host" fallback and gets its own id.
 */
export function classifyProvider(parsed: ParsedSource): ProviderId {
  switch (parsed.type) {
    case 'github':
      return 'github';
    case 'gitlab':
      return 'gitlab';
    case 'git':
      return 'git';
    case 'well-known':
      return '.well-known';
    case 'local':
      return 'local';
  }
}

function matchesGlob(pattern: string, value: string): boolean {
  // Tiny glob: `*` matches any run of non-slash chars; `**` matches anything.
  // Sufficient for source patterns like "github.com/acme/*".
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp('^' + escaped + '$').test(value);
}

/**
 * Build a stable source identifier used for allow_sources / deny_sources
 * matching. Format: "<host>/<owner>/<repo>" for hosted providers,
 * "<host><path>" for well-known, "local" for local paths.
 */
/**
 * Compute the rewritten URL for a source routed through the mirror.
 * Returns null if the mirror is not configured for this provider.
 *
 * Path shape: `${mirror.url}/${originalHost}/${originalPathWithoutLeadingSlash}`.
 * Matches Go's GOPROXY model (`${proxy}/${module-path}`); admins configure
 * Artifactory / Nexus / JFrog generic-remote or VCS-remote repos to match.
 */
function computeMirrorRewrite(
  parsed: ParsedSource,
  policy: Policy | null,
  providerId: ProviderId
): string | null {
  if (!policy?.mirror) return null;
  if (providerId === '.well-known' || providerId === 'local') return null;
  if (!policy.mirror.providers.includes(providerId as MirrorableProviderId)) return null;

  let host: string;
  let pathPart: string;
  try {
    const u = new URL(parsed.url);
    host = u.hostname;
    pathPart = u.pathname.replace(/^\/+/, '');
  } catch {
    // SSH URLs like git@github.com:owner/repo: rewrite to https form.
    const ssh = parsed.url.match(/^git@([^:]+):(.+)$/);
    if (!ssh) return null;
    host = ssh[1]!;
    pathPart = ssh[2]!;
  }

  const base = policy.mirror.url.replace(/\/+$/, '');
  return `${base}/${host}/${pathPart}`;
}

function sourceIdentifier(parsed: ParsedSource): string {
  if (parsed.type === 'local') return 'local';
  try {
    const u = new URL(parsed.url);
    const path = u.pathname.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
    return path ? `${u.hostname}/${path}` : u.hostname;
  } catch {
    return parsed.url;
  }
}

export interface EvaluateInput {
  parsed: ParsedSource;
  policy: Policy | null;
  /** True if the user passed `--allow-well-known` on the CLI. */
  allowWellKnownFlag?: boolean;
}

/**
 * Evaluate whether the given source is permitted by the active policy.
 *
 * Precedence (first match wins):
 *   1. deny_sources match              -> deny
 *   2. allow_sources match             -> allow (skips provider/default)
 *   3. providers[<id>] override        -> allow/deny/proxy_only
 *   4. default rule                    -> allow/deny/proxy_only
 *   5. built-in defaults               -> allow everything except
 *                                         well_known (default-deny unless
 *                                         --allow-well-known)
 */
export function evaluatePolicy(input: EvaluateInput): PolicyDecision {
  const { parsed, policy, allowWellKnownFlag } = input;
  const providerId = classifyProvider(parsed);
  const ident = sourceIdentifier(parsed);

  if (policy?.deny_sources?.some((p) => matchesGlob(p, ident))) {
    return {
      allowed: false,
      reason: `source "${ident}" matches deny_sources entry in policy`,
      mechanism: 'deny_sources',
    };
  }

  if (policy?.allow_sources?.some((p) => matchesGlob(p, ident))) {
    return {
      allowed: true,
      reason: `source "${ident}" matches allow_sources entry in policy`,
      mechanism: 'allow_sources',
    };
  }

  const providerRule = policy?.providers?.[providerId];
  const defaultRule = policy?.default;
  const effective: PolicyRule | undefined = providerRule ?? defaultRule;

  if (effective === 'deny') {
    return {
      allowed: false,
      reason: `provider "${providerId}" is denied by policy (${providerRule ? 'providers' : 'default'} rule)`,
      mechanism: providerRule ? 'provider' : 'default',
    };
  }
  if (effective === 'proxy_only') {
    const rewritten = computeMirrorRewrite(parsed, policy, providerId);
    if (rewritten) {
      return {
        allowed: true,
        reason: `provider "${providerId}" is proxied through mirror ${policy?.mirror?.url}`,
        mechanism: 'mirror_rewrite',
        rewriteTo: rewritten,
      };
    }
    return {
      allowed: false,
      reason:
        providerId === '.well-known'
          ? `.well-known cannot be "proxy_only" — it is the any-host fallback and has no upstream identity to mirror`
          : `provider "${providerId}" is "proxy_only" but no mirror is configured for it (set policy.mirror.url and include "${providerId}" in policy.mirror.providers)`,
      mechanism: providerRule ? 'provider' : 'default',
    };
  }
  if (effective === 'allow') {
    return {
      allowed: true,
      reason: `provider "${providerId}" is allowed by policy (${providerRule ? 'providers' : 'default'} rule)`,
      mechanism: providerRule ? 'provider' : 'default',
    };
  }

  // No policy rule in effect. Fall through to built-in defaults.
  if (providerId === '.well-known') {
    if (allowWellKnownFlag) {
      return {
        allowed: true,
        reason: '--allow-well-known flag was passed',
        mechanism: 'cli_flag',
      };
    }
    if (DEFAULT_WELL_KNOWN_DENY) {
      return {
        allowed: false,
        reason: 'well-known resolution is disabled by default for safety',
        mechanism: 'well-known-default',
      };
    }
  }

  return { allowed: true, reason: 'no policy rule matched', mechanism: 'default' };
}

/**
 * Format a deny decision into a multi-line user-facing error block with
 * remediation steps. Returned without ANSI codes; callers add color.
 */
export function formatDenyMessage(
  decision: PolicyDecision,
  source: string,
  policySourcePath: string | null
): string {
  const lines: string[] = [];
  lines.push(`Installation blocked: ${decision.reason}`);
  lines.push('');
  if (decision.mechanism === 'well-known-default') {
    lines.push(`"${source}" is not a recognized provider (GitHub, GitLab, HuggingFace).`);
    lines.push('Well-known endpoints can install arbitrary code from any HTTPS host.');
    lines.push('This vector is commonly exploited via prompt injection of LLM agents.');
    lines.push('');
    lines.push('To enable:');
    lines.push(`  • for this command:  skills add ${source} --allow-well-known`);
    lines.push(
      '  • for this user:     set providers[".well-known"] = "allow" in ~/.agents/skills-policy.json'
    );
  } else if (policySourcePath) {
    lines.push(`Active policy: ${policySourcePath}`);
  }
  return lines.join('\n');
}
