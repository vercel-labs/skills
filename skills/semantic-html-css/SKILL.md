---
name: semantic-html-css
description: Semantic HTML, landmarks, focus, and modern CSS - fast accessible UI that pairs with WCAG audits
---

# Instructions

Raise baseline **HTML semantics** and **CSS quality** before or alongside `accessibility-audit`.

1. **Landmarks:** one `main`; `nav` for primary nav; `header`/`footer` roles clear; skip redundant `role` when native element suffices.
2. **Headings:** single logical `h1` per page/view; no level skips for styling - fix with CSS.
3. **Interactive:** native `button` vs `div` onClick; `a` with real `href` for navigation; hit targets ≥ 24px (prefer 44px touch).
4. **Focus:** `:focus-visible` styles never removed without replacement; no `outline: none` without visible focus ring.
5. **Motion:** `prefers-reduced-motion: reduce` - replace auto-play loops with static or instant state.
6. **Layout:** prefer `flex`/`grid` + `gap`; avoid deep absolute positioning for primary reading flow.

## Outcomes

- Bullet list of markup fixes + CSS tokens to add (spacing, focus ring color).

## Output Rules

File:line when auditing existing code; for greenfield, component tree with element types.

## Scope and boundaries

- **In scope:** structure, global CSS patterns, Tailwind class-level guidance.
- **Out of scope:** full color-system design (use `web-design-guidelines`).

## Safety

- read-only unless user requests edits.

## Troubleshooting

- **Landmark duplication:** multiple `main` from portals - consolidate or `aria-hidden` on duplicate decorative wrappers only with care.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/semantic-html-css/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
