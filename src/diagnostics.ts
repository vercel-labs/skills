import { defineDiagnostics, Diagnostic } from 'nostics';
import { ansiFormatter } from 'nostics/formatters/ansi';
import pc from 'picocolors';

// An empty fix is omitted from the output.
const availableSkills = (names: string[]) =>
  names.length > 0 ? ['Available skills:', ...names.map((name) => `  - ${name}`)].join('\n') : '';

/**
 * Every user-facing error and warning the CLI raises. Codes are permanent:
 * never rename or reuse one. Categories: C = command line, S = sources and skill
 * selection, G = git, D = download, A = archive, I = install, P = package.json
 * "skills" field, N = Notion, U = `skills use`, E = internal.
 */
export const diagnostics = defineDiagnostics({
  // `why` is the full user-facing message; `fix` only carries guidance that is
  // printed as its own line.
  codes: {
    SKILLS_C001: {
      why: (p: { invalid: string[]; valid: string[] }) => `Invalid agents: ${p.invalid.join(', ')}`,
      fix: (p: { valid: string[] }) => `Valid agents: ${p.valid.join(', ')}`,
    },
    SKILLS_C002: {
      why: (p: { option: string; value: string }) => `${p.option} requires ${p.value}`,
    },
    SKILLS_C003: {
      why: (p: { option: string }) => `Unknown option: ${p.option}`,
    },
    SKILLS_C004: {
      why: (p: { option: string; expected: string }) => `${p.option} must be ${p.expected}`,
    },
    SKILLS_C005: {
      why: (p: { option: string }) => `Only one ${p.option} value can be provided`,
    },
    SKILLS_C006: {
      why: 'Cannot combine --all with specific skill names.',
      fix: (p: { example: string }) =>
        'Use `skills remove --all` to remove every skill, or omit --all to remove only the named skills.' +
        `\n   Example: skills remove ${p.example} -y`,
    },
    SKILLS_C007: {
      why:
        'Interactive prompt required but stdin is not a TTY. Nothing was installed. ' +
        "Use --agent <name> (or --agent '*') and -y to run non-interactively.",
    },
    SKILLS_C008: {
      why: (p: { name: string }) => `Missing required argument: ${p.name}`,
    },
    SKILLS_C009: {
      why: (p: { received: string[] }) =>
        `Expected one source, received ${p.received.length}: ${p.received.join(', ')}`,
    },
    SKILLS_C010: {
      why: (p: { command: string }) => `Unknown command: ${p.command}`,
      fix: 'Run skills --help for usage.',
    },

    SKILLS_S001: {
      why: (p: { subpath: string }) =>
        `Unsafe subpath: "${p.subpath}" contains path traversal segments. ` +
        `Subpaths must not contain ".." components.`,
    },
    SKILLS_S002: {
      why: (p: { subpath: string }) =>
        `Invalid subpath: "${p.subpath}" resolves outside the repository directory. Subpath must not contain ".." segments that escape the base path.`,
    },
    SKILLS_S003: {
      why: (p: { requested: string[] }) =>
        `No matching skills found for: ${p.requested.join(', ')}`,
      fix: (p: { available: string[] }) => availableSkills(p.available),
    },
    SKILLS_S004: {
      why: 'No valid skills found. Skills require a SKILL.md with name and description.',
    },
    SKILLS_S005: {
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
    SKILLS_S006: {
      why: (p: { selector: string }) => `Skill selector "${p.selector}" matched multiple skills.`,
    },
    SKILLS_S007: {
      why: (p: { fromSource: string; fromOption: string }) =>
        `Conflicting skill selectors: source selects "${p.fromSource}" but --skill selects "${p.fromOption}". Provide one selector.`,
    },
    SKILLS_S008: {
      why: (p: { path: string }) => `Local path does not exist: ${p.path}`,
    },
    SKILLS_S009: {
      why: (p: { scopePath: string; rootUrl: string }) =>
        `No skills found for the scoped path '${p.scopePath}' on ${p.rootUrl}. ` +
        `Not falling back to the root skills index because that would install every skill the host publishes. ` +
        `Check the URL, or run 'skills add ${p.rootUrl}' to install from the root index.`,
    },
    SKILLS_S010: {
      why: 'No skills found at this URL. Make sure the server has a /.well-known/agent-skills/index.json or /.well-known/skills/index.json file.',
    },
    SKILLS_S011: {
      why: (p: { path: string; reason: string }) => `⚠ Skipped ${p.path} — ${p.reason}`,
    },

    SKILLS_G001: {
      why: (p: { transport: string }) => `Unsupported Git transport: ${p.transport}`,
    },
    SKILLS_G002: {
      why: (p: { seconds: number }) =>
        `Clone timed out after ${p.seconds}s. Common causes:\n` +
        `  - Large repository: raise the timeout with SKILLS_CLONE_TIMEOUT_MS=600000 (10m)\n` +
        `  - Slow network: retry, or clone manually and pass the local path to 'skills add'\n` +
        `  - Private repo without credentials: ensure auth is configured\n` +
        `      - For SSH: ssh-add -l (to check loaded keys)\n` +
        `      - For HTTPS: gh auth status (if using GitHub CLI)`,
    },
    SKILLS_G003: {
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
    SKILLS_G004: {
      why: (p: { url: string; sshUrl: string; host: string }) =>
        `GitHub blocked HTTPS access to ${p.url} because the organization enforces SAML SSO.\n` +
        `  skills tried your existing git credentials and available fallbacks, but none succeeded.\n` +
        `  - Re-authorize your GitHub credentials/app for that org's SSO policy\n` +
        `  - Or rerun with SSH: npx skills add ${p.sshUrl}\n` +
        `  - Verify access with: gh auth status -h ${p.host} or ssh -T git@${p.host}`,
    },
    SKILLS_G005: {
      why: (p: { url: string; detail: string }) => `Failed to clone ${p.url}: ${p.detail}`,
    },

    SKILLS_D001: {
      why: (p: { status: number }) => `Download failed with HTTP ${p.status}`,
    },
    SKILLS_D002: {
      why: (p: { maxBytes: number }) =>
        `Download is larger than ${p.maxBytes} bytes. Set SKILLS_DOWNLOAD_MAX_BYTES to override.`,
    },
    SKILLS_D003: {
      why: 'Download response has no body',
    },
    SKILLS_D004: {
      why: 'Downloaded URL is empty',
    },
    SKILLS_D005: {
      why: 'Downloaded URL is not a valid SKILL.md file or supported archive',
    },

    // Never shown: callers treat an unreadable archive as "not an archive".
    SKILLS_A001: {
      why: (p: { reason: string }) => p.reason,
    },
    SKILLS_A002: {
      why: 'Multi-disk zip archives are not supported',
    },
    SKILLS_A003: {
      why: (p: { path: string }) => `Archive contains unsafe path: ${p.path}`,
    },
    SKILLS_A004: {
      why: 'Encrypted zip entries are not supported',
    },
    SKILLS_A005: {
      why: 'Archive links are not supported',
    },
    SKILLS_A006: {
      why: (p: { count: number; max: number; overrideEnv?: string }) =>
        `Archive contains too many files (${p.count}). Maximum is ${p.max}.` +
        (p.overrideEnv ? ` Set ${p.overrideEnv} to override.` : ''),
    },
    SKILLS_A007: {
      why: (p: { maxBytes: number; overrideEnv?: string }) =>
        `Archive extracts to more than ${p.maxBytes} bytes.` +
        (p.overrideEnv ? ` Set ${p.overrideEnv} to override.` : ''),
    },
    SKILLS_A008: {
      why: (p: { method: number }) => `Unsupported zip compression method: ${p.method}`,
    },
    SKILLS_A009: {
      why: 'Unsupported archive format',
    },
    SKILLS_A010: {
      why: 'Archive missing root SKILL.md',
    },
    SKILLS_A011: {
      why: (p: { path: string }) => `Unsafe archive path: ${p.path}`,
    },
    SKILLS_A012: {
      why: 'Archive exceeds maximum unpacked size',
    },
    SKILLS_A013: {
      why: 'Archive contains too many files',
    },

    SKILLS_I001: {
      why: 'Invalid skill name: potential path traversal detected',
    },
    SKILLS_I002: {
      why: 'Attempted to clean up directory outside of temp directory',
    },
    SKILLS_I003: {
      why: (p: { path: string }) => `Skipping broken symlink: ${p.path}`,
    },
    SKILLS_I004: {
      why: (p: { skill: string }) =>
        `Cannot restore ${p.skill}: skills-lock.json is missing sourceUrl for this generic Git source`,
    },
    SKILLS_I005: {
      why: (p: { path: string; reason: string }) =>
        `Invalid ${p.path}: ${p.reason}. Fix or delete the file, then retry.`,
    },
    SKILLS_I006: {
      why: (p: { path: string }) =>
        `Skipping symlink that points outside the skill directory: ${p.path}`,
    },

    SKILLS_P001: {
      why: 'package.json: "skills" must be an array',
    },
    SKILLS_P002: {
      why: (p: { declarer: string; entry: string }) =>
        `${p.declarer}: invalid "skills" entry ${p.entry}`,
    },
    SKILLS_P003: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" is not a git source`,
    },
    SKILLS_P004: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" already has a ref; remove "ref"`,
    },
    SKILLS_P005: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "ref" cannot be used with "${p.source}"`,
    },
    SKILLS_P006: {
      why: (p: { declarer: string; pkg: string }) =>
        `${p.declarer}: cannot resolve "npm:${p.pkg}"; is it a dependency?`,
    },

    SKILLS_N001: {
      why: 'Notion CLI (ntn) is required. Install it from:\nhttps://developers.notion.com/cli/get-started/overview\nThen run `ntn login`.',
    },
    SKILLS_N002: {
      why: (p: { stderr: string; exitCode: number | null }) =>
        `ntn api failed${p.stderr ? `: ${p.stderr}` : ` with exit code ${p.exitCode ?? 'unknown'}`}`,
    },
    SKILLS_N003: {
      why: (p: { seconds: number }) => `ntn api timed out after ${p.seconds} seconds`,
    },
    SKILLS_N004: {
      why: 'ntn api output exceeded 10 MiB',
    },
    SKILLS_N005: {
      why: (p: { detail: string }) => `Unable to start ntn: ${p.detail}`,
    },
    SKILLS_N006: {
      why: (p: { response: 'response' | 'list response'; field: string }) =>
        `Notion Agent Plugins ${p.response} is missing ${p.field}`,
    },
    SKILLS_N007: {
      why: (p: { response: 'response' | 'list response'; field: string }) =>
        `Notion Agent Plugins ${p.response} has an invalid ${p.field}`,
    },
    SKILLS_N008: {
      why: 'Notion Agent Plugins response contains an invalid pack',
    },
    SKILLS_N009: {
      why: 'Notion Agent Plugins list response is invalid',
    },
    SKILLS_N010: {
      why: (p: { label: string }) => `Notion ${p.label} directory response is invalid`,
    },
    SKILLS_N011: {
      why: (p: { label: string }) => `ntn returned invalid JSON for ${p.label}`,
    },
    SKILLS_N012: {
      why: 'Notion Agent Plugins pagination returned an invalid cursor',
    },
    SKILLS_N013: {
      why: 'Notion returned no packs for the authenticated workspace',
    },
    SKILLS_N014: {
      why: (p: { requested: string[] }) =>
        `No matching Notion packs found for: ${p.requested.join(', ')}`,
    },
    SKILLS_N015: {
      why: (p: { pack: string }) =>
        `Notion pack ${JSON.stringify(p.pack)} changed while preparing installation`,
    },
    SKILLS_N016: {
      why: (p: { pack: string; detail: string }) =>
        `Failed to prepare Notion pack ${JSON.stringify(p.pack)}: ${p.detail}`,
    },
    SKILLS_N017: {
      why: 'pack contains no valid skills',
    },

    SKILLS_U001: {
      why: (p: { agent: string }) => `Running ${p.agent} is not supported yet.`,
      fix: (p: { supported: string[] }) =>
        `Supported agents for skills use --agent: ${p.supported.join(', ')}`,
    },
    SKILLS_U002: {
      why: (p: { agent: string; command: string }) =>
        `Could not launch ${p.agent}: command not found: ${p.command}`,
    },
    SKILLS_U003: {
      why: "skills use --agent does not support '*'; specify exactly one agent.",
    },
    SKILLS_U004: {
      why: 'skills use --agent accepts exactly one agent.',
    },
    SKILLS_U005: {
      why: (p: { selector: string }) => `No matching skill found for: ${p.selector}`,
      fix: (p: { available: string[] }) => availableSkills(p.available),
    },

    SKILLS_E001: {
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
