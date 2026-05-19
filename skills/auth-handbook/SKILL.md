---
name: auth-handbook
description: Sessions, cookies, OAuth callbacks, and RBAC for Next.js App Router - httpOnly, CSRF-same-site boundaries, complements env-config-agent
---

# Instructions

Design **authentication and authorization** for **Next.js App Router** without inventing a specific vendor SDK.

1. **Sessions:** prefer **httpOnly** `Secure` `SameSite` cookies for browser sessions; store only opaque session id server-side; never expose session secrets in `NEXT_PUBLIC_*` (see **`env-config-agent`**).
2. **CSRF:** for cookie-based sessions, use **SameSite=Lax** default; for cross-site POSTs, explicit CSRF token or pattern documented by your auth library - state what the repo uses.
3. **OAuth / OIDC:** validate **`state`**; use **PKCE** for public clients; fixed **redirect URI** allowlist; exchange code server-side only.
4. **RBAC:** enforce permissions in **Server Actions**, **Route Handlers**, and **data access** layers - never rely on hiding UI buttons alone.
5. **Passwords:** if applicable, bcrypt/argon2 via established server library; never log passwords; rate-limit credential endpoints (mention gateway or middleware).
6. **Middleware:** use for coarse checks (session presence); heavy auth logic stays in server modules to keep Edge bundle small when on Edge.

## Outcomes

- Decision table (session type × deployment) + checklist for callbacks + where RBAC runs.

## Output Rules

No hardcoded client secrets. Placeholder URLs only. Name libraries only if already in `package.json`.

## Scope and boundaries

- **In scope:** patterns, cookie flags, callback order, RBAC placement.
- **Out of scope:** enterprise IdP federation design, passkeys-only rollout, legal compliance text.

## Safety

- **requires_user_approval:** true - auth mistakes are high impact.
- Never echo session cookies or tokens in assistant output.

## Troubleshooting

- **Infinite redirect loops:** middleware vs layout auth checks fighting - unify single source of truth.
- **Session not sticking:** `Secure` cookie on http localhost - document dev exception explicitly.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/auth-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
