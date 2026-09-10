---
name: payments-handbook
description: Checkout PCI scope card data boundaries - PSP tokens only pair with webhook-receivers never store or log PAN
---

# Instructions

Plan **payments** integration with **strict PCI boundaries** and **Next.js**. Read [payments-pci.md](../../references/payments-pci.md) before proposing checkout or webhook fulfillment.

## When to Use

- Use when designing checkout, PaymentIntents, refunds, or order fulfillment from payment events.
- Prefer **`webhook-receivers`** for signature verify + idempotency handler details.
- Prefer **`api-handbook`** for idempotent order APIs that webhooks call.
- Prefer **`env-config-agent`** when live vs test keys or secret leakage is the issue.

1. **Never** store **PAN**, CVV, or mag stripe data. Use **PSP-hosted fields** (card Element / Payment Element) so card data touches PSP JS only.
2. **Server:** create **PaymentIntent** / session server-side with **idempotency key**; return client secret to UI; verify amounts and currency server-side on success.
3. **Webhooks:** implement with **`webhook-receivers`** - verify signature, **idempotent** event processing, handle capture vs metadata order (see [payments-pci.md](../../references/payments-pci.md)).
4. **PCI scope:** prefer **SAQ A**-style architecture (redirect or iframe/Element hosted by PSP); documenting “we never touch raw card” is required in reviews.
5. **Refunds / disputes:** outline state machine (pending → succeeded → refunded); no destructive scripts without approval.
6. **Testing:** PSP test cards only; no live keys in repo; `.env.example` key **names** only.
7. **Fulfillment:** pair with **`api-handbook`** for idempotent order creation from webhook handlers.
8. **Logging red lines:** never log `client_secret`, PAN, or full unredacted webhook bodies.

## Outcomes

- Architecture diagram (bullet): browser → PSP → your API → DB + webhooks.
- Checklist: idempotency, amount verification, logging red lines.

## Output Rules

read-only design unless the user explicitly requests code and approves. No real API keys.

## Scope and boundaries

- **In scope:** integration patterns, PCI boundaries, webhook pairing.
- **Out of scope:** tax/VAT legal advice, crypto on-ramp compliance, custom acquirer protocols.

## Safety

- **high** + **requires_user_approval:** true - money and compliance.
- Do not suggest storing cardholder name + PAN together in your DB.

## Troubleshooting

- **Webhook amount mismatch:** always fetch authoritative intent from PSP API before fulfilling.
- **Client secret leaked:** rotate keys; never log `client_secret`.
- **Double charge risk:** missing idempotency key on intent creation - add before retry logic.

## Related skills

- [`webhook-receivers`](../webhook-receivers/SKILL.md) - signed, idempotent handlers
- [`api-handbook`](../api-handbook/SKILL.md) - order APIs
- [`env-config-agent`](../env-config-agent/SKILL.md) - key hygiene

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/payments-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
