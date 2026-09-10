# Auth sessions (Next.js App Router)

Compact rules for cookie sessions, OAuth callbacks, and RBAC placement. Pair with `skills/auth-handbook`.

## Session strategies

| Pattern | Browser storage | Server store | Tradeoffs |
|---------|-----------------|--------------|-----------|
| Opaque session id | httpOnly `Secure` cookie | Redis/DB session row | Revocable; best default for App Router |
| JWT in cookie | httpOnly JWT | Optional denylist | Stateless; harder revoke; keep payload small |
| Bearer JWT only | Memory / Authorization header | None | Fine for pure APIs; awkward for SSR HTML |

**Flags:** `HttpOnly`, `Secure` (except documented localhost http), `SameSite=Lax` default. Prefer `Path=/`. Never put session secrets in `NEXT_PUBLIC_*`.

## Cookie CSRF

- Same-site form POSTs: `SameSite=Lax` usually enough.
- Cross-site cookie POSTs: CSRF token or library double-submit; document which the repo uses.
- Middleware: coarse “has session?” only; authorize in Server Actions / Route Handlers / data layer.

## OAuth / OIDC checklist

1. Fixed redirect URI allowlist (exact match).
2. `state` validated; **PKCE** for public/SPA-style clients.
3. Code exchange **server-side only**; never expose client secret to the browser.
4. Map IdP subject → local user once; do not trust client-supplied `user_id`.

## RBAC placement

Enforce in: Route Handlers, Server Actions, queries/mutations. Never “hide the button” alone.

## Related SkillCodex skills

- `env-config-agent` - secrets and typed env
- `security-headers` - CSP after auth cookies settle
- `payments-handbook` - never mix card data into session blobs
