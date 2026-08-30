---
name: performance-audit
description: Audit Next.js performance - bundle size, images, RSC boundaries, Core Web Vitals checklist
---

# Instructions

Audit **Next.js** app performance. Read-only analysis unless user requests fixes.
## When to Use

- Use for bundle size, images, RSC boundaries, CWV checklists.
- Prefer `seo-expert` when Search Console field data drives the work.
- Prefer `next-server-patterns` to fix server/client splits found in the audit.


## Checks

1. **Bundle size** - note if `@next/bundle-analyzer` is configured; flag heavy imports in client components (`lodash` full, large icon packs, chart libs on landing routes).
2. **Images** - raw `<img>` vs `next/image`; missing `sizes`; above-fold without `priority`; below-fold without lazy loading.
3. **RSC boundaries** - large client islands that could be Server Components; unnecessary `"use client"` on layout shells.
4. **Fonts** - prefer `next/font`; flag layout shift risks.
5. **Core Web Vitals** - per route/component checklist:
   - **LCP:** hero image/font, server latency hints
   - **CLS:** dynamic inserts without reserved space
   - **INP:** heavy client handlers on first interaction

## Output

Group each finding:

- **Impact:** high | medium | low
- **Location:** `file:line` or route path
- **Issue** - **Recommendation** (one line each)

## Outcomes

- Prioritized list the user can execute in one sprint.
- Optional “quick wins” section (under 1 hour).

## Output Rules

No generic performance lectures. Evidence from the repo only; say when a metric was not measured.

## Scope and boundaries

- **In scope:** Next.js App/Pages router frontends in the open repo.
- **Out of scope:** CDN/DNS changes, database query tuning without schema access, guaranteed CWV scores.

## Safety

- Read-only; suggest commands (`pnpm build`, analyzer script) for user to run.
- Do not fetch user production URLs with credentials.

## Troubleshooting

- **Analyzer not set up:** give minimal `next.config` snippet; do not assume it is already installed.
- **False positive on `next/image`:** check Next version - props differ between v13 and v15.
- **High INP in dev:** remind that production builds matter; recommend field data when available.

## Related skills

- [`seo-expert`](../seo-expert/SKILL.md) - CWV field data context
- [`next-server-patterns`](../next-server-patterns/SKILL.md) - RSC/bundle splits
- [`accessibility-audit`](../accessibility-audit/SKILL.md) - a11y vs perf tradeoffs

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/performance-audit/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
