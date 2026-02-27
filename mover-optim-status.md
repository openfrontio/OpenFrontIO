# Mover Rendering Optimization Status

## Goal + Scope Snapshot
- Goal: stabilize mover rendering under load and remove dense motion-plan fallback work in runtime ship execution.
- Scope: pathfinding motion plan pipeline (`PathFinding`, `PathFinderStepper`, `MiniMapTransformer`), ship executions, `UnitLayer` rendering/trails, perf overlay counters, and targeted tests.

## Decision Log
- Motion smoothing remains linear segment interpolation (no Bézier).
- Budget model is soft: 3ms target + on-screen overrun allowance.
- Rendering model uses persistent canvases (static units + dynamic movers + trails).
- Dense runtime fallback generation in transport/trade executions is removed.
- Perf instrumentation is added to the in-game performance overlay.

## Change Entries
### ID 1
- Files changed: `mover-optim-status.md`
- What changed: Created the tracking document with required sections and format.
- Why changed: Plan requires a live engineering log documenting each change batch and rationale.
- Behavior impact: None.
- Perf impact expected: None.
- Validation done: File structure reviewed against requested format.

### ID 2
- Files changed: `src/core/pathfinding/PathFinder.ts`, `src/core/pathfinding/PathFinderStepper.ts`, `src/core/pathfinding/transformers/MiniMapTransformer.ts`, `src/core/execution/TransportShipExecution.ts`, `src/core/execution/TradeShipExecution.ts`, `src/core/game/MotionPlans.ts`
- What changed: Enabled smoothing in `WaterSimple` path pipeline, made `PathFinderStepper.findPath()` prime step cache, added collinear segment compression in `MiniMapTransformer` segment upscaling, removed dense LOS fallback usage from trade/transport ship plan emission, and removed now-unused dense LOS fallback helper from `MotionPlans`.
- Why changed: Remove duplicated path work, guarantee segment-plan availability in runtime water path configurations, reduce jagged keypoint verbosity at minimap boundary, and eliminate dense-to-sparse recomputation in ship execution loops.
- Behavior impact: Trade/transport motion plan emission now relies on pathfinder-native `planSegments` with defensive single-point fallback only if unexpectedly unavailable.
- Perf impact expected: Fewer redundant `findPath` calls, reduced per-plan payload complexity after compression, and less runtime planning overhead in ship executions.
- Validation done: Pending targeted tests and type-check run.

### ID 3
- Files changed: `src/client/graphics/layers/UnitLayer.ts`, `src/client/graphics/layers/UnitMotionRenderQueue.ts`
- What changed: Reworked mover rendering to persistent dynamic-canvas drawing with a versioned priority queue scheduler; introduced soft 3ms budget (+on-screen overrun), off-screen throttling cadence, and per-unit mover state (plan/version/error/debt/rect); unified trail rendering onto a single trail canvas rebuilt from transport+nuke trail stores; switched nuke trail storage to unit-id keyed maps with explicit dirty/rebuild lifecycle.
- Why changed: Prevent frame-local disappearance when budget is exhausted, prioritize visible movers deterministically, and simplify/repair trail lifecycle consistency.
- Behavior impact: Motion-planned units now persist visually between frames even when skipped by budget; transport trails remain until despawn; nuke trail cleanup is driven by tracked unit ids.
- Perf impact expected: Reduced redraw churn (targeted rect clears), bounded per-frame mover work, and fewer full-context draw operations.
- Validation done: Pending targeted tests and runtime checks.

### ID 4
- Files changed: `src/client/graphics/layers/Layer.ts`, `src/client/graphics/GameRenderer.ts`, `src/client/graphics/layers/PerformanceOverlay.ts`, `src/client/graphics/layers/UnitLayer.ts`
- What changed: Added optional layer perf-counter API, wired renderer tick loop to collect and forward counters, added `PerformanceOverlay.updateLayerCounters(...)` and a UnitLayer counters panel, and exposed UnitLayer queue/budget counters via `getPerfCounters()`.
- Why changed: Provide visibility into whether the new mover scheduler respects budget and where skips/debt accumulate.
- Behavior impact: Performance overlay can now show live UnitLayer operational counters when visible.
- Perf impact expected: Negligible overhead; counters are lightweight numeric snapshots.
- Validation done: Pending targeted tests and smoke run.

### ID 5
- Files changed: `tests/PathFinderStepperPriming.test.ts`, `tests/MiniMapTransformerPlanSegments.test.ts`, `tests/UnitMotionRenderQueue.test.ts`, `tests/UnitLayerTrailLifecycle.test.ts`, `src/client/graphics/layers/TrailLifecycle.ts`, `src/client/graphics/layers/UnitLayer.ts`
- What changed: Updated stepper priming expectation, added minimap segment-compression invariant test, added queue ordering/stale-entry tests, and added trail lifecycle pruning tests via a new pure helper used by `UnitLayer`.
- Why changed: Cover the new runtime behavior with focused tests and keep trail cleanup logic testable without DOM canvas harness complexity.
- Behavior impact: No runtime feature change beyond factoring trail cleanup into a helper.
- Perf impact expected: None in production; helper is linear-time over existing trail maps.
- Validation done: Pending execution of targeted vitest files.

### ID 6
- Files changed: `mover-optim-status.md`
- What changed: Recorded targeted and broader validation runs with pass status.
- Why changed: Close the loop on implementation quality and keep audit trail in a single status document.
- Behavior impact: None.
- Perf impact expected: None.
- Validation done:
  - `npx vitest run tests/PathFinderStepperPriming.test.ts tests/MiniMapTransformerPlanSegments.test.ts tests/UnitMotionRenderQueue.test.ts tests/UnitLayerTrailLifecycle.test.ts` ✅
  - `npx vitest run tests/MotionPlansSegments.test.ts tests/SmoothingWaterTransformerPlanSegments.test.ts tests/MiniMapTransformerPlanSegments.test.ts tests/PathFinderStepperPriming.test.ts tests/UnitMotionRenderQueue.test.ts tests/UnitLayerTrailLifecycle.test.ts` ✅

### ID 7
- Files changed: `mover-optim-status.md`
- What changed: Added build/type-check validation outcome.
- Why changed: Confirm no TypeScript or build regressions in production code paths, including `UnitLayer` and overlay integration.
- Behavior impact: None.
- Perf impact expected: None.
- Validation done:
  - `npm run build-dev` ✅ (`tsc --noEmit` + vite build)
  - Existing non-blocking build warnings noted (pre-existing JSON import-attributes consistency warnings, chunk-size warnings).

## Validation Log
- Targeted mover/path tests passed (7/7).
- Broader related motion-plan/pathfinding subset passed (10/10).
- Note: vitest required escalated execution in this environment due `esbuild` spawn permissions (`EPERM` without escalation).
- Type-check + development build passed via `npm run build-dev`.

## Open Risks / Follow-ups
- Large `UnitLayer` refactor has integration risk (canvas composition + trail lifecycle + budgeting).
- Need targeted tests to cover queue semantics and path compression invariants.
