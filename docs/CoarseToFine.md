# Coarse-to-fine pathfinding (boats) — notes

## Why

Full-res water BFS is optimal and simple, but the “ocean case” can still expand a lot of tiles.
Coarse-to-fine is the next lever: do a cheap solve on a low-res map to guide / bound the expensive solve.

## We already have low-res maps

The terrain loader already ships multiple resolutions per map:

- `manifest.map` + `map.bin` (full res)
- `manifest.map4x` + `map4x.bin` (coarser)
- `manifest.map16x` + `map16x.bin` (even coarser)

At runtime we load:

- `gameMap`: full res for normal games (or `map4x` for compact games)
- `miniGameMap`: lower res (`map4x` for normal games, or `map16x` for compact games)
- `microGameMap`: always `map16x` (in compact games this is the same instance as `miniGameMap`)

So we can prototype coarse-to-fine without extending mapgen first.

## Core idea

Stage 1 (coarse):
- Run the same multi-source/any-target search on `miniGameMap` (BFS, water-only, king-moves if desired).
- Result is a coarse path (or just a coarse distance field).

Stage 2 (refine):
- Run full-res BFS on `gameMap`, but **restricted** by what stage 1 learned (a “corridor”) *or* guided by a coarse heuristic.

Important: the coarse map is an approximation. It must never be allowed to make the final path invalid.
If the refine stage fails inside the corridor, fall back to full-res BFS.

## Option A: Coarse corridor (this)

1) Map fine tiles → coarse cells by integer scaling:
   - `scaleX = gameMap.width / miniGameMap.width`
   - `scaleY = gameMap.height / miniGameMap.height`
2) Solve on coarse, get a coarse cell path.
3) Inflate that path into a corridor:
   - include all coarse cells within radius `r` of the coarse path (e.g. `r = 1..3` )(Manhattan or Chebyshev radius depending on move rules)
4) Refine on full-res with a fast mask:
   - `passableFine(tile) = gm.isWater(tile) && corridorMask[coarseOf(tile)]`
5) If no path found, retry without the corridor (or inflate `r` and retry once).

Notes:
- If the low-res generation is “optimistic” (water if any child tile is water), the coarse path can cut across land.
  Inflation + fallback is what keeps this safe.

## Option B: Coarse heuristic for A* (future?)

If we ever move from BFS → A* on full-res, a cheap heuristic is:

- Precompute `coarseDist[coarseCell]` by BFS on `miniGameMap` seeded from coarse targets.
- Use `h(tile) = coarseDist[coarseOf(tile)] * min(scaleX, scaleY)`

If the coarse map is “more passable” than the fine map (typical for minimaps), `coarseDist` tends to **underestimate**,
which is admissible (safe) but not always very tight.

## Where component IDs fit

Water-component IDs are still a free early reject:

- `WaterComponents.ts` already precomputes IDs per `GameMap` instance.
- Do the same check on `miniGameMap` if useful, but full-res component filtering already prevents the worst “wrong ocean” searches.

## Practical next steps 
 Measure: expansions + ms, before/after, on worst-case oceans.
 decide if mapgen needs a better “navmap” (e.g. conservative water, coastline preservation, etc.).
