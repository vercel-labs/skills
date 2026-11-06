# Creating skills

[Back to the README](../README.md)

Create a template with `npx skills init my-skill`, then edit its `SKILL.md`.

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

The CLI searches for skills in these locations within a repository. Each
skill container directory is walked up to three levels deep, covering flat
layouts (`skills/<name>/SKILL.md`) and catalog layouts with one or two category
levels (`skills/<category>/<name>/SKILL.md` or
`skills/<category>/<category>/<name>/SKILL.md`). A `SKILL.md` discovered at a
shallower level shadows anything nested below it. Use `--full-depth` to also
discover `SKILL.md` files outside these container directories (e.g. under
`examples/` or `tests/`).

<!-- skill-discovery:start -->
- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.aider-desk/skills/`
- `.agents/skills/`
- `data/skills/`
- `.autohand/skills/`
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
- `agent/skills/`
- `.forge/skills/`
- `.goose/skills/`
- `.grok/skills/`
- `.hermes/skills/`
- `.inferencesh/skills/`
- `.jazz/skills/`
- `.junie/skills/`
- `.iflow/skills/`
- `.kimchi/skills/`
- `.kiro/skills/`
- `.kode/skills/`
- `.lingma/skills/`
- `.mcpjam/skills/`
- `.minimax/skills/`
- `.vibe/skills/`
- `.moxby/skills/`
- `.mux/skills/`
- `.openhands/skills/`
- `.ona/skills/`
- `.posit/assistant/skills/`
- `.qoder/skills/`
- `.qwen/skills/`
- `.reasonix/skills/`
- `.rovodev/skills/`
- `.roo/skills/`
- `.tabnine/agent/skills/`
- `.terramind/skills/`
- `.tinycloud/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.zcode/skills/`
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

This enables compatibility with the [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) ecosystem. Skill paths declared in a manifest are searched at their declared depth and are not subject to the bounded depth-3 catalog walk described above.

### Custom Discovery Paths

If your skills live somewhere else, list those directories in the `paths` field of a `skills.sh.json` file at the repository root:

```json
{
  "$schema": "https://skills.sh/schemas/skills.sh.schema.json",
  "paths": ["./tools/skills"]
}
```

Each entry is a container directory. Its subdirectories are searched the same way as `skills/`, up to three levels deep. Entries must start with `./` and point to a subdirectory of the repository; any other entries, including the repository root itself, are ignored. The CLI searches these directories along with the standard locations above. If two skills have the same name, only the first one found is kept.

If no skills are found in standard locations, a recursive search is performed.
