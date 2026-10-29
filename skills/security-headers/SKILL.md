---
name: security-headers
description: HTTP security headers and CSP for Next.js - safe defaults, nonces, and report-only rollout
---

# Instructions

Design **CSP** and companion headers (`HSTS`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `COOP`) for **Next.js**. Read [csp-headers.md](../../references/csp-headers.md) before changing production headers.

## When to Use

- Use when rolling out CSP, HSTS, or Permissions-Policy on App Router or Pages.
- Prefer **`auth-handbook`** first if OAuth popups or cookies are already broken.
- Prefer **`observability-handbook`** when wiring CSP report endpoints (no PII dumps).

1. Inventory inline scripts and styles; decide **nonce** vs hash strategy for App Router (see [csp-headers.md](../../references/csp-headers.md)).
2. Start **Content-Security-Policy-Report-Only** with `report-to` or `report-uri` if used.
3. Third parties: list each script domain in `script-src`; avoid `unsafe-inline` unless a documented exception.
4. Prefer `next.config` headers vs middleware based on deployment (Vercel vs self-hosted).
5. Document break-glass: who can widen policy for an emergency hotfix.
6. After enforce: verify hydration, images/fonts, and IdP `frame-src` for OAuth.

## Outcomes

- Header table + CSP lines + phased rollout (report-only → enforce).

## Output Rules

Fenced blocks for `next.config` header snippets only after the user approves writes.

## Scope and boundaries

- **In scope:** headers, CSP, Permissions-Policy for frontend.
- **Out of scope:** WAF vendor rules, DDoS provider setup.

## Safety

- **requires_user_approval:** true - wrong CSP breaks production.
- Never paste real nonce secrets; use placeholders.

## Troubleshooting

- **CSP blocks hydration:** check nonce on `next/script` strategy.
- **Images blocked:** add `img-src` and `media-src` as needed.
- **Login popup blank:** widen `frame-src` / `form-action` for the IdP carefully.

## Related skills

- [`auth-handbook`](../auth-handbook/SKILL.md) - sessions before tightening CSP
- [`observability-handbook`](../observability-handbook/SKILL.md) - report endpoint hygiene

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/security-headers/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
