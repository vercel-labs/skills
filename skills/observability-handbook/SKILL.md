---
name: observability-handbook
description: Structured logs correlation IDs and error reporting for Next.js App Router - PII boundaries and tracing hooks without vendor lock-in
---

# Instructions

## When to Use

- Use for structured logs, correlation IDs, client error hygiene.
- Prefer `api-handbook` for public error JSON shapes.
- Prefer `auth-handbook` before logging anything near sessions.

Add **observability** that works with **Next.js App Router**: logs, errors, and light tracing. Read [observability-basics.md](../../references/observability-basics.md) first.

1. **Correlation:** generate or forward **`x-request-id`** (or trace id) in Route Handlers and middleware; pass through Server Actions via async context or explicit argument - pick one pattern per app.
2. **Structured logs:** JSON lines in server runtime; fields from the contract table in the reference - **no** raw emails, tokens, or secret query strings.
3. **Client errors:** `error.tsx` / reporting hook sends **sanitized** message + stack fingerprint only; pair with **`error-loading-not-found`**.
4. **PII:** log opaque user ids, not names/emails, unless an audited retention policy says otherwise.
5. **External APM (optional):** if the repo has Sentry/Datadog/etc., initialize **server-only** SDK in an instrumentation pattern; never ship server DSN in client bundles.
6. **Performance signals:** log slow thresholds as metric names, not raw SQL with literals.
7. **Sampling:** high-traffic info logs should be sampleable; errors stay 100% until volume forces otherwise.

## Outcomes

- Logging contract markdown + file list (`instrumentation.ts`, logger util) matching the repo.

## Output Rules

Redact examples; use `req_***` style ids.

## Scope and boundaries

- **In scope:** app-side logging and error capture wiring.
- **Out of scope:** Kubernetes operators, log warehouse schema design.

## Safety

- repo-files only when the user asks for edits; never paste production DSNs.

## Troubleshooting

- **Double logging:** middleware + layout both log the same request - dedupe with id guard.
- **Edge vs Node:** OpenTelemetry exporters often Node-only - split instrumentation (`edge-runtime-handbook`).
- **PII in stack traces:** scrub before client reporters; keep server stacks in private stores.

## Related skills

- [`api-handbook`](../api-handbook/SKILL.md) - handler error shapes
- [`error-loading-not-found`](../error-loading-not-found/SKILL.md) - UI error boundaries
- [`auth-handbook`](../auth-handbook/SKILL.md) - never log tokens
- [`server-caching-handbook`](../server-caching-handbook/SKILL.md) - cache miss metrics

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/observability-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
