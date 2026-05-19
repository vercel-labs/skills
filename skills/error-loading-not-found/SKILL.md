---
name: error-loading-not-found
description: Next.js App Router error.tsx, not-found, loading, and global-error - recovery UI, logging, and boundaries users actually see
---

# Instructions

Design **App Router** UX for failures and slow routes: **`error.tsx`**, **`not-found`**, **`loading.tsx`**, **`global-error.tsx`**.

1. **`error.tsx`:** client boundary - must reset via `reset()` pattern; log server-side in Route Handlers or server actions, not only `console.error` in production without a sink.
2. **`not-found`:** use `notFound()` from server code; ensure marketing URLs return 404 not 200 empty shell.
3. **`loading.tsx`:** skeletons that match final layout dimensions to reduce CLS; avoid fake progress bars unless truthful.
4. **`global-error.tsx`:** minimal HTML shell when root layout throws; keep copy short and support link.
5. **Nested layouts:** errors bubble to nearest `error.tsx`; document which segments need their own file vs inherited.

## Outcomes

- File tree (`app/.../error.tsx` etc.) + when each runs + logging hook suggestion.

## Output Rules

Use headings: Errors · Not found · Loading · Global. No stack traces in user-visible UI.

## Scope and boundaries

- **In scope:** Next App Router special files, UX copy, structure.
- **Out of scope:** APM vendor setup, log aggregation infrastructure.

## Safety

- repo-files only in scope user names; never log PII or tokens in error payloads.

## Troubleshooting

- **Infinite error loop:** error boundary itself throws - simplify UI, move risky UI out.
- **404 as 500:** missing `notFound()` call or swallowed errors upstream.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/error-loading-not-found/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
