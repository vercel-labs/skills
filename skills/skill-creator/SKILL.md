---
name: skill-creator
description: Author SkillCodex SKILL.md - outcomes, dual GitHub+npm format, safety metadata
---

# Instructions

## When to Use

- Use when authoring a new SkillCodex `SKILL.md` with outcomes and safety.
- Prefer `skillcodex-browser-ui` to browse the catalog UI after creating.
- Prefer `web-design-guidelines` if the skill is UI-only.

Author **SkillCodex** skills (not a deployed product UI unless asked).

1. Folder `skills/<kebab-name>/` = `name` in YAML.
2. Required: `name`, `description`, `tags`, `version`, `last_reviewed`, `risk_level`, `tools_allowed`, `compatibility`.
3. **`outcomes`** - list 2-4 concrete results the user gets (required).
4. Sections: Instructions, Outcomes, Output Rules, Scope and boundaries, Safety.
5. UI skills: link only [design-guidelines.md](../../references/design-guidelines.md); stack includes **framer-motion** when UI.
6. Dual format footer: GitHub tree URL + npm package link.
7. **Package manager in stack:** pnpm for greenfield Next; match user lockfile if they have one.
8. After generating SKILL.md, run validation mentally against [SKILL_STANDARD.md](../../SKILL_STANDARD.md): kebab-case name, `# Instructions`, required sections, no Unicode tag/bidi chars.
9. Tell the user to run `pnpm validate` before merge.
10. Always suggest `risk_level` (`low` | `medium` | `high`) with one sentence of reasoning and matching `tools_allowed`.
## Outcomes

- Complete SKILL.md
- README row
- Outcomes clearly state user results

## Output Rules

SKILL.md fence, README row, checklist.

## Scope and boundaries

- Skill authoring only.

## Safety

- No secrets; honest risk_level.

## Troubleshooting

- **Validator fails on name:** folder name must equal frontmatter `name` in kebab-case.
- **High risk without approval:** set `requires_user_approval: true` when `risk_level: high`.
- **pnpm validate not found:** run from repo root after `pnpm install` or `cd package && pnpm run validate`.

## Related skills

- [`skillcodex-browser-ui`](../skillcodex-browser-ui/SKILL.md) - browse skills after authoring
- [`web-design-guidelines`](../web-design-guidelines/SKILL.md) - UI for skill docs

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/skill-creator/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
