# Data layer choice (Next.js)

Short companion to **`data-layer-handbook`** and **`database-schema-agent`**.

| Need | Lean toward |
|------|----------------|
| Rich relations, migrations, team knows Prisma | **Prisma** → use `database-schema-agent` |
| SQL-first, lighter bundle, edge drivers | **Drizzle** (or similar) |
| Read-heavy analytics, hand-tuned SQL | **Kysely** / raw SQL in repository layer |
| Serverless Postgres without pool in process | **Pooler** (PgBouncer, hosted pooler) required |

**Rule:** If the repo already standardizes on one ORM, default to it unless there is a written ADR to switch.
