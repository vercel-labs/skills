---
name: edge-runtime-handbook
description: Next.js Edge Runtime limits - what runs where and how to split Node-only code
---

# Instructions

Explain **Edge vs Node** runtimes in **Next.js** for the user’s code.

1. Flag imports: `fs`, native Prisma client, some `crypto` patterns, large WASM - usually **Node**.
2. **Middleware** defaults edge - keep fast; no heavy I/O.
3. **Route segment config** `runtime = 'edge' | 'nodejs'` - justify per route.
4. **Env:** `process.env` inlined on edge - secrets risk; use public env only on edge.
5. Suggest **split:** edge handler validates + forwards to Node server action or internal API if needed.

## Outcomes

- Table: file → current runtime → recommended runtime → blockers.

## Output Rules

Link to Next docs concepts by name; no fabricated API lists - say “verify against installed Next version”.

## Scope and boundaries

- **In scope:** runtime choice, import restrictions, split patterns.
- **Out of scope:** Cloudflare Workers specifics unless user deploys there.

## Safety

- Read-only; warn on secret exposure on edge.

## Troubleshooting

- **Prisma on edge:** use Data Proxy or move to Node route - state tradeoffs.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/edge-runtime-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
