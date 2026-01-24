---
name: skills-cli
description: Install and manage AI agent skills using the skills CLI. Use when the user asks to (1) install skills from GitHub, URLs, or local paths, (2) search or discover skills on skills.sh, (3) create new skills, (4) check for or apply skill updates. Triggers on requests involving skill installation, discovery, creation, or management.
---

# Skills CLI

Command-line tool for installing and managing AI agent skills.

## Commands

| Command | Description |
|---------|-------------|
| `npx skills add <source>` | Install skills |
| `npx skills find [query]` | Search skills on skills.sh |
| `npx skills init [name]` | Create a new skill |
| `npx skills check` | Check for updates |
| `npx skills update` | Update all skills |

## Installing Skills

### Source Formats

```bash
npx skills add owner/repo                    # GitHub shorthand
npx skills add owner/repo/skills/my-skill    # Specific skill in repo
npx skills add https://github.com/owner/repo # Full GitHub URL
npx skills add ./local/path                  # Local directory
npx skills add https://docs.example.com/skill.md  # Direct URL
```

### Options

| Option | Description |
|--------|-------------|
| `-g, --global` | Install globally (~/.agent/skills/) instead of project-level |
| `-y, --yes` | Skip prompts, accept defaults |
| `-a, --agent <name>` | Target specific agent(s): claude-code, cursor, cline, windsurf, etc. |
| `-s, --skill <name>` | Install specific skill(s) from a multi-skill repo |
| `-l, --list` | List available skills without installing |
| `--all` | Install all skills globally without prompts |

### Examples

```bash
npx skills add vercel-labs/agent-skills -g -y
npx skills add vercel-labs/agent-skills --skill react -a claude-code
npx skills add ./my-skill -g
```

## Searching Skills

Browse and install skills from [skills.sh](https://skills.sh):

```bash
npx skills find              # Interactive search
npx skills find typescript   # Search with query
```

Select a skill to install it directly.

## Creating Skills

```bash
npx skills init my-skill     # Creates my-skill/SKILL.md
npx skills init              # Creates SKILL.md in current directory
```

### SKILL.md Structure

```markdown
---
name: my-skill
description: Brief description of what this skill does
---

# My Skill

Instructions for the agent.
```

## Managing Updates

```bash
npx skills check    # Show available updates
npx skills update   # Update all installed skills
```

## Supported Agents

claude-code, cursor, cline, windsurf, copilot, goose, aider, roo-code, pear-ai, trae, melty, void, aide, codex-cli, sourcegraph, continue, zed, amp, opencode, gemini-cli, claude-squad, qwen-code, openhands