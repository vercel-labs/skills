# Server-side caching (Next.js + data stores)

Companion to **`server-caching-handbook`** and **`next-server-patterns`**.

## Hierarchy (conceptual)

1. **Full-route cache** (static) - fastest; invalidated by redeploy or explicit revalidation.
2. **`fetch` cache** in RSC - tag- or time-based; know default dynamic vs static for the segment.
3. **`unstable_cache` / `cache`** - wrap expensive server-only work; key by tenant + args.
4. **External store (Redis, etc.)** - cross-instance consistency; TTL + stampede mitigation (singleflight, jitter, early refresh).

## Stampede / thundering herd

When a tag expires or TTL hits, many requests can miss cache at once.

- **Singleflight** - only one recomputation per key (app-level mutex or Redis `SET NX` + short lock).
- **Stale-while-revalidate** - serve stale until refresh completes (if product allows brief staleness).
- **Jitter** on TTLs - spread expirations across instances.

## Tags and invalidation

- Prefer **narrow tags** (e.g. `user:${id}`) over one global `data` tag to limit blast radius.
- After mutations: **`revalidateTag`** / **`revalidatePath`** from Server Actions or Route Handlers - document order if multiple tags.

## What not to cache

- Personalized responses keyed only by cookie without varying the cache key.
- Secrets, PII blobs, or per-request auth tokens in shared Redis values.
