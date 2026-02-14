# Rust Architecture (Consolidated)

This document is the single high-level source of truth for Rust-side architecture in this repo.

## Scope

Rust currently contains three crates:

1. `rust/control-plane`: Axum ingress/runtime edge for HTTP/WebSocket routing.
2. `rust/dioxus-ui`: Dioxus UI runtime + component host exposed to browser via WASM.
3. `rust/wasm-core`: deterministic compute kernels currently used for pathfinding acceleration.

## Minimal Architecture Rules

To keep expansion simple and portable, follow these rules:

1. Keep crate boundaries explicit and narrow.
2. Use one shared protocol surface per boundary (avoid parallel contracts).
3. Add abstractions only when there are at least two real implementations.
4. Keep orchestration at edges (control-plane or UI runtime), not spread across many bridge files.
5. Preserve existing external contracts while migrating internals.

## Current Boundaries

### 1) UI Boundary (`client` <-> `dioxus-ui`)

Single contract surface:

1. `dispatch_ui_action`
2. `dispatch_ui_snapshot`
3. `take_ui_events`
4. runtime diagnostics (`ui_runtime_stats`, `lastErrorCode`)

Protocol source of truth:

1. `protocol/ui_runtime_protocol.json`
2. Rust validators/keys: `rust/dioxus-ui/src/runtime_protocol.rs`
3. Rust runtime reducer/router: `rust/dioxus-ui/src/runtime.rs`

### 2) Ingress Boundary (`client`/edge <-> `control-plane`)

Control-plane modes:

1. `proxy`: Rust forwards to TS master/workers.
2. `standalone` (`masterless`): Rust owns ingress responsibilities and routes directly to workers.

Stable endpoints:

1. `/healthz`, `/readyz`, `/configz`
2. `/api/env`
3. `/api/public_lobbies` (native in standalone mode)
4. `/lobbies` (native fanout in standalone mode)
5. `/matchmaking/join` (bridge path, upstream-configurable)
6. `/w{workerId}/*` worker HTTP/WebSocket routing

### 3) Compute Boundary (`client` worker thread <-> `wasm-core`)

`wasm-core` remains a small performance-focused crate:

1. exports deterministic helpers (currently pathfinding-heavy)
2. no server/runtime orchestration concerns
3. no deployment assumptions

## What Is Consolidated Already

1. Rust control-plane can run as standalone ingress without TS master in the loop.
2. Public lobby aggregation/fanout is available in Rust standalone mode.
3. UI runtime protocol is centralized in `protocol/ui_runtime_protocol.json` and enforced in Rust runtime parsing.
4. Rust workspace is cleanly split by responsibility in `rust/Cargo.toml`.

## Expansion Paths (Minimal)

Only add what is needed next. Recommended order:

1. **Path S1: Finish TS master extraction**
   - Move public game scheduling/lobby lifecycle orchestration from TS master into `control-plane` or worker-local APIs.
   - Keep worker gameplay protocol unchanged during this step.

2. **Path S2: Matchmaking ingress ownership**
   - Replace websocket bridge behavior for `/matchmaking/join` with native Rust handling once external API/auth constraints are modeled.
   - Keep existing payload contract unchanged for clients.

3. **Path S3: Worker migration seam**
   - Introduce a Rust worker crate only when it can replace one concrete worker responsibility end-to-end.
   - Start with narrow domains (metadata/read endpoints) before realtime turn loop.

4. **Path U1: UI runtime completion**
   - Continue collapsing host-side browser/session orchestration into runtime action/event handling.
   - Remove bridge code only after runtime path has parity and tests.

5. **Path C1: Shared contract crate (only if needed)**
   - If JSON protocol parsing/validation starts duplicating across many Rust crates, add one small shared crate.
   - Avoid early framework extraction before duplication is real.

## Guardrails For Future Changes

1. Keep protocol versioning explicit (`protocolVersion`) and additive-first.
2. Prefer integration tests at boundaries over deep internal indirection.
3. Do not add plugin systems, service locators, or generic registries for current scale.
4. Keep env-driven runtime config portable and stateless-friendly at ingress.

## Canonical Related Docs

1. Control-plane details: `docs/AxumControlPlaneSpike.md`
2. Deployment/env contract: `docs/ServerDeploymentContract.md`
3. UI runtime migration details: `docs/UIRuntimeMigration.md`
