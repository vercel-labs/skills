# Advanced Physics Loop Patterns

## Delta Time Capping

Always cap `dt` to prevent physics explosions after tab-switch or system sleep:

```js
const dt = Math.min((time - lastTime) / 1000, 0.1); // cap at 100ms (6 frames)
lastTime = time;
```

Without the cap, a 2-second tab blur returns `dt = 2.0` → nodes teleport across the screen.

## Frame Rate Limiting (Mobile)

For 30fps targets on Capacitor/low-power devices — skip frames without physics drift:

```js
const TARGET_FRAME_TIME = 1000 / 30; // 33.3ms for 30fps
let lastFrameTime = 0;

const animate = (time) => {
  if (time - lastFrameTime < TARGET_FRAME_TIME) {
    animId = requestAnimationFrame(animate);
    return; // skip render, but still queue next frame
  }
  const dt = Math.min((time - lastFrameTime) / 1000, 0.1);
  lastFrameTime = time;
  // ... physics with correct dt ...
};
```

**Critical**: Use actual elapsed `dt` (not `1/30`) so physics is frame-rate independent. If you hard-code `dt = 1/30`, paused tabs cause the same explosion problem.

## Mobile Drift vs Desktop Orbital Movement

**Mobile drift** — simple Brownian motion, cheap:

```js
// Initialize with random velocity
node.velocity = { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20 };

// Per frame — just dampen and nudge
node.velocity.x += (Math.random() - 0.5) * 5 * dt;
node.velocity.y += (Math.random() - 0.5) * 5 * dt;
const speed = Math.sqrt(node.velocity.x ** 2 + node.velocity.y ** 2);
if (speed > MAX_DRIFT_SPEED) {
  node.velocity.x = (node.velocity.x / speed) * MAX_DRIFT_SPEED;
  node.velocity.y = (node.velocity.y / speed) * MAX_DRIFT_SPEED;
}
node.position.x += node.velocity.x * dt;
node.position.y += node.velocity.y * dt;
```

**Desktop orbital** — force-directed with attraction/repulsion:

```js
// Per node pair — repulsion
const dx = nodeB.position.x - nodeA.position.x;
const dy = nodeB.position.y - nodeA.position.y;
const dist = Math.sqrt(dx*dx + dy*dy) + 0.001; // avoid div-by-zero
const repulsion = (REPULSION_STRENGTH / (dist * dist)) * dt;
nodeA.force.x -= (dx / dist) * repulsion;
nodeA.force.y -= (dy / dist) * repulsion;

// Per node — center attraction
nodeA.force.x += (centerX - nodeA.position.x) * ATTRACTION_STRENGTH * dt;
nodeA.force.y += (centerY - nodeA.position.y) * ATTRACTION_STRENGTH * dt;

// Apply
nodeA.velocity.x = (nodeA.velocity.x + nodeA.force.x) * dampening;
nodeA.velocity.y = (nodeA.velocity.y + nodeA.force.y) * dampening;
```

**Switching between modes**: When the user switches between mobile/desktop views, reinitialize `node.velocity` — don't carry orbital velocity into drift mode or you get wild motion.

## Spatial Partitioning for Collision (N > 30 nodes)

Naive O(n²) collision detection works for ≤20 nodes. Above that, use a uniform grid:

```js
const CELL_SIZE = 120; // px — should be ~2× max node radius

function buildGrid(nodes) {
  const grid = new Map();
  nodes.forEach(node => {
    const cellX = Math.floor(node.position.x / CELL_SIZE);
    const cellY = Math.floor(node.position.y / CELL_SIZE);
    const key = `${cellX},${cellY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  });
  return grid;
}

function checkCollisions(nodes, grid) {
  nodes.forEach(nodeA => {
    const cellX = Math.floor(nodeA.position.x / CELL_SIZE);
    const cellY = Math.floor(nodeA.position.y / CELL_SIZE);
    // Only check 3×3 neighborhood
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(`${cellX+dx},${cellY+dy}`) || [];
        neighbors.forEach(nodeB => {
          if (nodeA.id >= nodeB.id) return; // avoid double-checking
          resolveCollision(nodeA, nodeB);
        });
      }
    }
  });
}
```

**Rebuild grid each frame** — it's cheap (O(n)) and avoids stale lookups. Only partition if `nodes.length > 25` and collision checks are causing frame drops.

## Boundary Containment

Keep nodes inside the viewport with soft boundary forces (not hard clamp):

```js
const MARGIN = node.size; // keep one radius away from edge
const BOUNDARY_STRENGTH = 15;

if (node.position.x < MARGIN) {
  node.velocity.x += BOUNDARY_STRENGTH * dt;
} else if (node.position.x > containerWidth - MARGIN) {
  node.velocity.x -= BOUNDARY_STRENGTH * dt;
}
// same for Y
```

Hard clamping (`node.position.x = Math.max(MARGIN, node.position.x)`) causes nodes to stick to edges and then suddenly release — visible jitter.

## Memory Allocation Budget

Per-frame allocations cause GC micro-stutters:

| Operation | Per-frame cost | Fix |
|---|---|---|
| `[...nodesRef.current]` | N object refs | Only on React sync frames |
| `{ ...node }` | Full object copy | Mutate in-place |
| `new Map()` | Heap allocation | Reuse, call `.clear()` |
| String template in querySelector | String alloc | Replaced by Map lookup |
| `nodes.filter(...)` | New array | Use indexed loop + early continue |

**Target**: Zero heap allocations in the hot path (physics + DOM update). React sync frames (every 10 frames) can allocate freely.

## Debugging Frame Drops

```js
// Add temporarily — remove before shipping
const FRAME_BUDGET = 14; // leave 2.6ms for browser compositor
let lastFrameTs = performance.now();

const animate = (time) => {
  const elapsed = time - lastFrameTs;
  if (elapsed > FRAME_BUDGET * 1.5) {
    console.warn(`Frame drop: ${elapsed.toFixed(1)}ms (budget: ${FRAME_BUDGET}ms)`);
  }
  lastFrameTs = time;
  // ...
};
```

In Chrome DevTools → Performance → record 3 seconds → look for:
- **Long tasks** (yellow bars >50ms) = React reconciliation storm
- **Recalculate Style** calls every 3 frames = React touching transforms
- **GC events** (garbage collection) = per-frame `{ ...spread }` allocations
