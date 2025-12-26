# MultiSourceAnyTargetBFS (boats) — design notes

## Goal

Replace the current “guess a landing tile, then pathfind” approach with a single **multi-source, any-target** search that:

- Prefers landings **near the user click** (destination selection stays “near click”).
- Finds the **best source+target pair** in one run (no retries / staged hacks).
- Is fast enough for a hot path by doing **one search per boat launch**, not per tick.

This is the standard “virtual super-source + virtual super-target” idea:

- Imagine a `START` node connected to every source `S` with cost 0.
- Imagine every target `D` connected to an `END` node with cost 0.
- Run shortest-path from `START` to `END`.

We do not build those nodes; we seed the queue with all sources and stop when we pop a target.

## Scope / assumptions

- Boat routing runs on a **water-only graph**.
- For now, all edges are **equal cost**, so we use **BFS**.
- Optional “pretty” modes (diagonals or smoothing) must be behind a toggle so the default stays cheap.

If we later add non-uniform costs (e.g., currents, danger zones, traffic), the same API can switch to
Dijkstra/A* by supplying a cost function; BFS remains the fast-path when cost is constant.

## Inputs and outputs

### Inputs

- `sources`: candidate attacker spawn shores (or their adjacent water tiles).
- `targets`: candidate defender landing shores near click (or their adjacent water tiles).
- `neighbors(node)`: 4-neighbor (or optional 8-neighbor) adjacency function.
- `passable(node)` or `isTraversable(from,to)`: boat constraint (water-only).
- `maxNodes` / `maxRadius` / `maxSteps` (optional): guardrails for worst-case expansions.

### Output

`{ source, target, path } | PathNotFound`

- `source`: which source won.
- `target`: which target was reached first (with correct BFS semantics).
- `path`: full route (list of tiles) to persist on the unit/execution.

## Target selection (“near click”, but bounded)

Keep the “landing near click” behavior by constructing a **small target set**:

- Collect defender shore tiles around the clicked tile and/or on the defender border.
- Sort by Manhattan distance to click.
- Keep the first `K` (cap, e.g. `K=50..200`) or `min(K, floor(shoreCount * 0.05))` with a hard max.
- Preferably filter to the same connected water component as the attacker (ocean vs a specific lake),
  otherwise BFS will waste time exploring an impossible component.

This turns “any destination” into a precise, controllable set.

## Source selection (bounded)

Sources can be large (player border can be huge). For performance:

- Prefer “spawnable shore tiles” (owned + shore + valid spawn rules).
- Cap/summarize: best-by-distance-to-click, extremal tiles, plus uniform sampling.
- If we already know the boat’s actual spawn (e.g. UI precomputes), sources can be a singleton.

## Core algorithm (unweighted)

### Correct early-exit rule

When using BFS:

- Early-exit only when a target node is **dequeued** (popped), not when first discovered.
  Dequeue guarantees minimal distance.

### Multi-source seeding

Initialize BFS frontier with all sources:

- `dist[source] = 0`
- `prev[source] = -1`
- `startOf[source] = source`
- enqueue all sources

When expanding neighbors:

- if unseen, set `prev[neighbor] = node`, set `startOf[neighbor] = startOf[node]`, enqueue.

When dequeuing:

- if `node` is in `targets`, stop and reconstruct by walking `prev[]`.

### Data structures (hot-path friendly)

Avoid maps/sets in the inner loop:

- `visitedStamp: Uint32Array(numTiles)` + `stampCounter` (no clearing per query).
- `prev: Int32Array(numTiles)` (or `Int32Array` only for seen nodes using a compact list).
- `queue: Int32Array(numTiles)` with head/tail indices (ring buffer).
- `targetsStamp: Uint32Array(numTiles)` (mark target membership once per query via stamping).
- `startOf: Int32Array(numTiles)` if we need “which source won” without reconstructing first step.

Allocate these once and reuse.

## Integration points (boat launch only)

- On boat launch (intent/execution init), compute:
  1) `targets` near click
  2) `sources` (spawn candidates)
  3) `path = MultiSourceAnyTargetBFS(sources, targets)`
- Persist `path` and only advance an index in `tick()`.
- Recompute only on meaningful topology changes (rare) or if the current path is invalidated.
  Default: do not “find path… then find path…”.

## Diagonals / smoothing (optional)

Two mutually exclusive options:

1) **8-neighbor BFS** (“king moves”, Chebyshev) with **no corner cutting**:
   - allow diagonal move only if both adjacent orthogonal tiles are water.
   - still unweighted BFS (diagonal cost == orthogonal cost), so the metric becomes Chebyshev.
2) **4-neighbor BFS + smoothing pass**:
   - keep BFS cheap/correct,
   - do a short post-process that removes zigzags if there is line-of-sight over water.

Default recommendation for boats: option (1) enabled, with no-corner-cutting enabled.

## Failure modes and guardrails

- If `targets` is empty → return `PathNotFound` early.
- If `sources` is empty → return `PathNotFound` early.
- If BFS exceeds a configured budget (`maxNodes`) → return `PathNotFound` (and optionally fall back).

## What this intentionally does NOT do

- No staged “find path… then adjust/retry” heuristics.
- No per-tick pathfinding.
- No bidirectional multi-target tricks (too easy to get subtly wrong).
