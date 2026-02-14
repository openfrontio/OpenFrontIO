# Server Deployment Contract

This project keeps game workers stateful, but runtime wiring is fully environment-driven.
For consolidated Rust crate boundaries and migration expansion paths, see `docs/RustArchitecture.md`.

## Rust Gateway (Current Migration State)

The Axum control-plane now supports two modes:

1. `proxy` (default):
   - Serves control-plane metadata APIs (`/healthz`, `/readyz`, `/configz`, `/api/env`, `/v1/metadata/ports`)
   - Proxies HTTP requests to TS master/workers
   - Bridges `/lobbies` and `/matchmaking/join` WebSockets upstream
2. `standalone` / `masterless`:
   - Serves metadata APIs plus native `/api/public_lobbies`
   - Aggregates public lobbies by polling workers (`/w{id}/api/public_lobbies`)
   - Broadcasts `/lobbies` websocket updates from Rust
   - Bridges worker HTTP/WebSocket traffic under `/w{id}/*` directly to workers
   - Serves static SPA content for non-API routes from `CONTROL_PLANE_STATIC_DIR`

See `docs/AxumControlPlaneSpike.md` for details and benchmark notes.

## Required Runtime Inputs

1. `GAME_ENV` (`dev`, `staging`, or `prod`)
2. `MASTER_PORT` (optional, default `3000`)
3. `WORKER_BASE_PORT` (optional, default `3001`)
4. `CONTROL_PLANE_PORT` (optional, default `3100`)
5. `CONTROL_PLANE_BIND_ADDR` (optional, default `0.0.0.0`)

## Derived Port Layout

1. Rust gateway listens on `CONTROL_PLANE_PORT`.
2. TS master listens on `MASTER_PORT`.
3. Workers listen on a contiguous range starting at `WORKER_BASE_PORT`.
4. Worker port `N` is `WORKER_BASE_PORT + N`.
5. Worker count depends on `GAME_ENV` config:
   - `dev`: 2 workers
   - `staging`: 2 workers
   - `prod`: 20 workers

## Session Values Generated At Startup

The master process generates and propagates these to workers:

1. `ADMIN_TOKEN` (internal worker-auth token)
2. `INSTANCE_ID` (`DEV_ID` in `dev`, random otherwise)

These do not need to be pre-provisioned by the orchestrator.

## Feature-Dependent Environment Variables

1. `API_KEY` for API calls like matchmaking check-in and archiving.
2. `TURNSTILE_SECRET_KEY` for Turnstile verification (non-dev environments).
3. `DOMAIN` and `SUBDOMAIN` for canonical URL/domain metadata.
4. `GIT_COMMIT` for HTML/version metadata.
5. `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_AUTH_HEADER` to enable OTEL export.
6. `STRIPE_PUBLISHABLE_KEY` for client payment config.
7. `CONTROL_PLANE_URL` (optional): when set, master `/api/env` is sourced from Axum control-plane `/api/env` with fallback to local response.
8. `CONTROL_PLANE_UPSTREAM_MASTER_URL` (optional): override default upstream master URL in Rust gateway.
9. `CONTROL_PLANE_UPSTREAM_WORKER_BASE_URL` (optional): override default upstream worker-base URL in Rust gateway.
10. `CONTROL_PLANE_REQUEST_TIMEOUT_MS` (optional): outbound proxy timeout in milliseconds (default `5000`).
11. `CONTROL_PLANE_MODE` (`proxy` default, `standalone`/`masterless` for Rust-first ingress).
12. `CONTROL_PLANE_WORKER_COUNT` (optional worker count override for standalone mode).
13. `CONTROL_PLANE_LOBBY_POLL_MS` (optional worker lobby poll interval in standalone mode).
14. `CONTROL_PLANE_STATIC_DIR` (optional static root in standalone mode).
15. `CONTROL_PLANE_MATCHMAKING_UPSTREAM_URL` (optional standalone websocket upstream for `/matchmaking/join`).
16. `CONTROL_PLANE_PUBLIC_BASE_URL` (optional advertised base URL used by `/v1/metadata/ports`).

## Operational Endpoints

Both master and workers expose:

1. `GET /healthz` (process liveness)
2. `GET /readyz` (process readiness)
3. `GET /configz` (sanitized effective runtime config snapshot)

Readiness semantics:

1. Master is `ready` only after all expected workers report ready.
2. Worker is `ready` after its HTTP listener starts.

When a worker is behind path-prefix routing, these are also reachable through prefixed paths (for example `/w3/healthz`).
