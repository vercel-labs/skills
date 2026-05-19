---
name: realtime-handbook
description: SSE and WebSockets in Next.js Route Handlers - auth connection limits and when to pick each transport
---

# Instructions

Choose and sketch **real-time** delivery in **Next.js** (App Router **Route Handlers** or dedicated Node service).

1. **SSE (Server-Sent Events):** one-way server → browser; simpler over HTTP/2; good for notifications, live logs, progress. **CORS** if cross-origin; reconnection with `Last-Event-ID` if you implement resume.
2. **WebSockets:** full-duplex; chat, collaborative editing. **Auth:** browsers do not attach cookies to WS handshake the same way as same-origin `fetch` in all setups - prefer **short-lived ticket** in query signed server-side **or** same-site origin only with careful CSRF story.
3. **Where it runs:** default **Node** runtime for long-lived connections; **Edge** often wrong for many WS/SSE scale patterns - justify runtime per deployment.
4. **Scale:** sticky sessions or shared pub/sub (Redis) for multi-instance fan-out; document single-node limits.
5. **Backpressure:** slow clients must not block entire server - bounded queues, drop or disconnect policy.
6. **API-handbook alignment:** status codes and error shape for upgrade failures.

## Outcomes

- Bullet decision: SSE vs WS for this feature + auth sketch + scaling note.

## Output Rules

No toy chat without rate limits; mention abuse controls when user-facing.

## Scope and boundaries

- **In scope:** protocol choice, handler shape, auth, scaling concepts.
- **Out of scope:** game netcode, WebRTC media.

## Safety

- read-only; warn on unauthenticated WS accepting messages.

## Troubleshooting

- **SSE through proxy:** buffering - disable nginx `proxy_buffering` where applicable (user infra).
- **WS 403 on handshake:** cookie not sent - move to ticket or same-origin WS URL.

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/realtime-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
