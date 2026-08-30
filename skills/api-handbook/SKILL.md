---
name: api-handbook
description: REST and Next.js Route Handler design - status codes, errors, idempotency, and versioning without bloat
---

# Instructions

## When to Use

- Use for REST-ish Route Handlers, status codes, errors, versioning.
- Prefer `forms-and-validation` for Server Action forms.
- Prefer `webhook-receivers` for inbound provider callbacks.

Shape **HTTP APIs** implemented as **Next.js Route Handlers** (or edge/node runtime).

### Decision: Handler vs Server Action vs webhook

| Need | Prefer |
|------|--------|
| Browser form POST same-origin | `forms-and-validation` / Server Action |
| Public/partner HTTP JSON API | Route Handler (`api-handbook`) |
| Provider callback (Stripe/GitHub) | `webhook-receivers` |
| Long-lived stream | `realtime-handbook` |

1. Model resources and sub-resources; prefer nouns in paths; version in path **or** header - pick one and document.
2. Status codes: 200/201/204/400/401/403/404/409/422/429/500 - state when each applies for this feature.
3. **Errors:** one JSON shape (`error.code`, `error.message`, optional `details`); never leak stack traces in production.
4. **Idempotency:** `Idempotency-Key` for creates; GET/PUT safe retries; document replay behavior.
5. **Validation:** zod at the boundary before side effects; typed handler args.
6. **AuthZ:** enforce in the handler (pair `auth-handbook`); never trust client-only role flags.
7. **Rate limiting:** middleware or gateway - do not invent product names.
8. **CORS:** explicit origins; never `*` with credentials; prefer same-origin BFF for cookie sessions.
9. **Security headers:** align with `security-headers` for browser-hit APIs; JSON APIs still use `nosniff`.
10. **Observability:** attach `requestId`; log failures without PII (`observability-handbook`).

## Outcomes

- Verb + path table, error contract, idempotency bullets, authz note.

## Output Rules

Tables first; then optional example handler signature pseudocode only.

## Scope and boundaries

- **In scope:** Route Handler design, contracts, headers.
- **Out of scope:** GraphQL schema design, gRPC, legacy PHP APIs.

## Safety

- Read-only; no real API keys in examples.

## Troubleshooting

- **405 on route:** wrong HTTP method export or conflicting dynamic segment.
- **Body parse errors:** validate `Content-Type` then zod; avoid double-reading the stream.
- **Duplicate creates:** missing idempotency store on POST.
- **401 loops:** cookie session vs bearer mismatch - document the expected auth mode.

## Related skills

- [`forms-and-validation`](../forms-and-validation/SKILL.md) - Server Actions + zod forms
- [`webhook-receivers`](../webhook-receivers/SKILL.md) - inbound provider callbacks
- [`auth-handbook`](../auth-handbook/SKILL.md) - protecting handlers
- [`observability-handbook`](../observability-handbook/SKILL.md) - request IDs and error logs
- [`realtime-handbook`](../realtime-handbook/SKILL.md) - streams instead of REST

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/api-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
