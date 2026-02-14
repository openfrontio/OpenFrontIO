# Axum Control-Plane Gateway

For the consolidated Rust-side architecture map and expansion sequencing, see `docs/RustArchitecture.md`.

This Rust control-plane now supports two modes:

1. `proxy` (default): lightweight ingress gateway in front of the existing stateful TypeScript master/worker servers.
2. `standalone`/`masterless`: Rust owns ingress, `/api/public_lobbies`, and `/lobbies` fanout directly, while workers can still remain TypeScript during transition.

## Goal

Move HTTP/WebSocket ingress to Rust while keeping game-loop ownership in TypeScript workers during migration.

Current non-goals:

1. Worker game-loop ownership
2. Worker gameplay WebSocket protocol behavior
3. Existing gameplay contracts

## Endpoints

The gateway exposes:

1. `GET /healthz`
2. `GET /readyz`
3. `GET /configz`
4. `GET /api/env`
5. `GET /v1/metadata/ports`
6. `GET /lobbies` (WebSocket bridge to master)
7. `GET /matchmaking/join` (WebSocket bridge to master)
8. Fallback handler:
   - `proxy` mode: HTTP proxy for `/api/*`, `/w{workerId}/*`, and master/static routes.
   - `standalone` mode: static SPA serving for non-API paths, worker routing for `/w{workerId}/*`.

In `standalone` mode:

1. `GET /api/public_lobbies` is aggregated by polling workers (`/w{id}/api/public_lobbies`).
2. `GET /lobbies` is served by a local broadcast channel with `lobbies_update` payloads.
3. Worker HTTP/WebSocket traffic under `/w{workerId}/*` is routed directly by the control-plane.

`/api/env` matches the existing TypeScript master contract (`{ "game_env": "..." }`)
so the TypeScript master can source this endpoint from control-plane when `CONTROL_PLANE_URL` is configured.

## Runtime Inputs

1. `CONTROL_PLANE_BIND_ADDR` (default: `0.0.0.0`)
2. `CONTROL_PLANE_PORT` (default: `3100`)
3. `GAME_ENV` (default: `dev`)
4. `MASTER_PORT` (default: `3000`)
5. `WORKER_BASE_PORT` (default: `3001`)
6. `INSTANCE_ID` (optional, pass-through in `configz`)
7. `CONTROL_PLANE_UPSTREAM_MASTER_URL` (optional override, default `http://127.0.0.1:$MASTER_PORT`)
8. `CONTROL_PLANE_UPSTREAM_WORKER_BASE_URL` (optional override, default `http://127.0.0.1:$WORKER_BASE_PORT`)
9. `CONTROL_PLANE_REQUEST_TIMEOUT_MS` (default `5000`)
10. `CONTROL_PLANE_MODE` (`proxy` default; `standalone` or `masterless` for Rust ingress ownership)
11. `CONTROL_PLANE_WORKER_COUNT` (optional override; defaults by env: dev/staging `2`, prod `20`)
12. `CONTROL_PLANE_LOBBY_POLL_MS` (optional worker lobby poll interval, default `1000`)
13. `CONTROL_PLANE_STATIC_DIR` (optional static root, defaults to `../static` when running from `rust/`)
14. `CONTROL_PLANE_MATCHMAKING_UPSTREAM_URL` (optional websocket upstream for `/matchmaking/join` in standalone mode)
15. `CONTROL_PLANE_PUBLIC_BASE_URL` (optional advertised base URL for `/v1/metadata/ports`)

## Run

```bash
cd rust
cargo run -p openfront-control-plane
```

Rust-ingress dev path without TS master:

```bash
npm run dev:rust-ingress
```

This runs:

1. Vite client
2. TS workers only (`WORKER_ID=0,1`)
3. Axum control-plane in `CONTROL_PLANE_MODE=standalone`

## Benchmark

Run the built-in ApacheBench harness:

```bash
npm run perf:control-plane
```

Tunable environment variables:

1. `CONTROL_PLANE_HOST` (default `127.0.0.1`)
2. `CONTROL_PLANE_PORT` (default `3199`)
3. `BENCH_HEALTH_N`, `BENCH_HEALTH_C`
4. `BENCH_READY_N`, `BENCH_READY_C`
5. `BENCH_CONFIG_N`, `BENCH_CONFIG_C`
6. `BENCH_ENV_N`, `BENCH_ENV_C`
7. `BENCH_PORTS_N`, `BENCH_PORTS_C`
8. `AB_OUTPUT_DIR` (default `/tmp/openfront-control-plane-bench`)

Latest local baseline (2026-02-14, release build, loopback):

1. `/healthz`: ~40.9k req/s, ~4.89 ms/request at `n=30000`, `c=200`
2. `/readyz`: ~38.4k req/s, ~5.21 ms/request at `n=30000`, `c=200`
3. `/configz`: ~42.9k req/s, ~2.33 ms/request at `n=10000`, `c=100`
4. `/api/env`: ~41.1k req/s, ~2.43 ms/request at `n=10000`, `c=100`
5. `/v1/metadata/ports`: ~30.1k req/s, ~3.32 ms/request at `n=10000`, `c=100`

Performance notes:

1. Endpoint responses remain allocation-light and serialization-friendly (`Json` over small structs).
2. `/v1/metadata/ports` now precomputes derived strings at startup to avoid request-time string formatting.
3. Treat local loopback numbers as regression gates, not absolute production capacity.

## Coexistence Model

1. Keep TypeScript master/worker processes as the source of truth for game state.
2. Route client ingress through this Rust gateway in dev/staging while gameplay continues in TS workers.
3. Move API/WebSocket behavior from TS master into Rust incrementally behind stable contracts.
