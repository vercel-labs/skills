---
name: next-server-patterns
description: Next.js App Router server components, streaming, caching, and client boundaries without guesswork
---

# Instructions

Guide **Next.js App Router** layout: **Server Components** by default, **Client** only where hooks, browser APIs, or event handlers require it.

1. Map each route segment: static generation, dynamic with `fetch` cache, or `force-dynamic` - justify in one line each.
2. Identify **client islands**: smallest `'use client'` files; no client wrapper around entire layout unless required.
3. **Streaming:** propose `loading.tsx` and Suspense boundaries for slow I/O; avoid waterfall fetches where parallel is possible.
4. **Data fetching:** Server Component `fetch` cache tags vs `unstable_cache` - name tradeoffs; no invented Next flags.
5. **Metadata:** keep in server files; never duplicate head logic in client trees.
6. **React 19+ in Next 15+:** prefer `useActionState` / server-first flows from `forms-and-validation`; use `React.cache` for per-request dedupe of expensive server-only calls when appropriate.
7. **User-visible failures:** pair with `error-loading-not-found` - do not catch errors only in client toasts while the server returns 500 HTML.
8. **Hot paths:** for tag-based revalidation and stampedes see **`server-caching-handbook`** and **`references/server-caching-patterns.md`**.

## Outcomes

- Boundary diagram (bullet list: server file → client leaf).
- Caching table per route.
- Copy-paste checklist for code review.

## Output Rules

Use headings: Boundaries · Caching · Streaming · Metadata. No full app rewrite unless user asks.

## Scope and boundaries

- **In scope:** App Router RSC patterns, fetch cache, streaming, client split.
- **Out of scope:** Pages Router migration project, backend DB design, auth secret storage.

## Safety

- Read-only unless user requests file edits.
- Do not paste real `NEXTAUTH_SECRET` or tokens.

## Troubleshooting

- **Hydration mismatch:** trace client-only state leaking into server HTML.
- **Stale data:** verify `revalidatePath` / `revalidateTag` after mutations.
- **Huge client bundle:** list largest imports in client leaves only.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/next-server-patterns/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
