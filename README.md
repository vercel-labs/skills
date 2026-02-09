# secure-skills

A security-hardened fork of the [skills](https://github.com/vercel-labs/skills) CLI that scans agent skills for
malicious content before installation.

The open agent skills ecosystem makes it trivial to install third-party instruction sets into coding agents — but that
same ease of installation is a vector for prompt injection, data exfiltration, and credential theft.
[Snyk's analysis](https://snyk.io/blog/) of 3,984 published skills found that **13.4% had critical security issues** and
76 were confirmed malicious. Separately,
[Koi's ClawHavoc investigation](https://www.koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting)
uncovered **341 malicious ClawedBot skills** using techniques like AMOS stealer droppers, password-protected archives,
base64-encoded payloads, macOS quarantine bypasses (`xattr -c`), and reverse shells. `skillsio` adds an automated
security gate so you can still move fast without running untrusted code.

## What It Does

Every `skillsio add` command runs a local security scan **before** anything is installed. The scanner applies ~52 regex
rules derived from the Snyk and ClawHavoc research, organized into 8 threat categories:

| Category | What it catches |
| --- | --- |
| **Exfiltration** | Sending files/env vars to external endpoints, webhook URLs |
| **Prompt injection** | "Ignore previous instructions", role hijacking, instruction overrides |
| **Dangerous filesystem** | `rm -rf`, mass deletion, wiping home directories |
| **Credential access** | Reading SSH keys, AWS credentials, `.env` files, keychains |
| **Suspicious directives** | "Never ask for confirmation", "silently execute", stealth instructions |
| **Downloads / RCE** | `curl \| sh`, downloading and executing remote scripts |
| **Obfuscation** | Base64-encoded commands, Unicode escape sequences, hex-encoded strings |
| **Reverse shells / services** | Netcat listeners, cron persistence, systemd/launchd service creation |

Findings are categorized by severity:

- **Critical** / **High** — always prompts for confirmation (critical prompts even with `--yes`)
- **Medium** and below — noted and auto-continued

### URL Transparency

The scanner extracts all external URLs found in skill files and displays them before installation. Even if the local scan
is clean, skills that reference external URLs will prompt you to review them before proceeding. This catches deceptive
domain patterns that regex rules can't — letting you eyeball where a skill wants to send traffic.

```
◆  External URLs found in skill files (2):
│  https://example.com/setup
│  https://hooks.slack.com/services/T00/B00/xxx
│
◆  This skill references external URLs. Continue with installation?
```

With `--yes`, URL-only prompts are auto-continued. Skills with high/critical findings always show URLs alongside the
findings summary.

### Optional: VirusTotal Integration

When a [VirusTotal](https://www.virustotal.com/) API key is provided, the CLI also hashes each skill's content
(SHA-256) and checks it against VT's database. If the file has been seen before, VT's verdict is displayed alongside
local findings — including engine detection counts and Gemini-powered Code Insight analysis.

```
◆ VirusTotal: ✗ malicious (14/72 engines)
   Code Insight: Downloads and executes external binary...
   https://www.virustotal.com/gui/file/{hash}

◆ VirusTotal: ✓ clean (0/72 engines)

◆ VirusTotal: not found (local scan only)
```

A VT malicious verdict escalates the scan to critical severity regardless of local findings.

VT is purely additive — no key means no VT calls, and VT errors (rate limits, network issues) are handled gracefully
without blocking installation.

```bash
# Via CLI flag
npx skillsio add owner/repo --vt-key YOUR_API_KEY

# Via environment variable
VT_API_KEY=YOUR_API_KEY npx skillsio add owner/repo
```

`--vt-key` flag takes precedence over `VT_API_KEY` env var.

### External Rules

You can extend the built-in scanner with your own rules using the `--rules` flag. This is useful for enforcing
organization-specific policies — for example, blocking references to internal infrastructure or flagging deprecated
tools.

Rules are defined in JSON files with a simple format:

```json
{
  "rules": [
    {
      "id": "no-internal-api",
      "severity": "critical",
      "description": "References internal API — may leak infrastructure details",
      "pattern": "https?://internal\\.company\\.com",
      "flags": "i"
    },
    {
      "id": "no-sudo",
      "severity": "high",
      "description": "Skill should not require sudo access",
      "pattern": "\\bsudo\\s+"
    }
  ]
}
```

Each rule requires `id`, `severity` (`critical`/`high`/`medium`/`low`/`info`), `description`, and `pattern` (a regex
string). The optional `flags` field defaults to `"i"` (case-insensitive).

```bash
# Load rules from a single file
npx skillsio add owner/repo --rules ./my-rules.json

# Load all .json rule files from a directory
npx skillsio add owner/repo --rules ./rules/
```

External rules are applied **in addition to** the built-in ~52 rules — they never replace them. Findings from external
rules follow the same severity-based prompt flow as built-in findings.

See [docs/EXTERNAL-RULES.md](docs/EXTERNAL-RULES.md) for the full format reference, more examples, and tips for writing
rules.

## Quick Start

```bash
# Install a skill (scanned automatically)
npx skillsio add vercel-labs/agent-skills

# Skip the scan if you trust the source
npx skillsio add vercel-labs/agent-skills --skip-scan

# Scan with VirusTotal threat intelligence
VT_API_KEY=xxx npx skillsio add owner/repo

# Scan with custom organization rules
npx skillsio add owner/repo --rules ./company-rules.json
```

## CLI Reference

### `add <source>`

Install skills from GitHub, GitLab, git URLs, direct URLs, or local paths.

```bash
npx skillsio add vercel-labs/agent-skills           # GitHub shorthand
npx skillsio add https://github.com/org/repo        # Full URL
npx skillsio add git@github.com:org/repo.git        # Git URL
npx skillsio add ./my-local-skills                   # Local path
```

| Option | Description |
| --- | --- |
| `-g, --global` | Install to user directory instead of project |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Supported Agents](#supported-agents)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | Install specific skills by name (use `'*'` for all) |
| `-l, --list` | List available skills without installing |
| `-y, --yes` | Skip confirmation prompts |
| `--all` | Install all skills to all agents without prompts |
| `--skip-scan` | Skip the security scan before installation |
| `--rules <path>` | Load additional scan rules from a JSON file or directory (see [External Rules](#external-rules)) |
| `--vt-key <key>` | VirusTotal API key for additional threat intelligence |
| `--full-depth` | Search all subdirectories even when a root SKILL.md exists |

### Other Commands

| Command | Description |
| --- | --- |
| `list` (alias: `ls`) | List installed skills |
| `find [query]` | Search for skills interactively or by keyword |
| `remove [skills]` (alias: `rm`) | Remove installed skills from agents |
| `check` | Check for available skill updates |
| `update` | Update all installed skills to latest versions |
| `init [name]` | Create a new SKILL.md template |

### Installation Scope

| Scope | Flag | Location | Use Case |
| --- | --- | --- | --- |
| **Project** | (default) | `./<agent>/skills/` | Committed with your project |
| **Global** | `-g` | `~/<agent>/skills/` | Available across all projects |

## Supported Agents

<!-- agent-list:start -->
Supports **OpenCode**, **Claude Code**, **Codex**, **Cursor**, and [35 more](#supported-agents).
<!-- agent-list:end -->

<!-- supported-agents:start -->
| Agent | `--agent` | Project Path | Global Path |
|-------|-----------|--------------|-------------|
| Amp, Kimi Code CLI, Replit | `amp`, `kimi-cli`, `replit` | `.agents/skills/` | `~/.config/agents/skills/` |
| Antigravity | `antigravity` | `.agent/skills/` | `~/.gemini/antigravity/skills/` |
| Augment | `augment` | `.augment/skills/` | `~/.augment/skills/` |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| OpenClaw | `openclaw` | `skills/` | `~/.moltbot/skills/` |
| Cline | `cline` | `.cline/skills/` | `~/.cline/skills/` |
| CodeBuddy | `codebuddy` | `.codebuddy/skills/` | `~/.codebuddy/skills/` |
| Codex | `codex` | `.agents/skills/` | `~/.codex/skills/` |
| Command Code | `command-code` | `.commandcode/skills/` | `~/.commandcode/skills/` |
| Continue | `continue` | `.continue/skills/` | `~/.continue/skills/` |
| Crush | `crush` | `.crush/skills/` | `~/.config/crush/skills/` |
| Cursor | `cursor` | `.cursor/skills/` | `~/.cursor/skills/` |
| Droid | `droid` | `.factory/skills/` | `~/.factory/skills/` |
| Gemini CLI | `gemini-cli` | `.agents/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.agents/skills/` | `~/.copilot/skills/` |
| Goose | `goose` | `.goose/skills/` | `~/.config/goose/skills/` |
| Junie | `junie` | `.junie/skills/` | `~/.junie/skills/` |
| iFlow CLI | `iflow-cli` | `.iflow/skills/` | `~/.iflow/skills/` |
| Kilo Code | `kilo` | `.kilocode/skills/` | `~/.kilocode/skills/` |
| Kiro CLI | `kiro-cli` | `.kiro/skills/` | `~/.kiro/skills/` |
| Kode | `kode` | `.kode/skills/` | `~/.kode/skills/` |
| MCPJam | `mcpjam` | `.mcpjam/skills/` | `~/.mcpjam/skills/` |
| Mistral Vibe | `mistral-vibe` | `.vibe/skills/` | `~/.vibe/skills/` |
| Mux | `mux` | `.mux/skills/` | `~/.mux/skills/` |
| OpenCode | `opencode` | `.agents/skills/` | `~/.config/opencode/skills/` |
| OpenHands | `openhands` | `.openhands/skills/` | `~/.openhands/skills/` |
| Pi | `pi` | `.pi/skills/` | `~/.pi/agent/skills/` |
| Qoder | `qoder` | `.qoder/skills/` | `~/.qoder/skills/` |
| Qwen Code | `qwen-code` | `.qwen/skills/` | `~/.qwen/skills/` |
| Roo Code | `roo` | `.roo/skills/` | `~/.roo/skills/` |
| Trae | `trae` | `.trae/skills/` | `~/.trae/skills/` |
| Trae CN | `trae-cn` | `.trae/skills/` | `~/.trae-cn/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| Zencoder | `zencoder` | `.zencoder/skills/` | `~/.zencoder/skills/` |
| Neovate | `neovate` | `.neovate/skills/` | `~/.neovate/skills/` |
| Pochi | `pochi` | `.pochi/skills/` | `~/.pochi/skills/` |
| AdaL | `adal` | `.adal/skills/` | `~/.adal/skills/` |
<!-- supported-agents:end -->

The CLI automatically detects which coding agents you have installed.

## Environment Variables

| Variable | Description |
| --- | --- |
| `VT_API_KEY` | VirusTotal API key for optional threat intelligence during security scans |
| `INSTALL_INTERNAL_SKILLS` | Set to `1` to show and install skills marked as `internal: true` |
| `DISABLE_TELEMETRY` | Disable anonymous usage telemetry |
| `DO_NOT_TRACK` | Alternative way to disable telemetry |

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build
pnpm dev <cmd>        # Run CLI in dev mode (e.g., pnpm dev add owner/repo)
pnpm test             # Run all tests
pnpm type-check       # TypeScript type checking
pnpm format           # Format code with Prettier
```

### Scanner Architecture

- `src/scanner.ts` — Rules engine. Defines ~52 regex rules across 8 threat categories, runs them against all skill
  files (.md, .txt, .yaml, .json, .sh, .py, .js, .ts, .ps1, .bat, .cmd). Supports loading external rules from JSON
  files via `--rules`.
- `src/scanner-ui.ts` — Presentation layer. Displays findings by severity, runs optional VT lookups, handles
  escalation logic and user confirmation prompts.
- `src/vt.ts` — VirusTotal API client. SHA-256 hashing, `GET /api/v3/files/{hash}` lookup, verdict mapping, graceful
  error handling.
- `src/add.ts` — Integration point. The scanner is wired into all 4 install paths (GitHub/git repos, remote providers,
  well-known endpoints, legacy Mintlify).

## Changelog

### 1.1.0

- Added `--rules <path>` flag to load external scan rules from JSON files or directories
- External rules are applied alongside built-in rules, supporting organization-specific policies
- See [docs/EXTERNAL-RULES.md](docs/EXTERNAL-RULES.md) for format documentation and examples

### 1.0.1

- Critical security prompts now default to **No** — users must explicitly confirm to install skills flagged as malicious

### 1.0.0

- Initial release with ~52 regex security rules across 8 threat categories
- VirusTotal integration for optional secondary threat intelligence
- URL transparency: all external URLs in skill files are shown before installation
- Scanner rules informed by Snyk and ClawHavoc research

## Acknowledgments

This project is a fork of [skills](https://github.com/vercel-labs/skills) by
[Vercel Labs](https://github.com/vercel-labs). All upstream CLI functionality — skill discovery, installation, agent
support, update checking — comes from the original project. The security scanning layer, VirusTotal integration, and
related tests are additions by this fork.

## License

MIT
