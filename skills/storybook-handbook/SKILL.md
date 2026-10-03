---
name: storybook-handbook
description: Storybook 8 for React TypeScript - CSF3 stories a11y addon and docs aligned with design-guidelines
---

# Instructions

## When to Use

- Use for Storybook 8 CSF3, a11y addon, docs for React TS.
- Prefer `web-design-guidelines` for design-token/motion rules.
- Prefer `accessibility-audit` for full-app WCAG beyond stories.

Set up or improve **Storybook 8** for a **React + TypeScript** design system or app (often with **Next.js** in monorepo).

1. **Builder:** prefer **Vite** (`@storybook/react-vite`) for speed unless Webpack required for Next-specific loaders - match official Storybook + Next docs for the user’s versions.
2. **CSF3:** default export meta + named exports; `args` for props; **typed** with `satisfies Meta<typeof Component>`.
3. **Decorators:** global theme (CSS variables from **`web-design-guidelines`** / Tailwind), i18n provider if needed.
4. **Addons:** **`@storybook/addon-a11y`** enabled; fix **serious** violations before merge policy.
5. **Docs:** autodocs for public props; MDX for usage guidelines when components need narrative.
6. **Monorepo:** `transpilePackages` / vite alias to local `packages/ui` - pair with **`monorepo-tooling`**.
## Outcomes

- `main.ts` / `preview.ts` checklist + 2 example story filenames (patterns only).

## Output Rules

Pin Storybook versions in prose to “match `package.json`”; do not invent major versions.

## Scope and boundaries

- **In scope:** Storybook config, stories, a11y, docs.
- **Out of scope:** Chromatic billing setup, Figma Code Connect (separate tooling).

## Safety

- repo-files in UI package only unless user expands.

## Troubleshooting

- **Next Image in stories:** mock or use unoptimized flag in story-only wrapper - document tradeoff.
- **Multiple React copies:** dedupe with `resolve.alias` in vite config.

## Related skills

- [`web-design-guidelines`](../web-design-guidelines/SKILL.md) - design tokens and motion
- [`accessibility-audit`](../accessibility-audit/SKILL.md) - a11y addon findings
- [`semantic-html-css`](../semantic-html-css/SKILL.md) - story markup baseline

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/storybook-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
