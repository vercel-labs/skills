# Payments PCI boundaries (merchant apps)

High-level PCI scope for Next.js + PSP Elements. Not legal advice. Pair with `skills/payments-handbook` and `skills/webhook-receivers`.

## Hard rules

- Never store PAN, full track data, or CVV/CVC.
- Collect card data only via **PSP-hosted** fields (Elements / Payment Element / hosted checkout).
- Server creates PaymentIntent/Checkout Session with **idempotency key**; verify amount + currency before fulfill.
- Log redaction: never log `client_secret`, raw card fields, or full webhook bodies with PII.

## Preferred architecture (SAQ A–style)

```
Browser → PSP JS (card) → your Next Route Handler (intent id only) → DB order
                ↑ webhook (signed) confirms capture / failure
```

Document “we never touch raw card” in reviews when architecture matches.

## Webhook pairing

| Step | Requirement |
|------|-------------|
| Verify | Provider signature (HMAC/RSA) with timing-safe compare |
| Dedupe | Persist event id; return 2xx if already processed |
| Authorize amount | Re-fetch intent from PSP before shipping / unlocking |
| Fail closed | Unknown event types: ack safely or 4xx per provider retry docs |

## Related SkillCodex skills

- `webhook-receivers` - signature + idempotency handlers
- `api-handbook` - idempotent order APIs
- `env-config-agent` - live vs test keys
