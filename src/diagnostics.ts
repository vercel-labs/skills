import { defineDiagnostics, Diagnostic } from 'nostics';
import { ansiFormatter } from 'nostics/formatters/ansi';
import { pc } from './color.ts';

// An empty fix is omitted from the output.
const availableSkills = (names: string[]) =>
  names.length > 0 ? ['Available skills:', ...names.map((name) => `  - ${name}`)].join('\n') : '';

/**
 * Every user-facing error and warning the CLI raises. Codes are
 * `SKILLS_<WHAT_WENT_WRONG>` and permanent: never rename or reuse one. Entries
 * are grouped by area: command line, sources and skill selection, git,
 * download, archive, install, package.json "skills" field, Notion,
 * `skills use`, internal.
 */
export const diagnostics = defineDiagnostics({
  // `why` is the full user-facing message; `fix` only carries guidance that is
  // printed as its own line.
  codes: {
    SKILLS_INVALID_AGENTS: {
      why: (p: { invalid: string[]; valid: string[] }) => `Invalid agents: ${p.invalid.join(', ')}`,
      fix: (p: { valid: string[] }) => `Valid agents: ${p.valid.join(', ')}`,
    },
    SKILLS_OPTION_REQUIRES_VALUE: {
      why: (p: { option: string; value: string }) => `${p.option} requires ${p.value}`,
    },
    SKILLS_OPTION_TAKES_NO_VALUE: {
      why: (p: { option: string }) => `${p.option} does not take a value`,
    },
    SKILLS_UNKNOWN_OPTION: {
      why: (p: { option: string }) => `Unknown option: ${p.option}`,
    },
    SKILLS_INVALID_OPTION_VALUE: {
      why: (p: { option: string; expected: string }) => `${p.option} must be ${p.expected}`,
    },
    SKILLS_DUPLICATE_OPTION: {
      why: (p: { option: string }) => `Only one ${p.option} value can be provided`,
    },
    SKILLS_REMOVE_ALL_WITH_NAMES: {
      why: 'Cannot combine --all with specific skill names.',
      fix: (p: { example: string }) =>
        'Use `skills remove --all` to remove every skill, or omit --all to remove only the named skills.' +
        `\n   Example: skills remove ${p.example} -y`,
    },
    SKILLS_PROMPT_REQUIRES_TTY: {
      why:
        'Interactive prompt required but stdin is not a TTY. Nothing was installed. ' +
        "Use --agent <name> (or --agent '*') and -y to run non-interactively.",
    },
    SKILLS_MISSING_ARGUMENT: {
      why: (p: { name: string }) => `Missing required argument: ${p.name}`,
    },
    SKILLS_MULTIPLE_SOURCES: {
      why: (p: { received: string[] }) =>
        `Expected one source, received ${p.received.length}: ${p.received.join(', ')}`,
    },
    SKILLS_UNKNOWN_COMMAND: {
      why: (p: { command: string }) => `Unknown command: ${p.command}`,
      fix: 'Run skills --help for usage.',
    },
    SKILLS_REMOVE_GLOBALLY_TRACKED: {
      why: (p: { skills: string[] }) => `Tracked in the global lock: ${p.skills.join(', ')}`,
      fix: (p: { skills: string[] }) =>
        `Remove globally with: skills remove ${p.skills.join(' ')} -g`,
    },
    SKILLS_REMOVE_UNTRACKED_SKIPPED: {
      why: (p: { skills: string[] }) =>
        `Skipped ${p.skills.length} untracked skill(s) not recorded in the lock file: ${p.skills.join(', ')}`,
      fix: 'Remove them by name, e.g. skills remove <name>',
    },
    SKILLS_REMOVE_UNMANAGED_DIR_KEPT: {
      why: (p: { path: string }) =>
        `Kept ${p.path}: it is not an unmodified copy installed by skills`,
      fix: 'Delete it by hand if you no longer need it',
    },

    SKILLS_UNSAFE_SUBPATH: {
      why: (p: { subpath: string }) =>
        `Unsafe subpath: "${p.subpath}" contains path traversal segments. ` +
        `Subpaths must not contain ".." components.`,
    },
    SKILLS_SUBPATH_OUTSIDE_REPO: {
      why: (p: { subpath: string }) =>
        `Invalid subpath: "${p.subpath}" resolves outside the repository directory. Subpath must not contain ".." segments that escape the base path.`,
    },
    SKILLS_NO_MATCHING_SKILLS: {
      why: (p: { requested: string[] }) =>
        `No matching skills found for: ${p.requested.join(', ')}`,
      fix: (p: { available: string[] }) => availableSkills(p.available),
    },
    SKILLS_NO_VALID_SKILLS: {
      why: 'No valid skills found. Skills require a SKILL.md with name and description.',
    },
    SKILLS_MULTIPLE_SKILLS_IN_SOURCE: {
      why: (p: { names: string[] }) =>
        [
          'This source contains multiple skills. Specify exactly one skill:',
          ...p.names.map((name) => `  - ${name}`),
        ].join('\n'),
      fix: (p: { source: string; names: string[] }) => {
        const example = p.names[0] ?? '<skill>';
        return `Examples:\n  skills use ${p.source}@${example}\n  skills use ${p.source} --skill ${example}`;
      },
    },
    SKILLS_RENAME_MULTIPLE_SKILLS: {
      why: (p: { count: number }) =>
        `--rename installs one skill under a new name, but ${p.count} skills were selected.`,
      fix: 'Pick one skill with --skill <name> or <source>@<skill>.',
    },
    SKILLS_AMBIGUOUS_SKILL_SELECTOR: {
      why: (p: { selector: string }) => `Skill selector "${p.selector}" matched multiple skills.`,
    },
    SKILLS_CONFLICTING_SKILL_SELECTORS: {
      why: (p: { fromSource: string; fromOption: string }) =>
        `Conflicting skill selectors: source selects "${p.fromSource}" but --skill selects "${p.fromOption}". Provide one selector.`,
    },
    SKILLS_LOCAL_PATH_NOT_FOUND: {
      why: (p: { path: string }) => `Local path does not exist: ${p.path}`,
    },
    SKILLS_WELLKNOWN_SCOPE_NOT_FOUND: {
      why: (p: { scopePath: string; rootUrl: string }) =>
        `No skills found for the scoped path '${p.scopePath}' on ${p.rootUrl}. ` +
        `Not falling back to the root skills index because that would install every skill the host publishes. ` +
        `Check the URL, or run 'skills add ${p.rootUrl}' to install from the root index.`,
    },
    SKILLS_WELLKNOWN_DIGEST_MISMATCH: {
      why: (p: { skill: string; expected: string; actual: string }) =>
        `Digest mismatch for skill '${p.skill}': expected ${p.expected}, received ${p.actual}.`,
    },
    SKILLS_WELLKNOWN_FILE_FETCH_FAILED: {
      why: (p: { skill: string; path: string; status?: number }) =>
        `Failed to download "${p.path}" for skill "${p.skill}"` +
        (p.status === undefined ? '.' : ` (HTTP ${p.status}).`) +
        ' The skill cannot be installed without all listed files.',
    },
    SKILLS_WELLKNOWN_INDEX_NOT_FOUND: {
      why: 'No skills found at this URL. Make sure the server has a /.well-known/agent-skills/index.json or /.well-known/skills/index.json file.',
    },
    SKILLS_SKILL_SKIPPED: {
      why: (p: { path: string; reason: string }) => `⚠ Skipped ${p.path} — ${p.reason}`,
      data: (p: { path: string }) => ({ path: p.path }),
    },

    SKILLS_UNSUPPORTED_GIT_TRANSPORT: {
      why: (p: { transport: string }) => `Unsupported Git transport: ${p.transport}`,
    },
    SKILLS_GIT_CLONE_TIMEOUT: {
      why: (p: { seconds: number }) =>
        `Clone timed out after ${p.seconds}s. Common causes:\n` +
        `  - Large repository: raise the timeout with SKILLS_CLONE_TIMEOUT_MS=600000 (10m)\n` +
        `  - Slow network: retry, or clone manually and pass the local path to 'skills add'\n` +
        `  - Private repo without credentials: ensure auth is configured\n` +
        `      - For SSH: ssh-add -l (to check loaded keys)\n` +
        `      - For HTTPS: gh auth status (if using GitHub CLI)`,
    },
    SKILLS_GIT_AUTH_FAILED: {
      why: (p: { url: string; sshUrl?: string; host: string }) =>
        p.sshUrl
          ? `Authentication failed for ${p.url}.\n` +
            `  - For private repos, ensure you have access\n` +
            `  - Retry with SSH: npx skills add ${p.sshUrl}\n` +
            `  - Check access with: gh auth status -h ${p.host} or ssh -T git@${p.host}`
          : `Authentication failed for ${p.url}.\n` +
            `  - For private repos, ensure you have access\n` +
            `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
            `  - For HTTPS: Run 'gh auth login' or configure git credentials`,
    },
    SKILLS_GIT_SAML_SSO_BLOCKED: {
      why: (p: { url: string; sshUrl: string; host: string }) =>
        `GitHub blocked HTTPS access to ${p.url} because the organization enforces SAML SSO.\n` +
        `  skills tried your existing git credentials and available fallbacks, but none succeeded.\n` +
        `  - Re-authorize your GitHub credentials/app for that org's SSO policy\n` +
        `  - Or rerun with SSH: npx skills add ${p.sshUrl}\n` +
        `  - Verify access with: gh auth status -h ${p.host} or ssh -T git@${p.host}`,
    },
    SKILLS_GIT_CLONE_FAILED: {
      why: (p: { url: string; detail: string }) => `Failed to clone ${p.url}: ${p.detail}`,
    },

    SKILLS_DOWNLOAD_HTTP_ERROR: {
      why: (p: { status: number }) => `Download failed with HTTP ${p.status}`,
    },
    SKILLS_DOWNLOAD_TOO_LARGE: {
      why: (p: { maxBytes: number }) =>
        `Download is larger than ${p.maxBytes} bytes. Set SKILLS_DOWNLOAD_MAX_BYTES to override.`,
    },
    SKILLS_DOWNLOAD_NO_BODY: {
      why: 'Download response has no body',
    },
    SKILLS_DOWNLOAD_EMPTY: {
      why: 'Downloaded URL is empty',
    },
    SKILLS_DOWNLOAD_NOT_A_SKILL: {
      why: 'Downloaded URL is not a valid SKILL.md file or supported archive',
    },
    SKILLS_DOWNLOAD_NOT_LOCKED: {
      why: (p: { url: string; skills: string[] }) =>
        `Not recording ${p.skills.join(', ')} in the lock file: ${p.url} has a query string or credentials, which may be secret`,
      fix: 'To let `skills update` fetch it again, serve it from a URL without them.',
    },

    // Never shown: callers treat an unreadable archive as "not an archive".
    SKILLS_ARCHIVE_INVALID: {
      why: (p: { reason: string }) => p.reason,
    },
    SKILLS_ARCHIVE_MULTI_DISK_ZIP: {
      why: 'Multi-disk zip archives are not supported',
    },
    SKILLS_ARCHIVE_UNSAFE_PATH: {
      why: (p: { path: string }) => `Archive contains unsafe path: ${p.path}`,
    },
    SKILLS_ARCHIVE_ENCRYPTED_ENTRY: {
      why: 'Encrypted zip entries are not supported',
    },
    SKILLS_ARCHIVE_LINK_ENTRY: {
      why: 'Archive links are not supported',
    },
    SKILLS_ARCHIVE_TOO_MANY_FILES: {
      why: (p: { count: number; max: number; overrideEnv?: string }) =>
        `Archive contains too many files (${p.count}). Maximum is ${p.max}.` +
        (p.overrideEnv ? ` Set ${p.overrideEnv} to override.` : ''),
    },
    SKILLS_ARCHIVE_TOO_LARGE: {
      why: (p: { maxBytes: number; overrideEnv?: string }) =>
        `Archive extracts to more than ${p.maxBytes} bytes.` +
        (p.overrideEnv ? ` Set ${p.overrideEnv} to override.` : ''),
    },
    SKILLS_ARCHIVE_UNSUPPORTED_COMPRESSION: {
      why: (p: { method: number }) => `Unsupported zip compression method: ${p.method}`,
    },
    SKILLS_ARCHIVE_UNSUPPORTED_FORMAT: {
      why: 'Unsupported archive format',
    },
    SKILLS_ARCHIVE_MISSING_SKILL_MD: {
      why: 'Archive missing root SKILL.md',
    },
    SKILLS_WELLKNOWN_ARCHIVE_UNSAFE_PATH: {
      why: (p: { path: string }) => `Unsafe archive path: ${p.path}`,
    },
    SKILLS_WELLKNOWN_ARCHIVE_TOO_LARGE: {
      why: 'Archive exceeds maximum unpacked size',
    },
    SKILLS_WELLKNOWN_ARCHIVE_TOO_MANY_FILES: {
      why: 'Archive contains too many files',
    },

    SKILLS_UNSAFE_SKILL_NAME: {
      why: 'Invalid skill name: potential path traversal detected',
    },
    SKILLS_CLEANUP_OUTSIDE_TEMP_DIR: {
      why: 'Attempted to clean up directory outside of temp directory',
    },
    SKILLS_BROKEN_SYMLINK: {
      why: (p: { path: string }) => `Skipping broken symlink: ${p.path}`,
      data: (p: { path: string }) => ({ path: p.path }),
    },
    SKILLS_LOCK_MISSING_SOURCE_URL: {
      why: (p: { skill: string }) =>
        `Cannot restore ${p.skill}: skills-lock.json is missing sourceUrl for this generic Git source`,
    },
    SKILLS_INVALID_LOCAL_LOCK: {
      why: (p: { path: string; reason: string }) =>
        `Invalid ${p.path}: ${p.reason}. Fix or delete the file, then retry.`,
    },
    SKILLS_SYMLINK_OUTSIDE_SKILL: {
      why: (p: { path: string }) =>
        `Skipping symlink that points outside the skill directory: ${p.path}`,
      data: (p: { path: string }) => ({ path: p.path }),
    },

    SKILLS_SYMLINK_CYCLE: {
      why: (p: { path: string }) => `Skipping symlink that creates a directory cycle: ${p.path}`,
      data: (p: { path: string }) => ({ path: p.path }),
    },

    SKILLS_PACKAGE_SKILLS_NOT_ARRAY: {
      why: 'package.json: "skills" must be an array',
    },
    SKILLS_PACKAGE_SKILLS_INVALID_ENTRY: {
      why: (p: { declarer: string; entry: string }) =>
        `${p.declarer}: invalid "skills" entry ${p.entry}`,
    },
    SKILLS_PACKAGE_SKILLS_NOT_GIT_SOURCE: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" is not a git source`,
    },
    SKILLS_PACKAGE_SKILLS_DUPLICATE_REF: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" already has a ref; remove "ref"`,
    },
    SKILLS_PACKAGE_SKILLS_REF_NOT_ALLOWED: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "ref" cannot be used with "${p.source}"`,
    },
    SKILLS_PACKAGE_SKILLS_UNRESOLVED_NPM: {
      why: (p: { declarer: string; pkg: string }) =>
        `${p.declarer}: cannot resolve "npm:${p.pkg}"; is it a dependency?`,
    },

    SKILLS_NOTION_CLI_MISSING: {
      why: 'Notion CLI (ntn) is required. Install it from:\nhttps://developers.notion.com/cli/get-started/overview\nThen run `ntn login`.',
    },
    SKILLS_NOTION_API_FAILED: {
      why: (p: { stderr: string; exitCode: number | null }) =>
        `ntn api failed${p.stderr ? `: ${p.stderr}` : ` with exit code ${p.exitCode ?? 'unknown'}`}`,
    },
    SKILLS_NOTION_API_TIMEOUT: {
      why: (p: { seconds: number }) => `ntn api timed out after ${p.seconds} seconds`,
    },
    SKILLS_NOTION_API_OUTPUT_TOO_LARGE: {
      why: 'ntn api output exceeded 10 MiB',
    },
    SKILLS_NOTION_CLI_START_FAILED: {
      why: (p: { detail: string }) => `Unable to start ntn: ${p.detail}`,
    },
    SKILLS_NOTION_RESPONSE_MISSING_FIELD: {
      why: (p: { response: 'response' | 'list response'; field: string }) =>
        `Notion Agent Plugins ${p.response} is missing ${p.field}`,
    },
    SKILLS_NOTION_RESPONSE_INVALID_FIELD: {
      why: (p: { response: 'response' | 'list response'; field: string }) =>
        `Notion Agent Plugins ${p.response} has an invalid ${p.field}`,
    },
    SKILLS_NOTION_INVALID_PACK: {
      why: 'Notion Agent Plugins response contains an invalid pack',
    },
    SKILLS_NOTION_INVALID_LIST_RESPONSE: {
      why: 'Notion Agent Plugins list response is invalid',
    },
    SKILLS_NOTION_INVALID_DIRECTORY_RESPONSE: {
      why: (p: { label: string }) => `Notion ${p.label} directory response is invalid`,
    },
    SKILLS_NOTION_INVALID_JSON: {
      why: (p: { label: string }) => `ntn returned invalid JSON for ${p.label}`,
    },
    SKILLS_NOTION_INVALID_CURSOR: {
      why: 'Notion Agent Plugins pagination returned an invalid cursor',
    },
    SKILLS_NOTION_NO_PACKS: {
      why: 'Notion returned no packs for the authenticated workspace',
    },
    SKILLS_NOTION_NO_MATCHING_PACKS: {
      why: (p: { requested: string[] }) =>
        `No matching Notion packs found for: ${p.requested.join(', ')}`,
    },
    SKILLS_NOTION_PACK_CHANGED: {
      why: (p: { pack: string }) =>
        `Notion pack ${JSON.stringify(p.pack)} changed while preparing installation`,
    },
    SKILLS_NOTION_PACK_PREPARE_FAILED: {
      why: (p: { pack: string; detail: string }) =>
        `Failed to prepare Notion pack ${JSON.stringify(p.pack)}: ${p.detail}`,
    },
    SKILLS_NOTION_PACK_NO_SKILLS: {
      why: 'pack contains no valid skills',
    },

    SKILLS_USE_AGENT_UNSUPPORTED: {
      why: (p: { agent: string }) => `Running ${p.agent} is not supported yet.`,
      fix: (p: { supported: string[] }) =>
        `Supported agents for skills use --agent: ${p.supported.join(', ')}`,
    },
    SKILLS_USE_AGENT_COMMAND_NOT_FOUND: {
      why: (p: { agent: string; command: string }) =>
        `Could not launch ${p.agent}: command not found: ${p.command}`,
    },
    SKILLS_USE_AGENT_WILDCARD: {
      why: "skills use --agent does not support '*'; specify exactly one agent.",
    },
    SKILLS_USE_MULTIPLE_AGENTS: {
      why: 'skills use --agent accepts exactly one agent.',
    },
    SKILLS_USE_NO_MATCHING_SKILL: {
      why: (p: { selector: string }) => `No matching skill found for: ${p.selector}`,
      fix: (p: { available: string[] }) => availableSkills(p.available),
    },

    // Programmatic API (src/api). Thrown, or carried as `code` by per-skill failures.
    SKILLS_SOURCE_FETCH_FAILED: {
      why: (p: { source: string; detail: string }) => `Could not fetch ${p.source}: ${p.detail}`,
    },
    SKILLS_SOURCE_DISPOSED: {
      why: 'This source was already disposed. Resolve it again with resolveSource().',
    },
    SKILLS_DUPLICATE_SKILL_NAME: {
      why: (p: { skills: string[] }) =>
        ['Several folders declare the same skill name:', ...p.skills.map((s) => `  - ${s}`)].join(
          '\n'
        ),
      fix: "Select another skill, or install with duplicates: 'first'.",
    },
    SKILLS_SKILL_CONTAINS_SYMLINKS: {
      why: (p: { links: string[] }) =>
        ['Skills contain symlinks:', ...p.links.map((link) => `  - ${link}`)].join('\n'),
      fix: "Remove the symlinks from the source, or install with symlinks: 'follow'.",
    },
    SKILLS_AGENT_NOT_ALLOWED: {
      why: (p: { agents: string[] }) => `Not allowed by config.agents: ${p.agents.join(', ')}`,
    },
    SKILLS_NO_TARGET_AGENTS: {
      why: 'No allowed agents to target.',
      fix: 'Name agents that config.agents allows, or widen config.agents.include.',
    },
    SKILLS_GLOBAL_INSTALL_UNSUPPORTED: {
      why: (p: { agent: string }) => `${p.agent} does not support global skill installation`,
    },
    SKILLS_INSTALL_FAILED: {
      why: (p: { skill: string; agent: string; detail: string }) =>
        `Failed to install ${p.skill} for ${p.agent}: ${p.detail}`,
    },
    SKILLS_REMOVE_FAILED: {
      why: (p: { skill: string; detail: string }) => `Failed to remove ${p.skill}: ${p.detail}`,
    },
    SKILLS_LOCK_WRITE_FAILED: {
      why: (p: { detail: string }) =>
        `Skills were installed but the lock file could not be updated: ${p.detail}`,
    },

    SKILLS_PROVIDER_ALREADY_REGISTERED: {
      why: (p: { id: string }) => `Provider with id "${p.id}" already registered`,
    },
  },
});

export type DiagnosticCode = keyof typeof diagnostics;

const formatDiagnostic = ansiFormatter(pc);

/** Render a caught error for the terminal, with code and fix for diagnostics. */
export function formatError(error: unknown): string {
  if (error instanceof Diagnostic) return formatDiagnostic(error);
  return error instanceof Error ? error.message : String(error);
}

export function isDiagnostic(error: unknown, ...codes: DiagnosticCode[]): error is Diagnostic {
  return error instanceof Diagnostic && codes.some((code) => code === error.code);
}
