# Realtime transports (SSE vs WebSocket)

When to pick SSE or WebSockets on Next.js. Pair with `skills/realtime-handbook`.

## Choice matrix

| Need | Prefer | Why |
|------|--------|-----|
| One-way server → client (progress, logs, notifications) | **SSE** | HTTP-friendly; simpler proxies; auto-reconnect patterns |
| Bidirectional chat / collaborative edits | **WebSocket** | Full duplex |
| Short polling enough | Neither | Prefer polling/revalidate until proven insufficient |

## Auth notes

- Same-origin SSE with cookie session often works like `fetch`.
- WebSocket handshake cookie behavior varies; prefer **short-lived signed ticket** query/header minted by a Route Handler.
- Never accept unauthenticated write frames on public WS.

## Runtime and scale

- Long-lived connections: prefer **Node** runtime; Edge is often wrong for fan-out.
- Multi-instance: sticky sessions **or** pub/sub (e.g. Redis) for broadcast.
- Bound queues; disconnect slow clients (backpressure).

## Related SkillCodex skills

- `auth-handbook` - session/ticket minting
- `api-handbook` - error shapes for upgrade failures
- `observability-handbook` - connection metrics without PII
