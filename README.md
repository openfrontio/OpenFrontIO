# Lobby Statistics

Standalone ingest + analytics tool for OpenFront public lobbies.

## What it tracks

- Lobby open and close times from `/lobbies`.
- Observed join/leave deltas and join rate over time.
- Peak fill, full-duration moments, and churn proxies.
- Start detection after lobby disappears (via `/api/game/:id/exists` + `/api/game/:id`).
- Optional archive enrichment from `${ARCHIVE_API_BASE}/game/:id`.
- Started games are re-polled every 10 minutes until marked completed.
- On startup, historical records already marked `started` are immediately reconciled.
- Replay/archive records backfill `actualStartAt` and `actualEndAt` when available.
- Bucketed analytics for:
  - game mode
  - game mode + team setup
  - map
  - map size + mode
  - modifiers

## Important data caveat

The public APIs do not expose explicit "failed join attempts" (for example, full-lobby rejections).  
This tool therefore tracks:

- observed joins from lobby population deltas,
- unique observed client IDs from `/api/game/:id` polls,
- churn and full-lobby pressure proxies.

## Local NoSQL storage

Document file:

- `data/db.json`

The ingest process writes lobby documents and lifecycle metrics continuously.

Production API notes:

- Lobby websocket stream is `wss://openfront.io/lobbies`.
- Production messages use `type: "lobbies_update"` with `data.lobbies[]`.
- Worker websocket paths (`/wX/lobbies`) may connect but can be silent.

## Scripts

- `npm run dev`: Vite UI + ingest server in parallel.
- `npm run start:server`: ingest server only.
- `npm run build-prod`: typecheck + build frontend into `static/`.

## Environment

Optional env vars:

- `PORT` (default `3100`)
- `TARGET_BASE_URL` (default `https://openfront.io`)
- `TARGET_WS_URL` (default `wss://openfront.io/lobbies`)
- `ARCHIVE_API_BASE` (default `https://api.openfront.io`)
- `DB_PATH` (default `data/db.json`)
- `NUM_WORKERS` (default `20`)
- `GAME_INFO_POLL_MS` (default `5000`)
- `CLOSURE_PROBE_ATTEMPTS` (default `20`)
- `CLOSURE_PROBE_INTERVAL_MS` (default `3000`)

## Run

```bash
npm install
npm run dev
```

UI:

- Vite dev UI: `http://localhost:9100`
- Ingest/API: `http://localhost:3100`

## Deployment note

This project mirrors the existing OpenFront tooling style (TypeScript + Vite + Node/Express + tsx + concurrently/cross-env).
