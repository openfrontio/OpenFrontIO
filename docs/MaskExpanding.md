# Mask-expanding BFS (adaptive corridor refinement, no restart)

Purpose: keep the “coarse corridor” win, but avoid repeated **restart + re-walk** churn when the corridor is too tight.

This is the “performance-first” sibling of:
- `docs/CoarseToFine.md` (coarse corridor + safe fallback)
- `docs/LocalCorridorWidening.md` (visited-driven local relaxation)

Key idea: run one fine-res search; if the queue exhausts because the corridor is too restrictive, **expand the mask and keep going** without clearing the fine BFS state.

## What changes (vs restart-based local widening)

Today (A2-style):
- attempt = run fine BFS inside current mask
- on failure: widen mask, **restart** fine BFS (visited/prev cleared via new stamp)

No-restart:
- run fine BFS inside current mask
- on queue empty: widen mask, **resume** fine BFS (keep visited/prev/queue state)

This avoids re-enqueueing and re-walking large already-explored areas on “almost works” corridors.

## Correctness note (don’t hand-wave)

Naively resuming a FIFO BFS after expanding the allowed set can change shortest-path guarantees, because newly-allowed tiles might introduce shorter routes to areas you already visited.

Invariant: once a fine tile is marked visited, it is never “unvisited” again — mask expansion only enables additional neighbors/regions and never invalidates already-visited tiles. This is why the fast variant remains sound (valid path) and why we can justify not clearing `visitedStamp` when expanding the mask.

Two viable interpretations:

1) **Fast variant (good enough for corridor repair):**
   - accept that expanding the mask mid-run can produce a path that is not strictly shortest in the *final* expanded region
    - still produces a valid path and is often much faster

2) **Optimal variant (paper-grade):**
   - track `dist[tile]` (or level) and allow “relaxation” when new tiles become allowed
   - process newly enabled nodes in non-decreasing distance (Dial/bucket queue or heap)
   - guarantees shortest path in the final allowed region

For OpenFront boats, the fast variant may already be acceptable because the corridor is a heuristic bound anyway; if we care about strict optimality, use the optimal variant.

This doc describes the implementation in a way that supports either, with minimal extra plumbing.

## Groundwork we already have

From existing coarse-to-fine:
- `fineToCoarse: Uint32Array` mapping
- `allowedMask` as `(tileToRegion, regionStamp, stamp)` using stamps

From `LocalCorridorWidening` implementation:
- `visitedMaskOut` to collect “which coarse regions were actually explored” in a failed attempt
- widening by 1-ring around visited coarse regions, cumulative

We reuse that exact widening rule; the only change is: don’t restart the fine search.

## Data structures (recommended)

Inside `MultiSourceAnyTargetBFS` (or a sibling specialized class):
- `visitedStamp[tile]` (already exists)
- `prev[tile]` (already exists)
- `startOf[tile]` (already exists)
- `queue[]`, `head`, `tail` (already exists)

Additionally for the optimal variant:
- `dist[tile]: Int32Array` (init -1; set on visit)
- `deferred[]` or a bucket/heap for nodes that become enabled later

Mask tracking:
- `allowedCoarseStamp[coarseCell]` (cumulative allowed regions)
- `visitedCoarseStamp[coarseCell]` (per-expansion snapshot; used to widen)

## Core loop (fast variant)

Pseudocode:

1) Build initial allowed mask from coarse spine corridor (`r0`).
2) Seed BFS queue from fine seedNodes filtered by allowed mask.
3) Run BFS:
   - when exploring neighbors:
     - if neighbor is blocked by allowed mask: **skip** (but see below)
     - otherwise visit/enqueue as usual
4) When `head == tail` (queue empty):
   - widen `allowedCoarseStamp` by 1 ring around `visitedCoarseStamp` from the last phase
   - **activate newly enabled frontier nodes**:
     - for each visited fine tile, re-check its neighbors that were previously mask-blocked
     - enqueue any newly-allowed, unvisited neighbors
   - continue BFS
5) Stop when a target is dequeued.

The only missing piece is “activate newly enabled frontier nodes” efficiently.

### Frontier activation strategies

**Strategy F1 (simple, may be OK):**
- keep an `Int32Array deferredTiles` of “neighbor candidates that were blocked by mask”
- when mask widens, scan deferredTiles and enqueue those that are now allowed
- keep deferredTiles deduped via a stamp array to avoid blowup

**Strategy F2 (faster, more code):**
- maintain a per-coarse-region list of deferred fine tiles
- when a coarse region becomes allowed, enqueue only tiles in that region’s list

F2 is the “hot path” answer; F1 is the “get it working + measure” answer.

## Core loop (optimal variant)

If we want shortest paths in the final expanded region, treat mask-expansion as adding nodes that can introduce shorter routes.

Minimal way:
- maintain `dist[tile]`
- when a neighbor becomes newly allowed:
  - `nd = dist[cur] + 1`
  - if `dist[neighbor] == -1 || nd < dist[neighbor]`:
    - update `dist`, `prev`, `startOf`
    - push neighbor into a structure processed in increasing `dist`

Implementation options:
- bucket queue (Dial) since edge weights are 1
- binary heap (slower constants, simpler reasoning)

## Where this plugs in

Implement as a variant of the current coarse-to-fine helper:

- `findWaterPathFromSeedsMaskExpanding(...)` (fineMap + coarseMap + opts)
- reuse the same `allowedMask` and the same visited-driven widening rule
- keep the same guardrail: if expansions exceed `k`, fall back to unrestricted fine BFS

This is a stepping stone to Spine & Portals:
- This improves “corridor repair” without restarts
- Spine & Portals changes the big-O by avoiding fine search over open water entirely

## Suggested milestones

1) Implement the fast variant with deferred frontier list (F1) and measure.
2) If it helps but still shows spikes, upgrade frontier activation to F2.
3) If strict optimality is needed, implement the optimal variant (dist + buckets/heap).

## Note: depth-gated BFS (future)

We can reuse the same “monotonic relaxation” idea for “prefer deep water” by adding a second passability mask like `gm.magnitude(tile) >= minDepth` and relaxing `minDepth` only if needed. This stays BFS-friendly (still unweighted), but changes the objective to “deepest-possible path, then shortest within that depth”; if we need strict shortest for the relaxed threshold, restart per-threshold or use the optimal semantics.

## BSP-ish note

Both mask expansion and depth-gating are “BSP-ish” in the same sense: they incrementally relax constraints (expand the allowed subset) without invalidating already explored space. This makes the search behave more like progressive partition refinement than a single global floodfill, even though we are not literally constructing a BSP tree.
