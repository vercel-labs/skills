---
name: react-60fps-physics
description: >
  Architecture patterns for building 60fps interactive physics simulations (particle systems,
  force-directed graphs, SVG node networks, canvas animations) inside React without frame drops.
  Use when: building floating node visualizations, particle effects, interactive graph layouts,
  or any rAF-based animation where React re-renders are causing jitter, micro-stutters, or
  connection/position lag. Core insight: physics must run on mutable refs, never inside setState.
  Covers: direct DOM updates, element ref maps, imperative SVG handles, smoothstep state
  transitions, and when NOT to use Framer Motion or react-spring.
---

# React 60fps Physics

## The Core Anti-Pattern (what everyone gets wrong)

```jsx
// ❌ Physics inside setState — React scheduler overhead every frame
useEffect(() => {
  const animate = (time) => {
    setNodes(prevNodes => {
      // Physics here runs inside React's scheduler.
      // Even returning prevNodes has overhead. 60fps = 3600 setState calls/min.
      const newNodes = [...prevNodes]; // + N object allocations per frame → GC stutters
      // ... physics ...
      return newNodes;
    });
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}, [selectedId, connectedNodes]); // ❌ selection changes cancel+restart the rAF loop!
```

**Three compounding problems:**
1. `setState` overhead per frame even when returning `prevNodes`
2. Object spread `{ ...node }` × N nodes × 60fps = GC micro-stutters
3. Dep array changes (selection, hover) cancel+restart rAF → 1-frame animation gap

## The Fix: Physics on Mutable Refs

```jsx
const nodesRef = useRef([]);          // mutable physics store
const nodeElementMapRef = useRef(new Map()); // O(1) element lookup
const selectedIdRef = useRef(null);   // ref-mirror of state — rAF never restarts

// Keep refs in sync with state (no rAF restart)
useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

useEffect(() => {
  if (!hasMounted || nodesRef.current.length === 0) return;
  let animId;
  let lastTime = performance.now();
  const syncCounter = { current: 0 };

  const animate = (time) => {
    const dt = Math.min((time - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = time;

    const nodes = nodesRef.current;
    const selectedId = selectedIdRef.current; // read from ref, not closure

    // Physics mutates nodes in place — zero React involvement per frame
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      // ... physics calculations, mutate node.position.x/y directly ...
    }

    // Lazy-populate element map (O(1) lookup vs querySelector O(n))
    if (nodeElementMapRef.current.size !== nodes.length) {
      nodeElementMapRef.current.clear();
      nodes.forEach(n => {
        const el = svgRef.current?.querySelector(`[data-node-id="${n.id}"]`);
        if (el) nodeElementMapRef.current.set(n.id, el);
      });
    }

    // Direct DOM — no React reconciliation
    nodes.forEach(node => {
      const el = nodeElementMapRef.current.get(node.id);
      if (!el) return;
      if (isSafari) {
        el.style.transform = `translate3d(${node.position.x}px, ${node.position.y}px, 0)`;
      } else {
        el.setAttribute('transform', `translate(${node.position.x}, ${node.position.y})`);
      }
    });

    // Update nodeMap in-place — no object allocation per frame
    nodes.forEach(n => {
      const existing = nodeMapRef.current.get(n.id);
      if (existing) {
        existing.position.x = n.position.x;
        existing.position.y = n.position.y;
      } else {
        nodeMapRef.current.set(n.id, { ...n });
      }
    });

    // Also update connections directly (see Imperative SVG section below)
    connectionsRef.current?.updatePositions(nodeMapRef.current);

    // React sync every ~10 frames for interaction state only (hover, click)
    syncCounter.current++;
    if (syncCounter.current % 10 === 0) setNodes([...nodesRef.current]);

    animId = requestAnimationFrame(animate);
  };

  animId = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(animId);
}, [nodes.length, containerWidth, containerHeight, performanceConfig]);
// selectedId intentionally omitted — mirrored into selectedIdRef above
```

## Imperative SVG Path Updates (connections/threads)

For SVG connections between nodes: use `forwardRef` + `useImperativeHandle` so paths update at 60fps alongside nodes, not on React sync frames.

```jsx
// ConnectionsRenderer.tsx
const ConnectionsRenderer = React.memo(forwardRef((props, ref) => {
  const pathElementsRef = useRef(new Map()); // "sourceId|||targetId" → SVGPathElement

  useImperativeHandle(ref, () => ({
    updatePositions: (nodeMap) => {
      pathElementsRef.current.forEach((pathEl, key) => {
        const [sourceId, targetId] = key.split('|||');
        const src = nodeMap.get(sourceId);
        const tgt = nodeMap.get(targetId);
        if (src && tgt) {
          pathEl.setAttribute('d', calculatePath(src.position, tgt.position, offset));
        }
      });
    }
  }), []);

  const registerRef = useCallback((key) => (el) => {
    if (el) pathElementsRef.current.set(key, el);
    else pathElementsRef.current.delete(key);
  }, []);

  // render <Connection key={k} pathRef={registerRef(`${sourceId}|||${targetId}`)} ... />
}));

// In parent rAF loop — called every frame, zero React
connectionsRef.current?.updatePositions(nodeMapRef.current);
```

Extract path calculation into a pure function so both React render and imperative updates use the same math:

```js
export const calculateConnectionPath = (sourcePos, targetPos, stableOffset) => {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance === 0) return '';
  const mid = { x: (sourcePos.x + targetPos.x) / 2, y: (sourcePos.y + targetPos.y) / 2 };
  const curvature = Math.min(distance * 0.3, 80);
  const perp = { x: -dy / distance * curvature, y: dx / distance * curvature };
  return `M ${sourcePos.x} ${sourcePos.y} C ${mid.x + perp.x + stableOffset} ${mid.y + perp.y + stableOffset}, ${mid.x - perp.x - stableOffset} ${mid.y - perp.y - stableOffset}, ${targetPos.x} ${targetPos.y}`;
};
```

## Smoothstep Arrest Recovery (no snap-jitter on state change)

When a node transitions from "arrested" (selected, dampening factor 0.05) to "free" (1.0), ramping via smoothstep prevents visible lurching:

```jsx
const arrestRecoveryRef = useRef(new Map()); // nodeId → 0..1

// On selection change
useEffect(() => {
  const prev = selectedIdRef.current;
  selectedIdRef.current = selectedId;
  if (prev && prev !== selectedId) {
    arrestRecoveryRef.current.set(prev, 0); // start recovery for old node
  }
}, [selectedId]);

// In physics loop
const recoveryRate = dt * 3.5; // ~285ms to full recovery at 60fps
arrestRecoveryRef.current.forEach((factor, id) => {
  const next = Math.min(1, factor + recoveryRate);
  arrestRecoveryRef.current.set(id, next);
  if (next >= 1) arrestRecoveryRef.current.delete(id);
});

// Per node — apply smoothstep
const recovery = arrestRecoveryRef.current.get(node.id);
if (recovery !== undefined && !isSelected) {
  const t = recovery * recovery * (3 - 2 * recovery); // smoothstep 0→1
  arrestFactor = Math.min(arrestFactor, t);
}
```

## Prevent React/DOM Transform Fighting

If a node component applies its own `transform` during React render AND the rAF loop sets the same attribute, they fight on every sync frame.

```jsx
// ❌ React sets transform on sync frames, then rAF immediately overwrites
<g transform={`translate(${node.position.x}, ${node.position.y})`}>

// ✅ rAF exclusively owns positioning — React never touches the transform
<g transform={undefined}>
// Exception: CSS transition for game feedback centering is fine
...(isCentered ? { transform: `translate(${cx}px, ${cy}px)`, transition: '...' } : {})
```

## Performance Tiers

```js
const configs = {
  capacitor: { targetFPS: 30, orbitalUpdateRate: 0, collisionChecks: 'minimal', useSimpleDrift: true },
  mobile:    { targetFPS: 60, orbitalUpdateRate: 0, collisionChecks: 'reduced', useSimpleDrift: true },
  low:       { targetFPS: 30, orbitalUpdateRate: 1, collisionChecks: 'reduced', useSimpleDrift: false },
  medium:    { targetFPS: 60, orbitalUpdateRate: 1, collisionChecks: 'normal',  useSimpleDrift: false },
  high:      { targetFPS: 60, orbitalUpdateRate: 1, collisionChecks: 'full',    useSimpleDrift: false },
};
// orbitalUpdateRate must always be 1 — orbital math is cheap,
// skipping frames creates visible stepping regardless of device tier
```

## When NOT to Use Framer Motion / react-spring

These libraries run on the main thread via rAF. Framer Motion's `x`/`y` shorthand props are **not** hardware-accelerated — they drop frames under load.

| Use case | Recommendation |
|---|---|
| Continuous physics loop (60fps) | Direct DOM (`setAttribute`/`style.transform`) |
| Entry/exit animations | Framer Motion or CSS `@starting-style` |
| Spring-based drag/gesture | Framer Motion (interruptible, momentum) |
| Predetermined motion | CSS animations (off main thread) |
| Programmatic CSS animation | WAAPI (`element.animate([...], {...})`) |

See `references/patterns.md` for advanced patterns: spatial partitioning for collision, mobile drift vs desktop orbital movement, frame-rate limiting without physics drift.
