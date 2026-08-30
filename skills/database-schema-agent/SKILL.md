---
name: database-schema-agent
description: Design or audit Prisma schemas for Next.js - relations, indexes, naming, migration notes
---

# Instructions

Design or review **Prisma** data models for **Next.js** applications.
## When to Use

- Use for Prisma schema design/review (relations, indexes, naming).
- Prefer `data-layer-handbook` first if ORM is undecided.
- Prefer `api-handbook` for HTTP shapes over the schema.


## Mode A - generate schema

1. Parse the user’s plain-English domain model (entities, relationships, enums).
2. Produce `schema.prisma` with:
   - `@@map` / `@map` only if user prefers snake_case tables
   - IDs (`cuid()` or `uuid()` - match repo if exists)
   - indexes on foreign keys and frequent filters
3. Include migration commands: `pnpm exec prisma migrate dev --name init` (or match project scripts).
4. **Requires user approval** before writing files.

## Mode B - audit existing schema

1. Read `prisma/schema.prisma` and related queries if present.
2. Report: missing indexes, ambiguous relations, cascade risks, N+1-prone includes, naming inconsistencies.
3. Suggest fixes as diffs or bullet list - no writes unless approved.

## Outcomes

- **Mode A:** copy-paste-ready schema + migration instructions.
- **Mode B:** prioritized audit with severity labels.

## Output Rules

State mode. For Mode A, fence `schema.prisma` only after approval summary.

## Scope and boundaries

- **In scope:** Prisma schema design and review for Node/Next backends. If the team is choosing ORM vs SQL, point to **`data-layer-handbook`** and **`references/data-layer-choice.md`** first, then return here for Prisma.
- **Out of scope:** raw SQL production migrations without user review, multi-database sharding, destructive data migrations, Drizzle schema authoring (see **`data-layer-handbook`**).

## Safety

- **Mode A** writes schema files - `requires_user_approval: true`.
- Never embed production database URLs or passwords; use `env("DATABASE_URL")` only.
- Warn before `onDelete: Cascade` on high-cardinality relations.

## Troubleshooting

- **Migrate drift:** suggest `prisma migrate status` before new migrations.
- **PlanetScale / serverless:** note provider-specific limitations if user names them.
- **Monorepo:** confirm `schema.prisma` path (`packages/db` vs root).

## Related skills

- [`data-layer-handbook`](../data-layer-handbook/SKILL.md) - ORM vs SQL choice first
- [`next-server-patterns`](../next-server-patterns/SKILL.md) - query placement
- [`api-handbook`](../api-handbook/SKILL.md) - API shapes over the schema

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/database-schema-agent/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
