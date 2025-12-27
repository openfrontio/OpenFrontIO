# MultiSourceAnyTargetBFS (boats) — design notes

## What we’re doing

Boat routing is now a single, sound **multi-source / any-target** shortest-path solve on a **water-only** grid.
For equal cost edges, that’s just **BFS**.

The mental model is the classic “virtual super-source / super-target” trick:

- Pretend there is a `START` node with 0-cost edges to every source `S`.
- Pretend every target `D` has a 0-cost edge to an `END` node.
- Run shortest path `START → END`.

We don’t build those nodes: we seed the queue with all sources, and we stop when we **dequeue** any target.

## API shape

Return value: `{ source, target, path } | null`

- `source`: which seed-origin won (useful when seeds are water-adjacent tiles but the origin is a shore tile).
- `target`: the water tile we reached (usually adjacent to the chosen landing shore).
- `path`: water path as a list of `TileRef` to cache and replay (no per-tick pathfinding).

## Movement model (boats)

- Traversal: `gm.isWater(tile)` only.
- Neighbors: **king moves** (8-neighbor / Chebyshev) by default.
- No-corner-cutting: diagonal is only allowed if both touching orthogonals are water.
- All moves cost 1, so BFS is optimal.

## Performance wins (the non-negotiables)

- Use typed arrays + stamps (no `Set`/`Map` in the inner loop).
- **Precompute water-body component IDs** once per map instance (`WaterComponents.ts`) and filter sources/targets:
  - If source component ≠ target component, skip it (ocean vs lake becomes O(1) reject).
  - This makes “impossible” routes cheap and lets us delete hacky visited-count early exits.

## How this integrates (transport/trade/warships)

- Destination selection stays “near click”: pick a bounded set of landing shore candidates, then convert to adjacent water targets.
- Source selection stays bounded (sampling/extrema/etc), then convert to adjacent water seeds.
- Compute the route once on launch/init, cache `path`, and only advance an index during ticks.
- Retreat follows the existing cached path backwards (no recompute).

## Current known waste

If the client pre-queries and the server recomputes, you will see two searches for a single action.
We should ensure we only do one solve per user action (exact mechanism TBD: remove the pre-query, or reuse/publish the computed route).

