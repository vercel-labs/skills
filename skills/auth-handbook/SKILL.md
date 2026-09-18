---
name: auth-handbook
description: Sessions, cookies, OAuth callbacks, and RBAC for Next.js App Router - httpOnly, CSRF-same-site boundaries, complements env-config-agent
---

# Instructions

Design **authentication and authorization** for **Next.js App Router** without inventing a vendor SDK. Read [auth-sessions.md](../../references/auth-sessions.md) before proposing cookie or OAuth changes.

## When to Use

- Use when designing sessions, OAuth/OIDC callbacks, middleware auth gates, or RBAC placement.
- Prefer **`env-config-agent`** first if secrets / `NEXT_PUBLIC_*` leakage is the main issue.
- Prefer **`security-headers`** after cookies settle if CSP is breaking login or OAuth popups.
- Prefer passkeys-only deep work only when the user explicitly asks (out of scope here).

1. **Sessions:** prefer **httpOnly** `Secure` `SameSite` cookies for browser sessions; store only opaque session id server-side; never expose session secrets in `NEXT_PUBLIC_*` (see **`env-config-agent`**). Use the strategy table in [auth-sessions.md](../../references/auth-sessions.md).
2. **CSRF:** for cookie-based sessions, use **SameSite=Lax** default; for cross-site POSTs, explicit CSRF token or the pattern documented by the auth library already in the repo.
3. **OAuth / OIDC:** validate **`state`**; use **PKCE** for public clients; fixed **redirect URI** allowlist; exchange code server-side only.
4. **RBAC:** enforce permissions in **Server Actions**, **Route Handlers**, and **data access** layers - never rely on hiding UI buttons alone.
5. **Passwords:** if applicable, bcrypt/argon2 via an established server library; never log passwords; rate-limit credential endpoints (gateway or middleware).
6. **Middleware:** coarse checks only (session presence); heavy auth logic stays in server modules so Edge bundles stay small when middleware runs on Edge.
7. **Failure modes:** document infinite redirect loops (middleware vs layout fighting) and Secure-cookie-on-http-localhost before shipping.

## Outcomes

- Decision table (session type × deployment) + callback checklist + where RBAC runs.
- Explicit link to env and header skills when secrets or CSP are involved.

## Output Rules

No hardcoded client secrets. Placeholder URLs only. Name libraries only if already in `package.json`.

## Scope and boundaries

- **In scope:** patterns, cookie flags, callback order, RBAC placement.
- **Out of scope:** enterprise IdP federation design, passkeys-only rollout, legal compliance text.

## Safety

- **requires_user_approval:** true - auth mistakes are high impact.
- Never echo session cookies or tokens in assistant output.

## Troubleshooting

- **Infinite redirect loops:** middleware vs layout auth checks fighting - unify a single source of truth.
- **Session not sticking:** `Secure` cookie on http localhost - document the dev exception explicitly.
- **OAuth callback 400:** redirect URI mismatch or missing `state`/PKCE verifier.

## Related skills

- [`env-config-agent`](../env-config-agent/SKILL.md) - typed env and secret boundaries
- [`security-headers`](../security-headers/SKILL.md) - CSP with auth cookies
- [`payments-handbook`](../payments-handbook/SKILL.md) - never store PAN in session

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/auth-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
