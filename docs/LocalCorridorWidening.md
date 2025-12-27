# Local corridor widening (adaptive coarse-to-fine water pathfinding, adaptive constraint relaxation)

Goal: keep the coarse corridor win, but avoid the current “corridor fails → global full-res BFS” cliff.

Local widening behaves like a cheap BSP refinement:

- start with a narrow corridor (fast)
- if it fails, expand *only where it matters* (still fast)
- only as a last resort, drop the mask entirely

This is intended to be a generic wrapper around `MultiSourceAnyTargetBFS` (used by transport/trade/warship).

## Inputs / outputs

Inputs:
- `fineMap: GameMap`
- `coarseMap: GameMap` (typically `map16x`)
- `seedNodes[]`, `seedOrigins[]` (multi-source)
- `targets[]` (any-target)
- `bfsOpts` (king moves, no-corner-cutting, etc.)
- initial corridor radius `r0`, max attempts `k`

Output:
- `{ source, target, path }` like `MultiSourceAnyTargetBFSResult`, or `null`

## Baseline (what we have today)

1) Coarse BFS to get `coarsePath`
2) Corridor = inflate `coarsePath` by radius `r`
3) Fine BFS restricted by corridor mask
4) If fail: widen radius globally or fall back to unrestricted fine BFS

Problem: a tiny lie in the coarse map (optimistic water) can cause step (4) to explode to “search the whole ocean”.

## Local widening: two practical variants

### Variant A (chosen): widen around visited coarse regions

If fine BFS fails inside the corridor, we already know *where it was trying*.

Implementation sketch:

1) Build initial corridor mask: `allowedCoarse[coarseCell] = true`.
2) Run fine BFS with `allowedMask` = coarse corridor.
3) If it succeeds: done.
4) If it fails:
   - compute `visitedCoarse`: all coarse cells that were actually visited by fine BFS
   - expand corridor by 1 ring around `visitedCoarse` (Chebyshev ring, since king moves)
   - retry fine BFS
5) Repeat up to `k` times.
6) If still no path: unrestricted fine BFS fallback (correctness guardrail).

Clarification: widening is cumulative. Each failed attempt expands around that attempt’s `visitedCoarse`, and newly allowed coarse cells stay allowed across subsequent attempts (via the same `allowedCoarseStamp`).

Why it works:
- you only “pay more” near the constriction you hit
- open-ocean cells that were never approached don’t get unlocked

What “visitedCoarse” means (cheaply):
- while expanding fine BFS, map `fineTile -> coarseCell` (precomputed `fineToCoarse[]`)
- stamp `visitedCoarseStamp[coarseCell] = stamp` when the BFS pops/visits a tile

How to expand by one ring:
- for each coarse cell in `visitedCoarse`, mark its 8 neighbors as allowed
- use stamps, not `Set`, to avoid allocations

### Variant B (not chosen): widen only along the coarse path segment you reached

Similar, but tighter:
- intersect `visitedCoarse` with the original `coarsePath` (or the prefix that’s reachable)
- widen only around that subset

This can be even cheaper on huge corridors, but is easier to get wrong (requires careful “prefix” reasoning).

## Hot-path constraints (don’t regress perf)

- No per-call allocations in the inner BFS loop.
- Use stamp arrays:
  - `allowedCoarseStamp[coarseCell]`
  - `visitedCoarseStamp[coarseCell]`
- Reuse `MultiSourceAnyTargetBFS` instances via `WeakMap<GameMap, MultiSourceAnyTargetBFS>`.
- Keep attempt count small (`k = 2..4`).

## Correctness guardrails

- Coarse map is approximate: coarse success never guarantees fine success.
- Local widening can still miss a path if the corridor is too wrong; that’s fine:
  - always end with an unrestricted fine BFS fallback
- Preserve current move rules:
  - king moves (8-neighbor)
  - no-corner-cutting

## Suggested defaults

- `r0 = 1..2` coarse cells (start tight)
- `k = 3` (initial + 2 widen steps)
- widen step = +1 ring around `visitedCoarse`
- final fallback = unrestricted fine BFS

## Where this plugs in

Replace the current “attempt loop that only increases radius globally” inside coarse-to-fine helper with:

- attempt loop driven by `visitedCoarse`
- optional “global radius bump” as a last attempt before full fallback

This keeps the interface identical for all callsites (transport/trade/warship), but makes “tight corridor” failures cheap.
