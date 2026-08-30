---
name: env-config-agent
description: Manage Next.js environment variables safely - .env.example, NEXT_PUBLIC_ rules, typed env, secret leak checks
---

# Instructions

Help manage **environment variables** in **Next.js** projects without leaking secrets.
## When to Use

- Use for `.env.example`, typed env, `NEXT_PUBLIC_*` rules.
- Prefer `auth-handbook` for session cookie design.
- Prefer `secure-dependencies` for install-script secret risk.


## Workflow

1. **Inventory** - read `.env`, `.env.local`, `.env.development` *structure only* (key names). Never echo values in output.
2. **`.env.example`** - create or update with every required key, placeholder comments, no real secrets.
3. **`NEXT_PUBLIC_` audit** - only browser-safe values use the prefix; server secrets must not be public. For **Vite**, the equivalent is `VITE_` - same rule: never prefix secrets.
4. **Source scan** - flag `process.env` reads in client components that reference non-public vars.
5. **Typed env** - generate `env.ts` using `@t3-oss/env-nextjs` or `zod` + manual schema matching keys in `.env.example`.
6. **Git history** - if user approves shell, suggest `git log -p -- '*.env*'` to find accidental commits; recommend rotation if found.

## Writes

Any file write (`.env.example`, `env.ts`, docs) requires **user approval** - summarize diff first.

## Outcomes

- Complete `.env.example` for onboarding.
- Typed module the app imports instead of raw `process.env` scattered in code.
- List of keys that must rotate if ever committed.

## Output Rules

Redact all secret values as `***`. Show only key names and which file references them.

## Scope and boundaries

- **In scope:** Next.js env conventions, example files, typed validation, leak detection guidance.
- **Out of scope:** provisioning cloud secrets managers, rotating keys on behalf of user without explicit request.

## Safety

- **Never** print or copy secret values into chat or commits.
- **requires_user_approval: true** for writes.
- Do not post `.env` contents to external URLs.

## Troubleshooting

- **Build fails after typed env:** ensure server-only vars are not imported in client bundles.
- **Vercel vs local mismatch:** document which vars belong in Vercel project settings vs `.env.local`.
- **pnpm vs npm:** use the lockfile present; do not mix install instructions.

## Related skills

- [`auth-handbook`](../auth-handbook/SKILL.md) - session secrets and cookies
- [`secure-dependencies`](../secure-dependencies/SKILL.md) - install-time secret leaks
- [`github-actions-ci`](../github-actions-ci/SKILL.md) - CI secrets hygiene

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/env-config-agent/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
