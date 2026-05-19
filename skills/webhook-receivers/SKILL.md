---
name: webhook-receivers
description: Secure Next.js Route Handlers for webhooks - signature verify idempotency and replay protection
---

# Instructions

Implement **webhook receivers** in **Next.js Route Handlers**.

1. **Verify** signatures using provider docs (Stripe, GitHub, etc.) - use **`crypto.timingSafeEqual`** (or equivalent) on decoded buffers for HMAC; never `===` on user-controlled strings.
2. **Raw body:** read bytes before JSON parse when signature covers raw body.
3. **Idempotency:** store event id or dedupe key; return 200 if already processed.
4. **Timeouts:** respond quickly; queue heavy work to background job pattern user owns.
5. **Replay:** timestamp tolerance ± few minutes.

## Outcomes

- Handler pseudocode + verification order + response table.

## Output Rules

Do not paste sample secrets; use `whsec_...` style placeholders.

## Scope and boundaries

- **In scope:** HTTP handler design, verification order, status codes.
- **Out of scope:** choosing a queue product without user input.

## Safety

- **requires_user_approval:** true - webhooks touch security and billing.

## Troubleshooting

- **Signature invalid:** newline normalization on JSON body.
- **Duplicate events:** upsert on event id.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/webhook-receivers/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
