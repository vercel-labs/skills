```
███████╗██╗   ██╗███╗   ██╗██╗  ██╗
██╔════╝╚██╗ ██╔╝████╗  ██║██║ ██╔╝
███████╗ ╚████╔╝ ██╔██╗ ██║█████╔╝
╚════██║  ╚██╔╝  ██║╚██╗██║██╔═██╗
███████║   ██║   ██║ ╚████║██║  ██╗
╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝
```

The CLI for the open cognitive ecosystem for AI agents.

cognit is a fork/extension of the [skills](https://github.com/vercel-labs/skills) ecosystem that adds support for **cognitive types**: skills, agents, and prompts -- defined via `SKILL.md`, `AGENT.md`, and `PROMPT.md` files.

<!-- agent-list:start -->

Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [35 more](#available-agents).

<!-- agent-list:end -->

## Install a Cognitive

```bash
npx cognit add vercel-labs/agent-skills
```

### Source Formats

```bash
# GitHub shorthand (owner/repo)
npx cognit add vercel-labs/agent-skills

# Full GitHub URL
npx cognit add https://github.com/vercel-labs/agent-skills

# Direct path to a skill in a repo
npx cognit add https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines

# GitLab URL
npx cognit add https://gitlab.com/org/repo

# Any git URL
npx cognit add git@github.com:vercel-labs/agent-skills.git

# Local path
npx cognit add ./my-local-skills
```

### Options

| Option                    | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | Install to user directory instead of project                                                                                                       |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Available Agents](#available-agents)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | Install specific cognitives by name (use `'*'` for all)                                                                                            |
| `-t, --type <type>`       | Cognitive type: `skill` (default), `agent`, or `prompt`                                                                                            |
| `-l, --list`              | List available cognitives without installing                                                                                                       |
| `-y, --yes`               | Skip all confirmation prompts                                                                                                                      |
| `--all`                   | Install all cognitives to all agents without prompts                                                                                               |
| `--full-depth`            | Search all directories recursively for cognitives                                                                                                  |

### Examples

```bash
# List cognitives in a repository
npx cognit add vercel-labs/agent-skills --list

# Install specific cognitives
npx cognit add vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# Install a cognitive with spaces in the name (must be quoted)
npx cognit add owner/repo --skill "Convex Best Practices"

# Install to specific agents
npx cognit add vercel-labs/agent-skills -a claude-code -a opencode

# Non-interactive installation (CI/CD friendly)
npx cognit add vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# Install all cognitives from a repo to all agents
npx cognit add vercel-labs/agent-skills --all

# Install all cognitives to specific agents
npx cognit add vercel-labs/agent-skills --skill '*' -a claude-code

# Install specific cognitives to all agents
npx cognit add vercel-labs/agent-skills --agent '*' --skill frontend-design
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

| Command                   | Description                                            |
| ------------------------- | ------------------------------------------------------ |
| `npx cognit list`           | List installed cognitives (alias: `ls`)                |
| `npx cognit find [query]`   | Search for cognitives interactively or by keyword      |
| `npx cognit remove [names]` | Remove installed cognitives from agents                |
| `npx cognit check`          | Check for available cognitive updates                  |
| `npx cognit update`         | Update all installed cognitives to latest versions     |
| `npx cognit init [name]`    | Create a new SKILL.md, AGENT.md, or PROMPT.md template |

### `cognit list`

List all installed cognitives. Similar to `npm ls`.

```bash
# List all installed cognitives (project and global)
npx cognit list

# List only global cognitives
npx cognit ls -g

# Filter by specific agents
npx cognit ls -a claude-code -a cursor
```

### `cognit find`

Search for cognitives interactively or by keyword.

```bash
# Interactive search (fzf-style)
npx cognit find

# Search by keyword
npx cognit find typescript
```

### `cognit check` / `cognit update`

```bash
# Check if any installed cognitives have updates
npx cognit check

# Update all cognitives to latest versions
npx cognit update
```

### `cognit init`

```bash
# Create SKILL.md in current directory
npx cognit init

# Create a new skill in a subdirectory
npx cognit init my-skill

# Create an AGENT.md or PROMPT.md instead
npx cognit init my-agent -t agent
npx cognit init my-prompt -t prompt
```

### `cognit remove`

Remove installed cognitives from agents.

```bash
# Remove interactively (select from installed cognitives)
npx cognit remove

# Remove specific cognitive by name
npx cognit remove web-design-guidelines

# Remove multiple cognitives
npx cognit remove frontend-design web-design-guidelines

# Remove from global scope
npx cognit remove --global web-design-guidelines

# Remove from specific agents only
npx cognit remove --agent claude-code cursor my-skill

# Remove all installed cognitives without confirmation
npx cognit remove --all

# Remove all cognitives from a specific agent
npx cognit remove --skill '*' -a cursor

# Remove a specific cognitive from all agents
npx cognit remove my-skill --agent '*'

# Use 'rm' alias
npx cognit rm my-skill
```

| Option         | Description                                      |
| -------------- | ------------------------------------------------ |
| `-g, --global` | Remove from global scope (~/) instead of project |
| `-a, --agent`  | Remove from specific agents (use `'*'` for all)  |
| `-s, --skill`  | Specify cognitives to remove (use `'*'` for all) |
| `-y, --yes`    | Skip confirmation prompts                        |
| `--all`        | Shorthand for `--skill '*' --agent '*' -y`       |

## What are Cognitives?

Cognitives are reusable instruction sets that extend your coding agent's capabilities. cognit supports three cognitive types:

- **Skills** (`SKILL.md`) -- Task-oriented instructions that teach agents how to perform specific tasks
- **Agents** (`AGENT.md`) -- Persona and behavior definitions that shape how an agent operates
- **Prompts** (`PROMPT.md`) -- Reusable prompt templates for common workflows

Each cognitive is defined in its respective markdown file with YAML frontmatter containing a `name` and `description`.

Cognitives let agents perform specialized tasks like:

- Generating release notes from git history
- Creating PRs following your team's conventions
- Integrating with external tools (Linear, Notion, etc.)

Discover skills at **[skills.sh](https://skills.sh)** (compatible with cognit)

## Supported Agents

Cognitives can be installed to any of these agents:

<!-- supported-agents:start -->

| Agent                      | `--agent`                   | Project Path           | Global Path                     |
| -------------------------- | --------------------------- | ---------------------- | ------------------------------- |
| Amp, Kimi Code CLI, Replit | `amp`, `kimi-cli`, `replit` | `.agents/skills/`      | `~/.config/agents/skills/`      |
| Antigravity                | `antigravity`               | `.agent/skills/`       | `~/.gemini/antigravity/skills/` |
| Augment                    | `augment`                   | `.augment/skills/`     | `~/.augment/skills/`            |
| Claude Code                | `claude-code`               | `.claude/skills/`      | `~/.claude/skills/`             |
| OpenClaw                   | `openclaw`                  | `skills/`              | `~/.moltbot/skills/`            |
| Cline                      | `cline`                     | `.cline/skills/`       | `~/.cline/skills/`              |
| CodeBuddy                  | `codebuddy`                 | `.codebuddy/skills/`   | `~/.codebuddy/skills/`          |
| Codex                      | `codex`                     | `.agents/skills/`      | `~/.codex/skills/`              |
| Command Code               | `command-code`              | `.commandcode/skills/` | `~/.commandcode/skills/`        |
| Continue                   | `continue`                  | `.continue/skills/`    | `~/.continue/skills/`           |
| Crush                      | `crush`                     | `.crush/skills/`       | `~/.config/crush/skills/`       |
| Cursor                     | `cursor`                    | `.cursor/skills/`      | `~/.cursor/skills/`             |
| Droid                      | `droid`                     | `.factory/skills/`     | `~/.factory/skills/`            |
| Gemini CLI                 | `gemini-cli`                | `.agents/skills/`      | `~/.gemini/skills/`             |
| GitHub Copilot             | `github-copilot`            | `.agents/skills/`      | `~/.copilot/skills/`            |
| Goose                      | `goose`                     | `.goose/skills/`       | `~/.config/goose/skills/`       |
| Junie                      | `junie`                     | `.junie/skills/`       | `~/.junie/skills/`              |
| iFlow CLI                  | `iflow-cli`                 | `.iflow/skills/`       | `~/.iflow/skills/`              |
| Kilo Code                  | `kilo`                      | `.kilocode/skills/`    | `~/.kilocode/skills/`           |
| Kiro CLI                   | `kiro-cli`                  | `.kiro/skills/`        | `~/.kiro/skills/`               |
| Kode                       | `kode`                      | `.kode/skills/`        | `~/.kode/skills/`               |
| MCPJam                     | `mcpjam`                    | `.mcpjam/skills/`      | `~/.mcpjam/skills/`             |
| Mistral Vibe               | `mistral-vibe`              | `.vibe/skills/`        | `~/.vibe/skills/`               |
| Mux                        | `mux`                       | `.mux/skills/`         | `~/.mux/skills/`                |
| OpenCode                   | `opencode`                  | `.agents/skills/`      | `~/.config/opencode/skills/`    |
| OpenHands                  | `openhands`                 | `.openhands/skills/`   | `~/.openhands/skills/`          |
| Pi                         | `pi`                        | `.pi/skills/`          | `~/.pi/agent/skills/`           |
| Qoder                      | `qoder`                     | `.qoder/skills/`       | `~/.qoder/skills/`              |
| Qwen Code                  | `qwen-code`                 | `.qwen/skills/`        | `~/.qwen/skills/`               |
| Roo Code                   | `roo`                       | `.roo/skills/`         | `~/.roo/skills/`                |
| Trae                       | `trae`                      | `.trae/skills/`        | `~/.trae/skills/`               |
| Trae CN                    | `trae-cn`                   | `.trae/skills/`        | `~/.trae-cn/skills/`            |
| Windsurf                   | `windsurf`                  | `.windsurf/skills/`    | `~/.codeium/windsurf/skills/`   |
| Zencoder                   | `zencoder`                  | `.zencoder/skills/`    | `~/.zencoder/skills/`           |
| Neovate                    | `neovate`                   | `.neovate/skills/`     | `~/.neovate/skills/`            |
| Pochi                      | `pochi`                     | `.pochi/skills/`       | `~/.pochi/skills/`              |
| AdaL                       | `adal`                      | `.adal/skills/`        | `~/.adal/skills/`               |

<!-- supported-agents:end -->

> [!NOTE]
> **Kiro CLI users:** After installing skills, manually add them to your custom agent's `resources` in
> `.kiro/agents/<agent>.json`:
>
> ```json
> {
>   "resources": ["skill://.kiro/skills/**/SKILL.md"]
> }
> ```

The CLI automatically detects which coding agents you have installed. If none are detected, you'll be prompted to select
which agents to install to.

## Creating Cognitives

Cognitives are directories containing a `SKILL.md`, `AGENT.md`, or `PROMPT.md` file with YAML frontmatter:

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

- `metadata.internal`: Set to `true` to hide the cognitive from normal discovery. Internal cognitives are only visible and
  installable when `INSTALL_INTERNAL_SKILLS=1` is set. Useful for work-in-progress cognitives or those meant only for
  internal tooling.

```markdown
---
name: my-internal-skill
description: An internal skill not shown by default
metadata:
  internal: true
---
```

### Cognitive Discovery

The CLI searches for cognitives (`SKILL.md`, `AGENT.md`, `PROMPT.md`) in these locations within a repository:

<!-- skill-discovery:start -->

- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.agents/skills/`
- `.agent/skills/`
- `.augment/skills/`
- `.claude/skills/`
- `./skills/`
- `.cline/skills/`
- `.codebuddy/skills/`
- `.commandcode/skills/`
- `.continue/skills/`
- `.crush/skills/`
- `.cursor/skills/`
- `.factory/skills/`
- `.goose/skills/`
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
- `.roo/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zencoder/skills/`
- `.neovate/skills/`
- `.pochi/skills/`
- `.adal/skills/`
<!-- skill-discovery:end -->

### Plugin Manifest Discovery

If `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json` exists, cognitives declared in those files are also discovered:

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

If no cognitives are found in standard locations, a recursive search is performed. Use `--full-depth` to force a full recursive search.

## Compatibility

Cognitives are generally compatible across agents since they follow a
shared [Agent Skills specification](https://agentskills.io). However, some features may be agent-specific:

| Feature         | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | Clawdbot | Neovate | Pi  | Qoder | Zencoder |
| --------------- | -------- | --------- | ----------- | ----- | --------- | ----- | ------------ | -------- | ------ | ----------- | -------- | -------------- | --- | -------- | ------- | --- | ----- | -------- |
| Basic skills    | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | Yes      | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | Yes      |
| `allowed-tools` | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | No       | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | No       |
| `context: fork` | No       | No        | Yes         | No    | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |
| Hooks           | No       | No        | Yes         | Yes   | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |

## Troubleshooting

### "No cognitives found"

Ensure the repository contains valid `SKILL.md`, `AGENT.md`, or `PROMPT.md` files with both `name` and `description` in the frontmatter.

### Cognitive not loading in agent

- Verify the cognitive was installed to the correct path
- Check the agent's documentation for skill/cognitive loading requirements
- Ensure the frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Environment Variables

| Variable                  | Description                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` or `true` to show and install cognitives marked as `internal: true` |
| `DISABLE_TELEMETRY`       | Set to disable anonymous usage telemetry                                       |
| `DO_NOT_TRACK`            | Alternative way to disable telemetry                                           |

```bash
# Install internal cognitives
INSTALL_INTERNAL_SKILLS=1 npx cognit add vercel-labs/agent-skills --list
```

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

Telemetry is automatically disabled in CI environments.

## Related Links

> **Note:** cognit is a fork/extension of the [Vercel Agent Skills](https://github.com/vercel-labs/skills) ecosystem, adding support for multiple cognitive types (skills, agents, prompts). All skills-compatible repositories work with cognit.

- [Agent Skills Specification](https://agentskills.io)
- [Skills Directory](https://skills.sh)
- [Amp Skills Documentation](https://ampcode.com/manual#agent-skills)
- [Antigravity Skills Documentation](https://antigravity.google/docs/skills)
- [Factory AI / Droid Skills Documentation](https://docs.factory.ai/cli/configuration/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Clawdbot Skills Documentation](https://docs.clawd.bot/tools/skills)
- [Cline Skills Documentation](https://docs.cline.bot/features/skills)
- [CodeBuddy Skills Documentation](https://www.codebuddy.ai/docs/ide/Features/Skills)
- [Codex Skills Documentation](https://developers.openai.com/codex/skills)
- [Command Code Skills Documentation](https://commandcode.ai/docs/skills)
- [Crush Skills Documentation](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-skills)
- [Cursor Skills Documentation](https://cursor.com/docs/context/skills)
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

## License

MIT
