---
name: next-architecture
description: App-wide Next.js App Router architecture - layers, boundaries, folder strategy, and when to split services without cloning Vercel react-best-practices
---

# Instructions

Shape **application architecture** for a **Next.js App Router** product. Stay at the **system** level; hand feature details to specialist skills. Do **not** duplicate [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `react-best-practices` / composition catalogs - **link** them when the question is component-level React performance.

## When to Use

- Use for greenfield layout, modular boundaries, “where does this belong,” or multi-package Next apps.
- Prefer **`next-server-patterns`** for RSC/Actions/Route Handler mechanics.
- Prefer **`data-layer-handbook`** / **`database-schema-agent`** for ORM choice and Prisma.
- Prefer **`monorepo-tooling`** when the answer is mostly turbo/pnpm workspaces.

1. **Clarify constraints:** team size, deploy target, monorepo vs single app, auth and data vendors already chosen.
2. **Propose layers:** presentation (app routes + UI) → application (Server Actions / use-cases) → domain → data access → adapters (PSP, email, storage).
3. **Boundaries:** no DB imports from Client Components; no secrets in client bundles; Route Handlers for webhooks/external HTTP; Server Actions for UI-owned mutations when appropriate.
4. **Folders:** recommend `app/`, `components/`, `lib/` or `server/` conventions that match the repo; avoid inventing a second framework.
5. **Cross-cutting:** point to `auth-handbook`, `observability-handbook`, `server-caching-handbook`, `i18n-handbook` instead of inlining those designs.
6. **Split services only with evidence:** separate worker/realtime service when connection lifespan or blast radius demands it (`realtime-handbook`, `container-local-dev`).
7. **React composition/perf:** if the ask is “how should I write React components for perf,” cite upstream agent-skills react-best-practices rather than rewriting those rules here.

## Outcomes

- One-page architecture sketch (bullets or mermaid) + folder map + skill handoff list.

## Output Rules

Read-only architecture advice unless the user asks to scaffold folders. Prefer matching existing repo conventions.

## Scope and boundaries

- **In scope:** App Router app structure, layers, ownership, split criteria.
- **Out of scope:** cloning Vercel react-best-practices, Kubernetes deep design, multi-region active-active.

## Safety

- Do not invent production secrets or vendor account layouts.
- Flag high-risk boundaries (payments, auth) for specialist skills.

## Troubleshooting

- **Everything in `app/`:** extract `server/` or `lib/` for domain and data access.
- **God Server Actions:** split by use-case; share domain functions.
- **Premature microservices:** keep a modular monolith until scale evidence appears.

## Related skills

- [`next-server-patterns`](../next-server-patterns/SKILL.md) - RSC/Actions/handlers
- [`data-layer-handbook`](../data-layer-handbook/SKILL.md) - ORM choice
- [`auth-handbook`](../auth-handbook/SKILL.md) - sessions and RBAC placement
- [`monorepo-tooling`](../monorepo-tooling/SKILL.md) - packages and turbo
- [`server-caching-handbook`](../server-caching-handbook/SKILL.md) - cache architecture
- [`pr-review-workflow`](../pr-review-workflow/SKILL.md) - review architectural PRs

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/next-architecture/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
