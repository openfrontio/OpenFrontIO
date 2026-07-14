# Matchmaking integration harnesses

Two harnesses for the matchmaking client integration (the `matchmaking-modal`
close-code/reconnect contract from the matchmaking API handoff). Neither runs
as part of `npm test` — they drive a real headless browser.

## Contained — `npm run test:matchmaking`

Integration test against a **fake matchmaking server** (`fakeServer.mjs`, an
in-process `ws` server speaking the documented protocol). The browser's
`WebSocket` for `/matchmaking/join` is redirected to it, so real close-code
semantics apply. Covers:

| Scenario                            | Expected client behavior        |
| ----------------------------------- | ------------------------------- |
| join after connect                  | `{type:"join", jwt}` sent       |
| abrupt drop (deploy/restart, 1006)  | reconnect + rejoin (backoff)    |
| 1008 `Invalid session`              | reconnect + rejoin, fresh token |
| `match-assignment`                  | gameId recorded, socket done    |
| 1000 `Replaced by newer connection` | message shown, **no** retry     |
| intentional close (user backs out)  | no retry, no message            |

Prerequisite: `npm run dev` (app on :9000). No API worker needed.

## E2E — `npm run test:matchmaking:e2e`

Real integration against the **API worker on `localhost:8787`**. Two browser
players join the real queue through the real modal; the dev game server's
`/matchmaking/checkin` long-poll receives the assignment and creates the
game; the test asserts all players get the same `gameId`, dispatch
`join-lobby` once the game exists, that the game carries the mode's config,
and that the `allowedPublicIds` allowlist admits every matched player.

Modes:

- default: 1v1 with two players
- `MM_MODE=2v2 npm run test:matchmaking:e2e`: four players into the 2v2
  queue; additionally rides the real flow into the started game and asserts
  the in-game team split is 2 vs 2 and identical on every client.

Prerequisites:

- `npm run dev` (app + game server on :9000; the game server polls checkin
  on :8787 out of the box in dev)
- the API worker running locally: `wrangler dev` in the API repo (port 8787)

On failure the harness dumps both players' browser consoles — close code
1008 means the worker rejected the play token; no assignment usually means
the worker rejected the game server's `x-api-key` checkin.
