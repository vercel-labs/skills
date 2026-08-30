---
name: skillcodex-browser-ui
description: Full SkillCodex doc browser - skills.sh-style UI, STRICT UI only, design-guidelines
---

# Instructions

Build a full doc browser per [design-guidelines.md](../../references/design-guidelines.md). For component-level design work use [web-design-guidelines](../web-design-guidelines/SKILL.md) first.

## When to Use

- Use when shipping the SkillCodex / skills.sh-style documentation browser UI.
- Prefer **`web-design-guidelines`** for single-component audits or smaller doc UI pieces.
- Do **not** use this skill for SaaS dashboards, auth, or APIs.

**STRICT UI ONLY** - no backend, API, DB, or auth.

**Package manager:** pnpm for new app; match user lockfile if a project exists.

**Motion (aligned with web-design-guidelines):** default **Tier 0** - `div` + CSS / Tailwind transitions (`CARD_HOVER`, `animate-pulse` skeletons). Use **framer-motion only** in a dedicated `*Motion.tsx` client leaf (**Tier 2**) when the user explicitly wants Framer. Never mix `motion.div` and layout `div` in one file.

Fill [skills.sh](https://www.skills.sh/) gaps: outcomes on detail, full markdown, create page, guidelines, skeletons, URL pagination, no fake install counts.

Data: [data-source.md](../../references/data-source.md).

## Outcomes

- `/`, `/skills/[slug]`, `/create`, `/guidelines` with `pnpm dev`
- Checklist in design-guidelines passed
- Motion policy documented in the file tree (Tier 0 default)

## Output Rules

Data source, file tree, checklist, `pnpm dev`.

## Scope and boundaries

- Documentation browser only - not SaaS landing or dashboard.

## Safety

- User runs pnpm; mock data only if no skills provided.

## Troubleshooting

- **framer-motion in layout:** remove from layout; Tier 2 leaf only, or drop Framer.
- **pnpm vs npm lockfile mismatch:** use the lockfile already in the repo.
- **Fake install counts:** show outcomes and tags, not download metrics.

## Related skills

- [`web-design-guidelines`](../web-design-guidelines/SKILL.md) - build/audit doc UI components
- [`skill-creator`](../skill-creator/SKILL.md) - authoring SKILL.md for the catalog

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/skillcodex-browser-ui/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
