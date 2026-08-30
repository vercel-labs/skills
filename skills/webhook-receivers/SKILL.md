---
name: webhook-receivers
description: Secure Next.js Route Handlers for webhooks - signature verify idempotency and replay protection
---

# Instructions

Implement **webhook receivers** in **Next.js Route Handlers**. For payment events, also follow [payments-pci.md](../../references/payments-pci.md).

## When to Use

- Use when adding Stripe/GitHub/PSP (or similar) HTTP callbacks.
- Prefer **`payments-handbook`** for PCI/checkout architecture; this skill owns verify + idempotency + status codes.
- Prefer **`api-handbook`** for the internal APIs the webhook calls after verify.

1. **Verify** signatures using provider docs - use **`crypto.timingSafeEqual`** (or equivalent) on decoded buffers for HMAC; never `===` on user-controlled strings.
2. **Raw body:** read bytes before JSON parse when the signature covers the raw body.
3. **Idempotency:** store event id or dedupe key; return **200** if already processed.
4. **Timeouts:** respond quickly; queue heavy work to a background job pattern the user owns.
5. **Replay:** timestamp tolerance ± a few minutes; reject stale events.
6. **Status matrix:** 2xx = stop retries; 4xx for permanent bad signatures; 5xx only when the provider should retry.

## Outcomes

- Handler pseudocode + verification order + response table.
- Explicit pairing note when the event is payment-related.

## Output Rules

Do not paste sample secrets; use `whsec_...` style placeholders.

## Scope and boundaries

- **In scope:** HTTP handler design, verification order, status codes.
- **Out of scope:** choosing a queue product without user input.

## Safety

- **requires_user_approval:** true - webhooks touch security and billing.

## Troubleshooting

- **Signature invalid:** newline normalization on JSON body; confirm raw vs parsed body.
- **Duplicate events:** upsert on event id before side effects.
- **Provider storms:** ensure handler is O(1) before queueing.

## Related skills

- [`payments-handbook`](../payments-handbook/SKILL.md) - PCI and fulfillment
- [`api-handbook`](../api-handbook/SKILL.md) - downstream APIs
- [`observability-handbook`](../observability-handbook/SKILL.md) - structured logs without PII

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/webhook-receivers/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
