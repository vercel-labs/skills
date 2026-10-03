# Interoperability (2026)

How SkillCodex `SKILL.md` maps to common agent surfaces. The ecosystem is **converging** but not identical yet.

## Portable core (works almost everywhere)

| Field / section | Purpose |
|-----------------|---------|
| YAML `name`, `description`, `tags` | Discovery and routing |
| `# Instructions` | Main agent behavior |
| `outcomes` | Success criteria |
| `references/` paths | Token-efficient deep rules |

Any host that loads markdown instructions can use the GitHub tree:

`https://github.com/bh611627/skills/tree/main/skills/<name>/SKILL.md`

## Host-specific notes

| Host | How users typically install | SkillCodex fit |
|------|----------------------------|----------------|
| **Generic / custom** | Copy `SKILL.md` into agent config | Full file or `skillMd` from npm |
| **[skills.sh](https://www.skills.sh/)** | `npx skills add owner/repo` | Compatible layout; e.g. `npx skills add bh611627/skills --skill web-design-guidelines` |
| **Cursor** | Project skills under `.cursor/skills` or rules | Copy skill folder or import `instructions` field |
| **Claude Code** | `SKILL.md` with progressive disclosure | Frontmatter + body; use `references/` for lazy load |
| **Antigravity / Codex / Copilot / Windsurf / Gemini CLI / Cline / Amp / OpenCode / Roo / Goose / Kilo / Kiro / Droid / OpenClaw / Trae** | Agent-specific skills dirs via `npx skills add` | Same markdown; declare hosts in `compatibility` |
| **npm consumers** | `npm install @skillcodex/skills` | Typed `SkillModule` in [package/src/types.ts](../package/src/types.ts) |

## Frontmatter: `compatibility`

Declare where the skill was reviewed (canonical SkillCodex set):

```yaml
compatibility:
  - generic-markdown
  - skills-sh
  - cursor
  - claude-code
  - antigravity
  - codex
  - github-copilot
  - windsurf
  - gemini-cli
  - cline
  - amp
  - opencode
  - roo
  - goose
  - kilo
  - kiro-cli
  - droid
  - openclaw
  - trae
```

Hosts may ignore unknown keys - that is expected in 2026.

## Security model by host (you must verify)

SkillCodex documents **intent** (`risk_level`, `tools_allowed`). **Enforcement** is always the host:

- Sandboxing
- Tool allowlists
- User approval for shell/network
- Secret scanning

Do not assume another registry’s badge equals your host’s guarantees.

## Versioning across surfaces

| Strategy | When |
|----------|------|
| Git tag / commit SHA | Reproducible audits |
| npm semver | Programmatic apps |
| `last_reviewed` date | Human maintenance signal |

Pin one source of truth: **GitHub markdown** for policy, npm for compiled mirrors.
