---
name: server-caching-handbook
description: Next.js revalidateTag stampedes unstable_cache external Redis and fetch cache hierarchy for production traffic
---

# Instructions

Design **server-side caching** for **Next.js** under load. Pair with **`next-server-patterns`**.

1. Classify data: **public static**, **public dynamic**, **per-user** - each needs different cache keys and invalidation.
2. **Tags:** use granular `revalidateTag` keys; document which Server Actions invalidate which tags.
3. **Stampedes:** when tag expires, many misses hit origin - apply **singleflight**, **stale-while-revalidate**, or **TTL jitter** (see **`references/server-caching-patterns.md`**).
4. **`unstable_cache` / `cache`:** wrap DB or HTTP fan-out; keys must include tenant and all inputs that affect output.
5. **External Redis:** use for cross-region or cross-runtime shared cache; define serialization, TTL, and namespacing; handle Redis down (degrade or fail closed - user chooses).
6. **Personalization:** never cache HTML that embeds private user data under a shared URL.

## Outcomes

- Tag table + invalidation flow + stampede strategy paragraph per hot route.

## Output Rules

State Next version from lockfile; behavior differs by minor - say “verify against installed Next”.

## Scope and boundaries

- **In scope:** Next cache APIs, tags, external cache integration design.
- **Out of scope:** CDN full-page rules at edge provider unless user names product.

## Safety

- read-only design; no production Redis URLs in output.

## Troubleshooting

- **Stale UI after mutation:** missing `revalidatePath` / tag mismatch typo.
- **Redis memory:** TTL mandatory; max entry size cap.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/server-caching-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
