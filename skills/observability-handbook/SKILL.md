---
name: observability-handbook
description: Structured logs correlation IDs and error reporting for Next.js App Router - PII boundaries and tracing hooks without vendor lock-in
---

# Instructions

Add **observability** that works with **Next.js App Router**: logs, errors, and light tracing.

1. **Correlation:** generate or forward **`x-request-id`** (or trace id) in Route Handlers and middleware; pass through Server Actions via async context or explicit argument - pick one pattern per app.
2. **Structured logs:** JSON lines in server runtime; fields: `level`, `msg`, `time`, `route`, `requestId` - **no** raw emails, tokens, or full query strings with secrets.
3. **Client errors:** `error.tsx` / reporting hook sends **sanitized** message + stack fingerprint only; pair with **`error-loading-not-found`**.
4. **PII:** log user ids (opaque), not names/emails, unless audited retention policy says otherwise.
5. **External APM (optional):** if repo has Sentry/Datadog/etc., initialize **server-only** SDK in instrumentation file pattern; never ship server DSN in client bundles.
6. **Performance signals:** log slow query thresholds as metrics names, not raw SQL with literals.

## Outcomes

- Logging contract markdown + file list (`instrumentation.ts`, logger util) matching repo.

## Output Rules

Redact examples; use `req_***` style ids.

## Scope and boundaries

- **In scope:** app-side logging and error capture wiring.
- **Out of scope:** Kubernetes operator setup, log warehouse schema design.

## Safety

- repo-files only when user asks for edits; never paste production DSNs.

## Troubleshooting

- **Double logging:** middleware + layout both log same request - dedupe with id guard.
- **Edge vs Node:** OpenTelemetry exporters often Node-only - split instrumentation.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/observability-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
