# Observability (Next.js App Router)

Compact logging and error-capture rules. Pair with `skills/observability-handbook`.

## Field contract (server)

| Field | Required | Notes |
|-------|----------|-------|
| `time` | yes | ISO-8601 |
| `level` | yes | `debug`/`info`/`warn`/`error` |
| `msg` | yes | short, stable wording |
| `requestId` | yes | from `x-request-id` or generated |
| `route` | yes | path pattern, not raw query with secrets |
| `userId` | optional | opaque id only |

**Never log:** passwords, session cookies, bearer tokens, full PAN, raw authorization headers, unconstrained PII emails/names.

## Where to log

| Layer | What |
|-------|------|
| Middleware | request start + id (cheap) |
| Route Handler / Server Action | business failures, auth denials |
| `error.tsx` / client reporter | sanitized message + fingerprint |
| Instrumentation | APM init **server-only** |

## Related SkillCodex skills

- `api-handbook` - public error JSON vs internal logs
- `error-loading-not-found` - UI boundaries
- `auth-handbook` - never log session material
