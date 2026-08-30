---
name: client-data-fetching
description: TanStack Query v5 with Next.js App Router - query keys, hydration, staleTime, and server prefetch without double fetch
---

# Instructions

## When to Use

- Use for TanStack Query v5 + RSC hydration without double fetch.
- Prefer `next-server-patterns` when the question is server-only data.
- Prefer `server-caching-handbook` for tag/TTL stampedes.

Use **TanStack Query v5** (`@tanstack/react-query`) with **Next.js App Router** without fighting RSC.

1. **Provider:** wrap client subtree that needs queries - usually a `providers.tsx` client component imported from `layout.tsx`; do not wrap entire app in client unless necessary.
2. **Keys:** stable serializable arrays; include locale and filters; never embed secrets in keys.
3. **Server prefetch:** when RSC fetches initial data, pass **dehydrated state** to client `HydrationBoundary` + `prefetchQuery` - client `useQuery` must use **same key** and compatible `queryFn` or rely on hydrated data.
4. **Defaults:** set sensible **`staleTime`** (e.g. 30s–5m for dashboards); avoid `refetchOnWindowFocus` storm on sensitive forms - tune per query.
5. **Mutations:** `onSuccess` invalidate minimal key prefixes; optimistic updates only with rollback plan.
6. **Errors:** surface with boundaries (`error-loading-not-found` skill); do not leak server error bodies to toast without sanitization.
## Outcomes

- Provider file outline + one `useQuery` + one RSC prefetch example names only (no full app).

## Output Rules

State installed `@tanstack/react-query` version from lockfile; if missing, say “install v5 first” with `pnpm add @tanstack/react-query`.

## Scope and boundaries

- **In scope:** Query client setup, hydration, keys, mutations, cache tuning.
- **Out of scope:** GraphQL client selection, tRPC (different pattern).

## Safety

- No API keys in `queryFn`; use server Route Handlers for secrets.

## Troubleshooting

- **Double fetch:** RSC and client both fetch same URL - align prefetch + `initialData` or hydration only.
- **Stale closure in queryFn:** use `queryKey` deps; avoid capturing mutable outer state without inclusion in key.

## Related skills

- [`next-server-patterns`](../next-server-patterns/SKILL.md) - RSC vs client fetch boundaries
- [`forms-and-validation`](../forms-and-validation/SKILL.md) - mutations with invalidation
- [`server-caching-handbook`](../server-caching-handbook/SKILL.md) - server cache vs client cache

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/client-data-fetching/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
