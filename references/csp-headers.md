# CSP and security headers (Next.js)

Safe rollout for Content-Security-Policy and companions. Pair with `skills/security-headers`.

## Companion headers (baseline)

| Header | Typical start |
|--------|----------------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (HTTPS only) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Disable unused sensors (`camera=()`, `microphone=()`, …) |
| `Cross-Origin-Opener-Policy` | `same-origin` when compatible |

## CSP strategy

1. Inventory inline scripts/styles and third-party origins.
2. Prefer **nonce** (App Router) over long-term `unsafe-inline`.
3. Ship **Content-Security-Policy-Report-Only** first; watch violations; then enforce.
4. Split directives: `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `frame-src`.

## Rollout

| Phase | Action |
|-------|--------|
| 0 | Headers in `next.config` or middleware; report-only CSP |
| 1 | Fix top violations (hydration scripts, analytics domains) |
| 2 | Enforce CSP; keep break-glass doc (who can widen policy) |

## Common breaks

- Hydration / `next/script` missing nonce
- Images/fonts blocked → widen `img-src` / `font-src`
- OAuth popup/`frame-src` for IdP

## Related SkillCodex skills

- `auth-handbook` - cookies before tightening CSP
- `observability-handbook` - report endpoint hygiene (no PII dumps)
