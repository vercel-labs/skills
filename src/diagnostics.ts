import { defineDiagnostics, Diagnostic } from 'nostics';
import { ansiFormatter } from 'nostics/formatters/ansi';
import pc from 'picocolors';

const bullets = (items: string[]) => items.map((item) => `\n     - ${item}`).join('');

/**
 * Every user-facing error and warning the CLI raises. Codes are permanent:
 * each one has a matching heading in docs/troubleshooting.md, so never rename
 * or reuse a code. Categories: C = command line, S = sources and skill
 * selection, G = git, D = download, A = archive, I = install, P = package.json
 * "skills" field, N = Notion, U = `skills use`, E = internal.
 */
export const diagnostics = defineDiagnostics({
  docsBase: (code) =>
    `https://github.com/vercel-labs/skills/blob/main/docs/troubleshooting.md#${code.toLowerCase()}`,
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
      fix: 'Run the command with --help to list its options.',
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
        `Use \`skills remove --all\` to remove every skill, or omit --all to remove only the named skills, e.g. skills remove ${p.example} -y`,
    },
    SKILLS_C007: {
      why: 'Interactive prompt required but stdin is not a TTY. Nothing was installed.',
      fix: "Use --agent <name> (or --agent '*') and -y to run non-interactively.",
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
        `Unsafe subpath: "${p.subpath}" contains path traversal segments.`,
      fix: 'Subpaths must not contain ".." components.',
    },
    SKILLS_S002: {
      why: (p: { subpath: string }) =>
        `Invalid subpath: "${p.subpath}" resolves outside the repository directory.`,
      fix: 'Subpath must not contain ".." segments that escape the base path.',
    },
    SKILLS_S003: {
      why: (p: { requested: string[] }) =>
        `No matching skills found for: ${p.requested.join(', ')}`,
      fix: (p: { available: string[] }) =>
        p.available.length > 0
          ? `Pick one of the available skills:${bullets(p.available)}`
          : 'Check the skill name and the source.',
    },
    SKILLS_S004: {
      why: 'No valid skills found.',
      fix: 'Skills require a SKILL.md with name and description.',
    },
    SKILLS_S005: {
      why: (p: { names: string[] }) =>
        `This source contains multiple skills. Specify exactly one skill:${bullets(p.names)}`,
      fix: (p: { source: string; names: string[] }) => {
        const example = p.names[0] ?? '<skill>';
        return `Run skills use ${p.source}@${example} or skills use ${p.source} --skill ${example}`;
      },
    },
    SKILLS_S006: {
      why: (p: { selector: string }) => `Skill selector "${p.selector}" matched multiple skills.`,
      fix: 'Select the skill by its full name.',
    },
    SKILLS_S007: {
      why: (p: { fromSource: string; fromOption: string }) =>
        `Conflicting skill selectors: source selects "${p.fromSource}" but --skill selects "${p.fromOption}".`,
      fix: 'Provide one selector.',
    },
    SKILLS_S008: {
      why: (p: { path: string }) => `Local path does not exist: ${p.path}`,
    },
    SKILLS_S009: {
      why: (p: { scopePath: string; rootUrl: string }) =>
        `No skills found for the scoped path '${p.scopePath}' on ${p.rootUrl}. Not falling back to the root skills index because that would install every skill the host publishes.`,
      fix: (p: { rootUrl: string }) =>
        `Check the URL, or run 'skills add ${p.rootUrl}' to install from the root index.`,
    },
    SKILLS_S010: {
      why: 'No skills found at this URL.',
      fix: 'Make sure the server has a /.well-known/agent-skills/index.json or /.well-known/skills/index.json file.',
    },
    SKILLS_S011: {
      why: (p: { path: string; reason: string }) => `Skipped ${p.path}: ${p.reason}`,
      fix: 'SKILL.md needs YAML frontmatter with string "name" and "description" fields.',
    },

    SKILLS_G001: {
      why: (p: { transport: string }) => `Unsupported Git transport: ${p.transport}`,
      fix: 'Use an https, ssh, git, or file URL.',
    },
    SKILLS_G002: {
      why: (p: { seconds: number }) => `Clone timed out after ${p.seconds}s.`,
      fix:
        'Common causes:' +
        bullets([
          'Large repository: raise the timeout with SKILLS_CLONE_TIMEOUT_MS=600000 (10m)',
          "Slow network: retry, or clone manually and pass the local path to 'skills add'",
          'Private repo without credentials: check SSH keys with ssh-add -l, or HTTPS with gh auth status',
        ]),
    },
    SKILLS_G003: {
      why: (p: { url: string }) => `Authentication failed for ${p.url}.`,
      fix: (p: { sshUrl?: string; host: string }) =>
        'For private repos, ensure you have access.' +
        bullets(
          p.sshUrl
            ? [
                `Retry with SSH: npx skills add ${p.sshUrl}`,
                `Check access with: gh auth status -h ${p.host} or ssh -T git@${p.host}`,
              ]
            : [
                `For SSH: check your keys with 'ssh -T git@${p.host}'`,
                "For HTTPS: run 'gh auth login' or configure git credentials",
              ]
        ),
    },
    SKILLS_G004: {
      why: (p: { url: string }) =>
        `GitHub blocked HTTPS access to ${p.url} because the organization enforces SAML SSO. skills tried your existing git credentials and available fallbacks, but none succeeded.`,
      fix: (p: { sshUrl: string; host: string }) =>
        "Re-authorize your GitHub credentials/app for that org's SSO policy." +
        bullets([
          `Or rerun with SSH: npx skills add ${p.sshUrl}`,
          `Verify access with: gh auth status -h ${p.host} or ssh -T git@${p.host}`,
        ]),
    },
    SKILLS_G005: {
      why: (p: { url: string; detail: string }) => `Failed to clone ${p.url}: ${p.detail}`,
    },

    SKILLS_D001: {
      why: (p: { status: number }) => `Download failed with HTTP ${p.status}`,
    },
    SKILLS_D002: {
      why: (p: { maxBytes: number }) => `Download is larger than ${p.maxBytes} bytes.`,
      fix: 'Set SKILLS_DOWNLOAD_MAX_BYTES to override.',
    },
    SKILLS_D003: {
      why: 'Download response has no body',
    },
    SKILLS_D004: {
      why: 'Downloaded URL is empty',
    },
    SKILLS_D005: {
      why: 'Downloaded URL is not a valid SKILL.md file or supported archive',
      fix: 'Point to a SKILL.md with name and description frontmatter, or a zip/tar archive containing one.',
    },

    SKILLS_A001: {
      why: (p: { reason: string }) => p.reason,
      fix: 'The archive is corrupt. Re-create it or download it again.',
    },
    SKILLS_A002: {
      why: 'Multi-disk zip archives are not supported',
      fix: 'Re-create the archive as a single file.',
    },
    SKILLS_A003: {
      why: (p: { path: string }) => `Archive contains unsafe path: ${p.path}`,
      fix: 'Archive entries must be relative paths without ".." segments.',
    },
    SKILLS_A004: {
      why: 'Encrypted zip entries are not supported',
      fix: 'Re-create the archive without encryption.',
    },
    SKILLS_A005: {
      why: 'Archive links are not supported',
      fix: 'Replace symbolic and hard links with regular files.',
    },
    SKILLS_A006: {
      why: (p: { count: number; max: number }) =>
        `Archive contains too many files (${p.count}). Maximum is ${p.max}.`,
      fix: (p: { overrideEnv?: string }) =>
        p.overrideEnv
          ? `Set ${p.overrideEnv} to override.`
          : 'Remove files the skill does not need.',
    },
    SKILLS_A007: {
      why: (p: { maxBytes: number }) => `Archive extracts to more than ${p.maxBytes} bytes.`,
      fix: (p: { overrideEnv?: string }) =>
        p.overrideEnv
          ? `Set ${p.overrideEnv} to override.`
          : 'Remove files the skill does not need.',
    },
    SKILLS_A008: {
      why: (p: { method: number }) => `Unsupported zip compression method: ${p.method}`,
      fix: 'Re-create the archive with deflate or no compression.',
    },
    SKILLS_A009: {
      why: 'Unsupported archive format',
      fix: 'Publish the skill as a .zip or .tar.gz archive.',
    },
    SKILLS_A010: {
      why: 'Archive missing root SKILL.md',
      fix: 'Place SKILL.md at the root of the archive.',
    },

    SKILLS_I001: {
      why: 'Invalid skill name: potential path traversal detected',
      fix: 'Skill names must not contain path separators or ".." segments.',
    },
    SKILLS_I002: {
      why: 'Attempted to clean up directory outside of temp directory',
    },
    SKILLS_I003: {
      why: (p: { path: string }) => `Skipping broken symlink: ${p.path}`,
      fix: 'Replace the link with the file it points to, or remove it from the skill.',
    },
    SKILLS_I004: {
      why: (p: { skill: string }) =>
        `Cannot restore ${p.skill}: skills-lock.json is missing sourceUrl for this generic Git source`,
      fix: 'Reinstall the skill with skills add <git-url> to record its source.',
    },

    SKILLS_P001: {
      why: 'package.json: "skills" must be an array',
    },
    SKILLS_P002: {
      why: (p: { declarer: string; entry: string }) =>
        `${p.declarer}: invalid "skills" entry ${p.entry}`,
      fix: 'Each entry is a source string or { "source": string, "skills"?: string[], "ref"?: string }.',
    },
    SKILLS_P003: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" is not a git source`,
      fix: 'The "skills" field accepts git-hosted sources (GitHub, GitLab, git URLs) and npm: packages.',
    },
    SKILLS_P004: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "${p.source}" already has a ref`,
      fix: 'Remove "ref".',
    },
    SKILLS_P005: {
      why: (p: { declarer: string; source: string }) =>
        `${p.declarer}: "ref" cannot be used with "${p.source}"`,
      fix: 'npm: entries use the version installed in node_modules. Remove "ref".',
    },
    SKILLS_P006: {
      why: (p: { declarer: string; pkg: string }) => `${p.declarer}: cannot resolve "npm:${p.pkg}"`,
      fix: (p: { pkg: string }) => `Add ${p.pkg} to dependencies and install it.`,
    },

    SKILLS_N001: {
      why: 'Notion CLI (ntn) is required.',
      fix: 'Install it from https://developers.notion.com/cli/get-started/overview, then run `ntn login`.',
    },
    SKILLS_N002: {
      why: (p: { reason: string }) => `ntn api failed: ${p.reason}`,
      fix: 'Check that `ntn login` succeeded, then retry. Set SKILLS_DEBUG=1 to log ntn commands.',
    },
    SKILLS_N003: {
      why: (p: { reason: string }) => p.reason,
      fix: 'Update ntn and skills, then retry.',
    },
    SKILLS_N004: {
      why: 'Notion returned no packs for the authenticated workspace',
      fix: 'Check that ntn is logged in to the workspace that has the packs.',
    },
    SKILLS_N005: {
      why: (p: { requested: string[] }) =>
        `No matching Notion packs found for: ${p.requested.join(', ')}`,
      fix: 'Run skills add notion --list to see available packs.',
    },
    SKILLS_N006: {
      why: (p: { pack: string }) =>
        `Notion pack ${JSON.stringify(p.pack)} changed while preparing installation`,
      fix: 'Retry the installation.',
    },
    SKILLS_N007: {
      why: (p: { pack: string; detail: string }) =>
        `Failed to prepare Notion pack ${JSON.stringify(p.pack)}: ${p.detail}`,
    },

    SKILLS_U001: {
      why: (p: { agent: string }) => `Running ${p.agent} is not supported yet.`,
      fix: (p: { supported: string[] }) =>
        `Supported agents for skills use --agent: ${p.supported.join(', ')}`,
    },
    SKILLS_U002: {
      why: (p: { agent: string; command: string }) =>
        `Could not launch ${p.agent}: command not found: ${p.command}`,
      fix: (p: { agent: string; command: string }) =>
        `Install ${p.agent} and make sure \`${p.command}\` is on your PATH.`,
    },
    SKILLS_U003: {
      why: "skills use --agent does not support '*'.",
      fix: 'Specify exactly one agent.',
    },
    SKILLS_U004: {
      why: 'skills use --agent accepts exactly one agent.',
    },

    SKILLS_E001: {
      why: (p: { id: string }) => `Provider with id "${p.id}" already registered`,
      fix: 'This is a bug in skills. Please report it.',
    },
  },
});

export type DiagnosticCode = keyof typeof diagnostics;

const formatDiagnostic = ansiFormatter(pc);

/** Render a caught error for the terminal, with code, fix, and docs link for diagnostics. */
export function formatError(error: unknown): string {
  if (error instanceof Diagnostic) return formatDiagnostic(error);
  return error instanceof Error ? error.message : String(error);
}

export function isDiagnostic(error: unknown, ...codes: DiagnosticCode[]): error is Diagnostic {
  return error instanceof Diagnostic && codes.some((code) => code === error.code);
}
