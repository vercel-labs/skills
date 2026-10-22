# CLI reference

[Back to the README](../README.md)

Run commands with `npx skills <command>`. For all available options, run `npx skills --help`.

## `skills add`

Install skills from a repository, URL, or local directory:

```bash
npx skills add vercel-labs/agent-skills
```

### Source Formats

```bash
# GitHub shorthand (owner/repo)
npx skills add vercel-labs/agent-skills

# Full GitHub URL
npx skills add https://github.com/vercel-labs/agent-skills

# Direct path to a skill in a repo
npx skills add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx skills add https://gitlab.com/org/repo

# Azure Repos (Azure DevOps Services or Server)
npx skills add https://dev.azure.com/org/project/_git/repo
npx skills add https://dev.azure.com/org/project/_git/repo?path=/skills/web-design&version=GBmain

# Any git URL
npx skills add git@github.com:vercel-labs/agent-skills.git

# Local path
npx skills add ./my-local-skills
```

### Private Repositories

Use the same command for public and private repositories. The CLI uses the authentication already configured for the repository URL:

```bash
# GitHub shorthand or HTTPS (Git credential helper, GitHub CLI, then SSH fallback)
npx skills add acme/private-skills

# SSH on GitHub, GitLab, or another Git host
npx skills add git@github.com:acme/private-skills.git
npx skills add ssh://git@git.example.com/acme/private-skills.git

# HTTPS on any Git host (uses your configured Git credential helper)
npx skills add https://git.example.com/acme/private-skills.git
npx skills add https://dev.azure.com/org/project/_git/private-skills
```

For GitHub HTTPS and shorthand sources, `skills` first uses normal Git credentials. If that fails and GitHub CLI is authenticated, it tries `gh repo clone`, followed by SSH. It does not execute `gh auth token` or copy the stored GitHub CLI credential into the Node.js process.

For GitHub tree lookups, `skills` first tries the API anonymously, then an explicitly supplied environment token, then `gh api`. GitHub CLI applies its own stored authentication and returns only the API response; the credential is never printed to or read by `skills`. If API access still fails, update checks fall back to an authenticated Git clone.

`GITHUB_TOKEN` or `GH_TOKEN` can be set explicitly for GitHub API access, including private repository downloads and update checks. They are optional for installs when Git, GitHub CLI, or SSH authentication is already configured.

### Options

| Option                    | Description                                                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | Install to user directory instead of project                                                                                                                |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Supported Agents](agents.md#supported-agents)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | Install specific skills by name (use `'*'` for all skills)                                                                                                  |
| `-l, --list`              | List available skills without installing                                                                                                                    |
| `--copy`                  | Copy files instead of symlinking to agent directories                                                                                                       |
| `-y, --yes`               | Skip all confirmation prompts                                                                                                                               |
| `--all`                   | Install all skills to all agents without prompts                                                                                                            |

### Examples

```bash
# List skills in a repository
npx skills add vercel-labs/agent-skills --list

# Install specific skills
npx skills add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# Install a skill with spaces in the name (must be quoted)
npx skills add owner/repo --skill "Convex Best Practices"

# Install to specific agents
npx skills add vercel-labs/agent-skills -a claude-code -a opencode

# Non-interactive installation (CI/CD friendly)
npx skills add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# Install all skills from a repo to all agents
npx skills add vercel-labs/agent-skills --all

# Install all skills to specific agents
npx skills add vercel-labs/agent-skills --skill '*' -a claude-code

# Install specific skills to all agents
npx skills add vercel-labs/agent-skills --agent '*' --skill frontend-design

# Install from a direct SKILL.md or archive download URL
npx skills add https://example.com/download/my-skill
```

Direct download URLs are tried after well-known discovery. They may point to a single valid `SKILL.md` file or a `.zip`, `.tar`, `.tar.gz`, or `.tgz` archive; the URL does not need to include a file extension. Downloads are limited to 10 MiB, extracted content to 25 MiB, and archives to 1000 files by default. Override with `SKILLS_DOWNLOAD_MAX_BYTES`, `SKILLS_EXTRACT_MAX_BYTES`, and `SKILLS_EXTRACT_MAX_FILES` when you trust the source.

### Installation Scope

| Scope       | Flag      | Location            | Use Case                                      |
| ----------- | --------- | ------------------- | --------------------------------------------- |
| **Project** | (default) | `./<agent>/skills/` | Committed with your project, shared with team |
| **Global**  | `-g`      | `~/<agent>/skills/` | Available across all projects                 |

### Installation Methods

When installing interactively, you can choose:

| Method                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| **Symlink** (Recommended) | Creates symlinks from each agent to a canonical copy. Single source of truth, easy updates. |
| **Copy**                  | Creates independent copies for each agent. Use when symlinks aren't supported.              |

## `skills use`

Generate a prompt for one skill, or start a supported coding agent interactively:

```bash
npx skills use vercel-labs/agent-skills@web-design-guidelines | claude
npx skills use vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code
```

`skills use` resolves sources the same way as `skills add`, writes the selected skill files to a temporary directory, and prints only the generated prompt to stdout unless `--agent` is provided. With `--agent`, it starts one supported agent interactively with the generated prompt.

## `skills list`

List all installed skills. Similar to `npm ls`.

```bash
# List project installed skills
npx skills list

# List only global skills
npx skills ls -g

# Filter by specific agents
npx skills ls -a claude-code -a cursor
```

## `skills find`

Search for skills interactively or by keyword.

```bash
# Interactive search (fzf-style)
npx skills find

# Search by keyword
npx skills find typescript

# Search across every repository owned by an organization or user
npx skills find react --owner vercel
```

## `skills check`

Check installed skills for available updates without reinstalling them:

```bash
npx skills check
```

## `skills update`

```bash
# Update all skills (interactive scope prompt)
npx skills update

# Update a single skill by name
npx skills update my-skill

# Update multiple specific skills
npx skills update frontend-design web-design-guidelines

# Update only global or project skills
npx skills update -g
npx skills update -p

# Non-interactive (auto-detects scope: project if in a project, else global)
npx skills update -y
```

| Option          | Description                                                               |
| --------------- | ------------------------------------------------------------------------- |
| `-g, --global`  | Only update global skills                                                 |
| `-p, --project` | Only update project skills                                                |
| `-y, --yes`     | Skip scope prompt (auto-detect: project if in a project dir, else global) |
| `[skills...]`   | Update specific skills by name instead of all                             |

## `skills init`

```bash
# Create SKILL.md in current directory
npx skills init

# Create a new skill in a subdirectory
npx skills init my-skill
```

## `skills remove`

Remove installed skills from agents.

```bash
# Remove interactively (select from installed skills)
npx skills remove

# Remove all skills from an exact lock source
npx skills remove owner/repo

# Remove specific skill by name
npx skills remove web-design-guidelines

# Remove multiple skills
npx skills remove frontend-design web-design-guidelines

# Remove from global scope
npx skills remove --global web-design-guidelines

# Remove from specific agents only
npx skills remove --agent claude-code cursor my-skill

# Remove all installed skills without confirmation
npx skills remove --all

# Remove all skills from a specific agent
npx skills remove --skill '*' -a cursor

# Remove a specific skill from all agents
npx skills remove my-skill --agent '*'

# Use 'rm' alias
npx skills rm my-skill
```

| Option         | Description                                      |
| -------------- | ------------------------------------------------ |
| `-g, --global` | Remove from global scope (~/) instead of project |
| `-a, --agent`  | Remove from specific agents (use `'*'` for all)  |
| `-s, --skill`  | Specify skills to remove (use `'*'` for all)     |
| `-y, --yes`    | Skip confirmation prompts                        |
| `--all`        | Shorthand for `--skill '*' --agent '*' -y`       |

## Experimental commands

These commands are still experimental. Their names, options, and behavior may change.

<a id="skills-sync"></a>

### `skills experimental_sync`

Sync skills from npm packages and `package.json` declarations. `sync` remains
supported as a compatibility alias for users of skills@1.7.3.

Install a package that ships skills, then sync them into your project:

```bash
npm install -D skills agent-browser
npx skills experimental_sync -y
```

Sync reads installed dependencies declared in your project's `package.json`, including
`dependencies`, `devDependencies`, `optionalDependencies`, and `peerDependencies`.
It discovers a package's root `SKILL.md`, `skills/<name>/SKILL.md`, or
`dist/skills/<name>/SKILL.md` and links each skill into `.agents/skills/` and the
selected agent directories. The linked skill updates with the installed package.
Use `--copy` to copy files instead; copies require another sync after a package update.

The `.agents/skills/` directory is the shared location. Selecting Claude Code also
creates links under `.claude/skills/` pointing to the shared skills:

```bash
npx skills experimental_sync -a claude-code -y
```

Outside an agent, sync detects installed agents. When run inside a coding agent,
it targets that agent automatically unless you pass `-a` to select others.

Already downloaded remote skills are reused to create missing agent links without
fetching their source again. Packaged skills are relinked on every run.

To run sync after dependency installation, add a `prepare` script:

```json
{
  "scripts": {
    "prepare": "skills experimental_sync -y"
  }
}
```

The project and its dependencies can also declare a `skills` array in `package.json`:

```json
{
  "skills": ["npm:agent-browser", "vercel-labs/agent-skills@web-design-guidelines"]
}
```

An `npm:` entry references skills in an installed package. Other entries reference
Git sources and are fetched into the project. Pin a Git ref when you need reproducible
remote content. A package can publish this array as a shareable skill pack.
See the [field specification](https://github.com/antfu/skills-npm/blob/main/SPEC.md)
and [RFC](https://github.com/vercel-labs/skills/issues/2323) for the full proposal.

Sync tracks its skills in `skills-lock.json`, removes skills that are no longer
provided, and preserves skills installed separately with `skills add`.

| Option                    | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `-a, --agent <agents...>` | Select agent directories                                      |
| `-y, --yes`               | Skip confirmation prompts                                     |
| `--dry-run`               | Show the plan without installing or removing skills           |
| `--copy`                  | Copy packaged skills instead of linking them                  |
| `--no-cleanup`            | Keep skills that are no longer provided                       |
| `--no-remote`             | Skip installing and removing remote skills                    |
| `--include <patterns...>` | Include skills by package or `package#skill` pattern          |
| `--exclude <patterns...>` | Exclude skills by package or `package#skill` pattern          |
| `-r, --recursive`         | Also read dependencies of workspace packages                  |
| `--frozen-lockfile`       | Fail instead of changing `skills-lock.json` (default in CI)   |
| `--no-frozen-lockfile`    | Allow `skills-lock.json` to change in CI                      |

The include/exclude filters apply to both packaged and remote skills. For remote
skills, the package pattern matches the package declaring the entry (`.` for the
project's own field). Eve always receives copies because it rewrites skill frontmatter.

With `--frozen-lockfile`, sync installs only what `skills-lock.json` already records.
It exits with code 1 and changes nothing when a packaged skill is missing from the
lock, its content or package version differs, a locked skill is no longer provided
by any dependency, or a remote `skills` entry resolves to different content. This is
the default when a CI environment variable such as `CI` or `GITHUB_ACTIONS` is set;
pass `--no-frozen-lockfile` to update the lock from CI.

### Restore skills from the project lock file

```bash
npx skills experimental_install
```

Restore supported sources recorded in `skills-lock.json` into `.agents/skills/`.
Entries from npm packages are synced from the dependencies already on disk, so
install your npm dependencies before restoring. This command does not install
npm packages or create agent-specific links for restored skills.

| Option                 | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `--frozen-lockfile`    | Fail instead of changing `skills-lock.json` (default in CI) |
| `--no-frozen-lockfile` | Allow `skills-lock.json` to change in CI                    |

With `--frozen-lockfile`, every restored skill must match the content hash recorded
in `skills-lock.json`. A source whose skills differ is skipped entirely, the lock is
left untouched, and the command exits with code 1. A missing or empty lock is also
an error. This is the default in CI; pass `--no-frozen-lockfile` to refresh the lock
from CI instead.
