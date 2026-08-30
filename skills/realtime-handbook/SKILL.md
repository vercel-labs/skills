---
name: realtime-handbook
description: SSE and WebSockets in Next.js Route Handlers - auth connection limits and when to pick each transport
---

# Instructions

Choose and sketch **real-time** delivery in **Next.js** (App Router **Route Handlers** or a dedicated Node service). Read [realtime-transports.md](../../references/realtime-transports.md) before picking SSE vs WebSocket.

## When to Use

- Use when notifications, live logs, progress, chat, or collaborative edits need a push channel.
- Prefer polling / `revalidate` first if latency tolerance is seconds, not milliseconds.
- Prefer **`auth-handbook`** for session or short-lived ticket minting.
- Prefer **`api-handbook`** for upgrade failure error shapes.

1. **SSE:** one-way server → browser; good for notifications, live logs, progress. CORS if cross-origin; reconnection with `Last-Event-ID` when you implement resume.
2. **WebSockets:** full-duplex; chat, collaborative editing. Prefer a **short-lived ticket** minted server-side when cookie attachment on handshake is unreliable.
3. **Where it runs:** default **Node** for long-lived connections; **Edge** is often wrong for fan-out - justify runtime per deployment.
4. **Scale:** sticky sessions or shared pub/sub for multi-instance; document single-node limits.
5. **Backpressure:** slow clients must not block the server - bounded queues, drop or disconnect policy.
6. **Abuse:** rate-limit connects and messages on user-facing endpoints.

## Outcomes

- Bullet decision: SSE vs WS for this feature + auth sketch + scaling note.

## Output Rules

No toy chat without rate limits; mention abuse controls when user-facing.

## Scope and boundaries

- **In scope:** protocol choice, handler shape, auth, scaling concepts.
- **Out of scope:** game netcode, WebRTC media.

## Safety

- read-only by default; warn on unauthenticated WS accepting messages.

## Troubleshooting

- **SSE through proxy:** buffering - disable nginx `proxy_buffering` where applicable (user infra).
- **WS 403 on handshake:** cookie not sent - move to ticket or same-origin WS URL.
- **Multi-instance missed events:** missing pub/sub fan-out.

## Related skills

- [`auth-handbook`](../auth-handbook/SKILL.md) - tickets and sessions
- [`api-handbook`](../api-handbook/SKILL.md) - errors and versioning
- [`observability-handbook`](../observability-handbook/SKILL.md) - connection metrics without PII

**GitHub:** https://github.com/bh611627/skills/tree/main/skills/realtime-handbook/SKILL.md  
**npm:** https://www.npmjs.com/package/@skillcodex/skills
