---
name: next-server-patterns
description: Next.js App Router server components, streaming, caching, and client boundaries without guesswork
---

# Instructions

## When to Use

- Use for RSC, Server Actions, Route Handlers, and client boundaries.
- Prefer `server-caching-handbook` for stampede/tag details.
- Prefer `next-architecture` for whole-app layering decisions.

Guide **Next.js App Router** layout: **Server Components** by default, **Client** only where hooks, browser APIs, or event handlers require it.

### Placement cheat sheet

| Concern | Put it in |
|---------|-----------|
| Data read for a page | Server Component / `fetch` |
| UI event handlers | Client island (`'use client'`) |
| Same-origin mutation | Server Action (`forms-and-validation`) |
| External HTTP API | Route Handler (`api-handbook`) |
| Cache invalidation design | `server-caching-handbook` |

1. Map each route segment: static, dynamic with `fetch` cache, or `force-dynamic` - justify in one line each.
2. Identify **client islands**: smallest `'use client'` files; no client wrapper around entire layouts unless required.
3. **Streaming:** propose `loading.tsx` and Suspense boundaries for slow I/O; avoid waterfalls where parallel is possible.
4. **Data fetching:** Server Component `fetch` cache tags vs `unstable_cache` / `cache` - name tradeoffs; no invented Next flags; verify against installed Next.
5. **Metadata:** keep in server files; never duplicate head logic in client trees.
6. **React 19+ in Next 15+:** prefer `useActionState` / server-first flows from `forms-and-validation`; use `React.cache` for per-request dedupe when appropriate.
7. **User-visible failures:** pair with `error-loading-not-found` - do not catch only in client toasts while the server returns 500 HTML.
8. **Hot paths:** tag-based revalidation and stampedes → **`server-caching-handbook`** + [server-caching-patterns.md](../../references/server-caching-patterns.md).

## Outcomes

- Boundary diagram (bullet list: server file → client leaf).
- Caching table per route.
- Copy-paste checklist for code review.

## Output Rules

Use headings: Boundaries · Caching · Streaming · Metadata. No full app rewrite unless the user asks.

## Scope and boundaries

- **In scope:** App Router RSC patterns, fetch cache, streaming, client split.
- **Out of scope:** Pages Router migration projects, backend DB design, auth secret storage.

## Safety

- Read-only unless the user requests file edits.
- Do not paste real secrets or tokens.

## Troubleshooting

- **Hydration mismatch:** client-only state leaking into server HTML.
- **Stale data:** verify `revalidatePath` / `revalidateTag` after mutations.
- **Huge client bundle:** list largest imports in client leaves only.
- **Accidental dynamic:** missing cache opts or cookies()/headers() forcing dynamic.

## Related skills

- [`server-caching-handbook`](../server-caching-handbook/SKILL.md) - tags and stampedes
- [`client-data-fetching`](../client-data-fetching/SKILL.md) - hydrate QueryClient
- [`next-architecture`](../next-architecture/SKILL.md) - app-wide boundaries
- [`edge-runtime-handbook`](../edge-runtime-handbook/SKILL.md) - Edge vs Node
- [`forms-and-validation`](../forms-and-validation/SKILL.md) - Server Actions

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/next-server-patterns/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
