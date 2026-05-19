---
name: typescript-refactor
description: Refactor JavaScript to strict TypeScript or audit types - incremental .js to .ts with explicit return types
---

# Instructions

Help the user migrate a React/Next.js codebase from JavaScript to **strict TypeScript**.

**Before edits:** suggest `pnpm exec tsc --noEmit` (or `npx tsc --noEmit`) so there is a baseline.

## Mode A - full file refactor

1. Ensure `tsconfig.json` has `"strict": true` (and `"noImplicitAny": true` if split).
2. Rename target `.js`/`.jsx` → `.ts`/`.tsx` one module at a time (smallest leaf first).
3. Infer props and state; add **explicit return types** on exported functions and hooks.
4. Replace `any` with `unknown`, generics, or narrow types; use type guards where needed.
5. For large repos, optional **ts-morph** codemods - list files touched.
6. Update imports and `package.json` types field if missing.
7. Re-run `tsc --noEmit` and fix errors until clean for touched scope.

## Mode B - audit only

1. Scan `src/` for `.js`/`.jsx` remaining.
2. Report `file:line` for: implicit `any`, missing return types, `@ts-ignore`, unsafe casts.
3. Prioritize entry points and shared utilities.
4. No file writes - deliver a markdown table grouped by severity.

## Outcomes

- **Mode A:** converted files + strict config + `tsc --noEmit` instructions.
- **Mode B:** prioritized audit report with estimated effort per file.

## Output Rules

State mode. List files changed or audited. Include the exact `tsc` command used.

## Scope and boundaries

- **In scope:** TypeScript migration, typing, strict config for frontend/Next repos.
- **Out of scope:** backend language migrations, changing runtime behavior beyond types, mass delete/refactor without user scope.

## Safety

- **Mode A** modifies source files; user should commit first and run `tsc --noEmit` before applying.
- Do not print `.env` values; do not run destructive shell without user approval.
- Match the project lockfile (`pnpm-lock.yaml` → pnpm).

## Troubleshooting

- **RSC errors after rename:** ensure server files avoid client-only APIs; add `"use client"` only where hooks are required.
- **`any` explosion:** narrow one module at a time; use `satisfies` and discriminated unions before generics everywhere.
- **ts-morph version mismatch:** align `typescript` devDependency with the project’s installed version.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/typescript-refactor/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
