# agents

The CLI for the open agent distribution ecosystem.

<!-- agent-list:start -->
Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [38 more](#available-agents).
<!-- agent-list:end -->

## Install an Agent

```bash
npx agents add vercel-labs/agents
```

### Source Formats

```bash
# GitHub shorthand (owner/repo)
npx agents add vercel-labs/agents

# Full GitHub URL
npx agents add https://github.com/vercel-labs/agents

# Direct path to an agent in a repo
npx agents add https://github.com/vercel-labs/agents/tree/main/agents/web-design-guidelines

# GitLab URL
npx agents add https://gitlab.com/org/repo

# Any git URL
npx agents add git@github.com:vercel-labs/agents.git

# Local path
npx agents add ./my-local-agents
```

### Options

| Option                    | Description                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-g, --global`            | Install to user directory instead of project                                                                                                       |
| `-t, --target <targets...>` | <!-- agent-names:start -->Target specific targets (e.g., `claude-code`, `codex`). See [Available Targets](#available-targets)<!-- agent-names:end -->                  |
| `-a, --agent <agents...>` | Install specific agents by name (use `'*'` for all agents)                                                                                         |
| `-l, --list`              | List available agents without installing                                                                                                           |
| `--copy`                  | Copy files instead of symlinking to agent directories                                                                                              |
| `-y, --yes`               | Skip all confirmation prompts                                                                                                                      |
| `--all`                   | Install all agents to all agents without prompts                                                                                                   |

### Examples

```bash
# List agents in a repository
npx agents add vercel-labs/agents --list

# Install specific agents
npx agents add vercel-labs/agents --agent frontend-design --agent agent-creator

# Install an agent with spaces in the name (must be quoted)
npx agents add owner/repo --agent "Convex Best Practices"

# Install to specific targets
npx agents add vercel-labs/agents -t claude-code -t opencode

# Non-interactive installation (CI/CD friendly)
npx agents add vercel-labs/agents --agent frontend-design -g -t claude-code -y

# Install all agents from a repo to all targets
npx agents add vercel-labs/agents --all

# Install all agents to specific targets
npx agents add vercel-labs/agents --agent '*' -t claude-code

# Install specific agents to all targets
npx agents add vercel-labs/agents --target '*' --agent frontend-design
```

### Installation Scope

| Scope       | Flag      | Location            | Use Case                                      |
| ----------- | --------- | ------------------- | --------------------------------------------- |
| **Project** | (default) | `./<agent>/agents/` | Committed with your project, shared with team |
| **Global**  | `-g`      | `~/<agent>/agents/` | Available across all projects                 |

### Installation Methods

When installing interactively, you can choose:

| Method                    | Description                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| **Symlink** (Recommended) | Creates symlinks from each agent to a canonical copy. Single source of truth, easy updates. |
| **Copy**                  | Creates independent copies for each agent. Use when symlinks aren't supported.              |

## Other Commands

| Command                      | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `npx agents list`            | List installed agents (alias: `ls`)            |
| `npx agents find [query]`    | Search for agents interactively or by keyword  |
| `npx agents remove [agents]` | Remove installed agents from agents            |
| `npx agents check`           | Check for available agent updates              |
| `npx agents update`          | Update all installed agents to latest versions |
| `npx agents init [name]`     | Create a new AGENT.md template                 |

### `agents list`

List all installed agents. Similar to `npm ls`.

```bash
# List all installed agents (project and global)
npx agents list

# List only global agents
npx agents ls -g

# Filter by specific targets
npx agents ls -t claude-code -t cursor
```

### `agents find`

Search for agents interactively or by keyword.

```bash
# Interactive search (fzf-style)
npx agents find

# Search by keyword
npx agents find typescript
```

### `agents check` / `agents update`

```bash
# Check if any installed agents have updates
npx agents check

# Update all agents to latest versions
npx agents update
```

### `agents init`

```bash
# Create AGENT.md in current directory
npx agents init

# Create a new agent in a subdirectory
npx agents init my-agent
```

### `agents remove`

Remove installed agents from targets.

```bash
# Remove interactively (select from installed agents)
npx agents remove

# Remove specific agent by name
npx agents remove web-design-guidelines

# Remove multiple agents
npx agents remove frontend-design web-design-guidelines

# Remove from global scope
npx agents remove --global web-design-guidelines

# Remove from specific targets only
npx agents remove --target claude-code cursor my-agent

# Remove all installed agents without confirmation
npx agents remove --all

# Remove all agents from a specific target
npx agents remove --agent '*' -t cursor

# Remove a specific agent from all targets
npx agents remove my-agent --target '*'

# Use 'rm' alias
npx agents rm my-agent
```

| Option             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `-g, --global`     | Remove from global scope (~/) instead of project   |
| `-t, --target`     | Remove from specific targets (use `'*'` for all)   |
| `-a, --agent`      | Specify agents to remove (use `'*'` for all)       |
| `-y, --yes`        | Skip confirmation prompts                          |
| `--all`            | Shorthand for `--agent '*' --target '*' -y`        |

## What are Agents?

Agents are reusable instruction sets that extend your coding tool's capabilities. They're defined in `AGENT.md`
files with YAML frontmatter containing a `name` and `description`.

Agents let agents perform specialized tasks like:

- Generating release notes from git history
- Creating PRs following your team's conventions
- Integrating with external tools (Linear, Notion, etc.)

Discover agents at **[agents.sh](https://agents.sh)**

## Supported Targets

Agents can be installed to any of these targets:

<!-- supported-agents:start -->
| Target | `--target` | Project Path | Global Path |
|-------|-----------|--------------|-------------|
| Amp, Kimi Code CLI, Replit, Universal | `amp`, `kimi-cli`, `replit`, `universal` | `.agents/agents/` | `~/.config/agents/agents/` |
| Antigravity | `antigravity` | `.agent/agents/` | `~/.gemini/antigravity/agents/` |
| Augment | `augment` | `.augment/agents/` | `~/.augment/agents/` |
| Claude Code | `claude-code` | `.claude/agents/` | `~/.claude/agents/` |
| OpenClaw | `openclaw` | `agents/` | `~/.openclaw/agents/` |
| Cline, Warp | `cline`, `warp` | `.agents/agents/` | `~/.agents/agents/` |
| CodeBuddy | `codebuddy` | `.codebuddy/agents/` | `~/.codebuddy/agents/` |
| Codex | `codex` | `.agents/agents/` | `~/.codex/agents/` |
| Command Code | `command-code` | `.commandcode/agents/` | `~/.commandcode/agents/` |
| Continue | `continue` | `.continue/agents/` | `~/.continue/agents/` |
| Cortex Code | `cortex` | `.cortex/agents/` | `~/.snowflake/cortex/agents/` |
| Crush | `crush` | `.crush/agents/` | `~/.config/crush/agents/` |
| Cursor | `cursor` | `.agents/agents/` | `~/.cursor/agents/` |
| Droid | `droid` | `.factory/agents/` | `~/.factory/agents/` |
| Gemini CLI | `gemini-cli` | `.agents/agents/` | `~/.gemini/agents/` |
| GitHub Copilot | `github-copilot` | `.agents/agents/` | `~/.copilot/agents/` |
| Goose | `goose` | `.goose/agents/` | `~/.config/goose/agents/` |
| Junie | `junie` | `.junie/agents/` | `~/.junie/agents/` |
| iFlow CLI | `iflow-cli` | `.iflow/agents/` | `~/.iflow/agents/` |
| Kilo Code | `kilo` | `.kilocode/agents/` | `~/.kilocode/agents/` |
| Kiro CLI | `kiro-cli` | `.kiro/agents/` | `~/.kiro/agents/` |
| Kode | `kode` | `.kode/agents/` | `~/.kode/agents/` |
| MCPJam | `mcpjam` | `.mcpjam/agents/` | `~/.mcpjam/agents/` |
| Mistral Vibe | `mistral-vibe` | `.vibe/agents/` | `~/.vibe/agents/` |
| Mux | `mux` | `.mux/agents/` | `~/.mux/agents/` |
| OpenCode | `opencode` | `.agents/agents/` | `~/.config/opencode/agents/` |
| OpenHands | `openhands` | `.openhands/agents/` | `~/.openhands/agents/` |
| Pi | `pi` | `.pi/agents/` | `~/.pi/agent/agents/` |
| Qoder | `qoder` | `.qoder/agents/` | `~/.qoder/agents/` |
| Qwen Code | `qwen-code` | `.qwen/agents/` | `~/.qwen/agents/` |
| Roo Code | `roo` | `.roo/agents/` | `~/.roo/agents/` |
| Trae | `trae` | `.trae/agents/` | `~/.trae/agents/` |
| Trae CN | `trae-cn` | `.trae/agents/` | `~/.trae-cn/agents/` |
| Windsurf | `windsurf` | `.windsurf/agents/` | `~/.codeium/windsurf/agents/` |
| Zencoder | `zencoder` | `.zencoder/agents/` | `~/.zencoder/agents/` |
| Neovate | `neovate` | `.neovate/agents/` | `~/.neovate/agents/` |
| Pochi | `pochi` | `.pochi/agents/` | `~/.pochi/agents/` |
| AdaL | `adal` | `.adal/agents/` | `~/.adal/agents/` |
<!-- supported-agents:end -->

> [!NOTE]
> **Kiro CLI users:** After installing agents, manually add them to your custom agent's `resources` in
> `.kiro/agents/<agent>.json`:
>
> ```json
> {
>   "resources": ["agent://.kiro/agents/**/AGENT.md"]
> }
> ```

The CLI automatically detects which coding agents you have installed. If none are detected, you'll be prompted to select
which agents to install to.

## Creating Agents

Agents are directories containing a `AGENT.md` file with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does and when to use it
---

# My Agent

Instructions for the agent to follow when this agent is activated.

## When to Use

Describe the scenarios where this agent should be used.

## Steps

1. First, do this
2. Then, do that
```

### Required Fields

- `name`: Unique identifier (lowercase, hyphens allowed)
- `description`: Brief explanation of what the agent does

### Optional Fields

- `metadata.internal`: Set to `true` to hide the agent from normal discovery. Internal agents are only visible and
  installable when `INSTALL_INTERNAL_AGENTS=1` is set. Useful for work-in-progress agents or agents meant only for
  internal tooling.

```markdown
---
name: my-internal-agent
description: An internal agent not shown by default
metadata:
  internal: true
---
```

### Agent Discovery

The CLI searches for agents in these locations within a repository:

<!-- agent-discovery:start -->
- Root directory (if it contains `AGENT.md`)
- `agents/`
- `agents/.curated/`
- `agents/.experimental/`
- `agents/.system/`
- `.agents/agents/`
- `.agent/agents/`
- `.augment/agents/`
- `.claude/agents/`
- `./agents/`
- `.codebuddy/agents/`
- `.commandcode/agents/`
- `.continue/agents/`
- `.cortex/agents/`
- `.crush/agents/`
- `.factory/agents/`
- `.goose/agents/`
- `.junie/agents/`
- `.iflow/agents/`
- `.kilocode/agents/`
- `.kiro/agents/`
- `.kode/agents/`
- `.mcpjam/agents/`
- `.vibe/agents/`
- `.mux/agents/`
- `.openhands/agents/`
- `.pi/agents/`
- `.qoder/agents/`
- `.qwen/agents/`
- `.roo/agents/`
- `.trae/agents/`
- `.windsurf/agents/`
- `.zencoder/agents/`
- `.neovate/agents/`
- `.pochi/agents/`
- `.adal/agents/`
<!-- agent-discovery:end -->

### Plugin Manifest Discovery

If `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json` exists, agents declared in those files are also discovered:

```json
// .claude-plugin/marketplace.json
{
  "metadata": { "pluginRoot": "./plugins" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "my-plugin",
      "agents": ["./agents/review", "./agents/test"]
    }
  ]
}
```

This enables compatibility with the [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) ecosystem.

If no agents are found in standard locations, a recursive search is performed.

## Compatibility

Agents are generally compatible across agents since they follow a
shared [Agent Agents specification](https://agentagents.io). However, some features may be agent-specific:

| Feature         | OpenCode | OpenHands | Claude Code | Cline | CodeBuddy | Codex | Command Code | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | OpenClaw | Neovate | Pi  | Qoder | Zencoder |
| --------------- | -------- | --------- | ----------- | ----- | --------- | ----- | ------------ | -------- | ------ | ----------- | -------- | -------------- | --- | -------- | ------- | --- | ----- | -------- |
| Basic agents    | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | Yes      | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | Yes      |
| `allowed-tools` | Yes      | Yes       | Yes         | Yes   | Yes       | Yes   | Yes          | No       | Yes    | Yes         | Yes      | Yes            | Yes | Yes      | Yes     | Yes | Yes   | No       |
| `context: fork` | No       | No        | Yes         | No    | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |
| Hooks           | No       | No        | Yes         | Yes   | No        | No    | No           | No       | No     | No          | No       | No             | No  | No       | No      | No  | No    | No       |

## Troubleshooting

### "No agents found"

Ensure the repository contains valid `AGENT.md` files with both `name` and `description` in the frontmatter.

### Agent not loading in agent

- Verify the agent was installed to the correct path
- Check the agent's documentation for agent loading requirements
- Ensure the `AGENT.md` frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Environment Variables

| Variable                  | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `INSTALL_INTERNAL_AGENTS` | Set to `1` or `true` to show and install agents marked as `internal: true` |
| `DISABLE_TELEMETRY`       | Set to disable anonymous usage telemetry                                   |
| `DO_NOT_TRACK`            | Alternative way to disable telemetry                                       |

```bash
# Install internal agents
INSTALL_INTERNAL_AGENTS=1 npx agents add vercel-labs/agents --list
```

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

Telemetry is automatically disabled in CI environments.

## Related Links

- [Agent Agents Specification](https://agentagents.io)
- [Agents Directory](https://agents.sh)
- [Amp Agents Documentation](https://ampcode.com/manual#agent-agents)
- [Antigravity Agents Documentation](https://antigravity.google/docs/agents)
- [Factory AI / Droid Agents Documentation](https://docs.factory.ai/cli/configuration/agents)
- [Claude Code Agents Documentation](https://code.claude.com/docs/en/agents)
- [OpenClaw Agents Documentation](https://docs.openclaw.ai/tools/agents)
- [Cline Agents Documentation](https://docs.cline.bot/features/agents)
- [CodeBuddy Agents Documentation](https://www.codebuddy.ai/docs/ide/Features/Agents)
- [Codex Agents Documentation](https://developers.openai.com/codex/agents)
- [Command Code Agents Documentation](https://commandcode.ai/docs/agents)
- [Crush Agents Documentation](https://github.com/charmbracelet/crush?tab=readme-ov-file#agent-agents)
- [Cursor Agents Documentation](https://cursor.com/docs/context/agents)
- [Gemini CLI Agents Documentation](https://geminicli.com/docs/cli/agents/)
- [GitHub Copilot Agent Agents](https://docs.github.com/en/copilot/concepts/agents/about-agent-agents)
- [iFlow CLI Agents Documentation](https://platform.iflow.cn/en/cli/examples/agent)
- [Kimi Code CLI Agents Documentation](https://moonshotai.github.io/kimi-cli/en/customization/agents.html)
- [Kiro CLI Agents Documentation](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#agent-resources)
- [Kode Agents Documentation](https://github.com/shareAI-lab/kode/blob/main/docs/agents.md)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents)
- [Qwen Code Agents Documentation](https://qwenlm.github.io/qwen-code-docs/en/users/features/agents/)
- [OpenHands Agents Documentation](https://docs.openhands.ai/modules/usage/how-to/using-agents)
- [Pi Agents Documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/agents.md)
- [Qoder Agents Documentation](https://docs.qoder.com/cli/Agents)
- [Replit Agents Documentation](https://docs.replit.com/replitai/agents)
- [Roo Code Agents Documentation](https://docs.roocode.com/features/agents)
- [Trae Agents Documentation](https://docs.trae.ai/ide/agents)
- [Vercel Agent Agents Repository](https://github.com/vercel-labs/agents)

## License

MIT
