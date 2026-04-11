---
name: run-openfront-game
description: >-
  Starts OpenFrontIO locally via npm scripts (Vite client + dev game server).
  Use when the user wants to run, start, launch, or play the game in
  development; when debugging client/server together; or when they ask for
  local dev URLs or how to connect to staging/production APIs from a dev build.
---

# Run OpenFrontIO locally

## Before first run

From the repository root:

1. Install dependencies with the project’s pinned install command (not plain `npm install`):

   ```bash
   npm run inst
   ```

2. If the user already ran `npm install` successfully, skip reinstall unless they changed `package-lock.json` or hit dependency errors.

## Default: full local dev stack

Runs the Vite dev client and the TypeScript game server with `GAME_ENV=dev`:

```bash
npm run dev
```

- Long-running: run in the background and tell the user how to open the app (Vite prints the local URL in the terminal; this repo sets port **9000** in `vite.config.ts`, e.g. `http://localhost:9000`).
- To avoid auto-opening a browser (if the project or environment does this), set `SKIP_BROWSER_OPEN=true` in the environment before starting.

## Common variants

| Goal                                                 | Command                    |
| ---------------------------------------------------- | -------------------------- |
| Client only (hot reload, no local game server)       | `npm run start:client`     |
| Server only (dev settings)                           | `npm run start:server-dev` |
| Dev client + server, API pointed at **staging**      | `npm run dev:staging`      |
| Dev client + server, API pointed at **production**   | `npm run dev:prod`         |
| Production build then run server (tunnel-style flow) | `npm run tunnel`           |

`start:server` runs the server without forcing `GAME_ENV=dev` (see `package.json` scripts for exact behavior).

## After start

- If something fails, read the terminal output: port conflicts, missing env files, or Node version issues are the usual causes.
- For replay or API-specific workflows mentioned in the repo README, follow README guidance (commit alignment for production replays, etc.).
