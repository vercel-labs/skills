---
name: web-design-guidelines
description: Web design for SkillCodex doc UIs - React + TypeScript + Tailwind; build or audit per design-guidelines. Prefer div + CSS motion; use framer-motion only in client components.
---

# Instructions

## When to Use

- Use to build or audit SkillCodex-style documentation UIs.
- Prefer `skillcodex-browser-ui` for the full four-route browser.
- Prefer `accessibility-audit` for WCAG scoring beyond design rules.

This skill merges **doc UI implementation** (formerly `documentation-ui`) and **UI review (audit)**.

Canonical rules live in [design-guidelines.md](../../references/design-guidelines.md) only. **STRICT UI ONLY** - no backend, API, DB, auth.

**Motion:** use **shell + optional motion leaf** from [design-guidelines.md](../../references/design-guidelines.md): Tier 0 `div` + `CARD_HOVER` everywhere by default; Tier 2 `framer-motion` only in a dedicated `*Motion.tsx` with `'use client'`. **Never** mix `motion.div` and layout `div` in one file - split or drop Framer. Skeletons: always `animate-pulse` on `div`, never `motion`.

---
## Mode A - Build / implement doc UI

Use when the user wants a **premium documentation-style** interface (like [skills.sh](https://www.skills.sh/) structure: browse, search, detail, outcomes visible - but **no fake install counts**).

1. Apply [design-guidelines.md](../../references/design-guidelines.md) end-to-end (including **testimonials with avatar images** and **buttons** with `cursor-pointer`, hover, `focus-visible`, and **motion on `div`** unless a client-only leaf needs Framer).
2. **Tailwind-first**, mobile-first, mandatory **skeletons** (`animate-pulse` on **`<div>`**, not `motion`).
3. **pnpm** for new app; **match user lockfile** in existing repos; **npm** for `@skillcodex/skills`.
4. Optional **Next**: `next/image`, `next/link`. Optional **framer-motion** in client files only.
5. Data: [data-source.md](../../references/data-source.md).

Output: pnpm commands, file paths, checklist pass/fail.

---

## Mode B - Audit / review existing UI

Use when the user asks to review, audit, or check accessibility.

1. Read project TSX against [design-guidelines.md](../../references/design-guidelines.md).
2. If file missing locally, fetch `https://raw.githubusercontent.com/bh611627/skills/main/references/design-guidelines.md`.
3. Flag: missing skeletons, weak whitespace, custom CSS over Tailwind, gradient-heavy backgrounds, glassmorphism, sales-led landing or vendor metric dashboard chrome, a11y gaps; testimonials without **alt** on avatars; buttons without pointer/hover/focus; **`motion` / `motion.div` in Server Components** (Next) without `'use client'`; **shell vs leaf** violations (Framer mixed with layout in one file); wrong **named style** or layout table row for stated industry.
4. Optional deep pass: Vercel `web-interface-guidelines/main/command.md`.

Output: grouped `file:line` findings + checklist. No preamble.

---

## Outcomes

- **Build:** components wired, skeletons on load, theme + tokens, `pnpm dev` works.
- **Audit:** actionable list or explicit pass.

## Output Rules

State which mode. Then evidence (files or findings).

## Scope and boundaries

- Frontend documentation UIs only - not sales-led marketing sites.

## Safety

- Build: edit UI files; user runs pnpm.
- Audit: suggest only; public raw URLs for guidelines.

## Troubleshooting

- **framer-motion / motion.div in Server Components:** add `'use client'` to that file or replace with `motionless` div + Tailwind.
- **pnpm vs npm:** pnpm for app scripts; npm for installing `@skillcodex/skills`.
- **Skeletons missing:** use `animate-pulse` on `<div>`, not Framer, unless client-only.

## Related skills

- [`skillcodex-browser-ui`](../skillcodex-browser-ui/SKILL.md) - full doc browser
- [`semantic-html-css`](../semantic-html-css/SKILL.md) - structure baseline
- [`accessibility-audit`](../accessibility-audit/SKILL.md) - WCAG audit after UI

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/web-design-guidelines/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
