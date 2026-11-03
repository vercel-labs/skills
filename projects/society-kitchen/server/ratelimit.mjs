// Small in-memory sliding-window limiter. Good for a single server process;
// use a shared store (e.g. Redis) if the server is ever run in several copies.
export function createLimiter({ windowMs, max, now = Date.now }) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: windowMs - (t - recent[0]) };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
      }
      return { ok: true, retryAfterMs: 0 };
    },
  };
}
